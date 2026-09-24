import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, readFile, readdir } from 'node:fs/promises';
import { once } from 'node:events';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';

export function csv(line) {
  const fields = [];
  let value = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { fields.push(value); value = ''; }
    else value += char;
  }
  fields.push(value.replace(/\r$/, ''));
  return fields;
}

async function openFile(input, name) {
  try { await access(join(input, name)); return { stream: createReadStream(join(input, name)), done: Promise.resolve() }; }
  catch {
    const child = spawn('unzip', ['-p', input, name], { stdio: ['ignore', 'pipe', 'inherit'] });
    return { stream: child.stdout, done: once(child, 'close').then(([code]) => { if (code) throw new Error(`unzip ${name} failed (${code})`); }) };
  }
}

async function rows(input, name, visit) {
  const { stream, done } = await openFile(input, name);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let columns;
  for await (const line of lines) {
    if (!columns) { columns = Object.fromEntries(csv(line.replace(/^\uFEFF/, '')).map((name, index) => [name, index])); continue; }
    await visit(csv(line), columns);
  }
  await done;
}

async function write(stream, value) {
  if (!stream.write(value)) await once(stream, 'drain');
}

async function main() {
  const input = process.argv[2];
  const output = process.argv[3] ?? 'public/trains/timetable';
  const serviceDate = process.argv[4] ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date()).replaceAll('-', '');
  if (!input || !/^\d{8}$/.test(serviceDate)) throw new Error('Usage: npm run trains:timetable -- GTFS.zip [output-directory] [YYYYMMDD]');
  const noon = new Date(`${serviceDate.slice(0, 4)}-${serviceDate.slice(4, 6)}-${serviceDate.slice(6)}T12:00:00Z`);
  const serviceDates = [-1, 0, 1].map(offset => new Date(noon.getTime() + offset * 86_400_000).toISOString().slice(0, 10).replaceAll('-', ''));
  const activeByDate = new Map(serviceDates.map(date => [date, new Set()]));
  const cityFiles = (await readdir(new URL('../app/data/', import.meta.url)))
    .filter(name => name.endsWith('-rail-routes.json')).map(name => name.slice(0, -'-rail-routes.json'.length));
  const cityStations = new Map();
  for (const city of cityFiles) {
    const rail = JSON.parse(await readFile(new URL(`../app/data/${city}-rail-routes.json`, import.meta.url), 'utf8'));
    cityStations.set(city, new Set(Object.keys(rail.stations)));
  }

  let feedVersion = '';
  await rows(input, 'feed_info.txt', (row, c) => { feedVersion ||= row[c.feed_version]; });
  if (!/^\d{8}$/.test(feedVersion)) throw new Error('GTFS feed_version is missing');

  await rows(input, 'calendar.txt', (row, c) => {
    for (const date of serviceDates) {
      const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}T12:00:00Z`).getUTCDay()];
      if (row[c.start_date] <= date && row[c.end_date] >= date && row[c[weekday]] === '1') activeByDate.get(date).add(row[c.service_id]);
    }
  });
  await rows(input, 'calendar_dates.txt', (row, c) => {
    const services = activeByDate.get(row[c.date]);
    if (!services) return;
    if (row[c.exception_type] === '1') services.add(row[c.service_id]);
    else if (row[c.exception_type] === '2') services.delete(row[c.service_id]);
  });
  const activeServices = new Set([...activeByDate.values()].flatMap(set => [...set]));

  const trainRoutes = new Map();
  await rows(input, 'routes.txt', (row, c) => {
    const type = Number(row[c.route_type]);
    if (type === 2 || (type >= 100 && type <= 117)) trainRoutes.set(row[c.route_id], row[c.route_short_name]);
  });

  const trips = new Map();
  await rows(input, 'trips.txt', (row, c) => {
    const line = trainRoutes.get(row[c.route_id]);
    const number = row[c.trip_short_name];
    if (line !== undefined && number && activeServices.has(row[c.service_id])) trips.set(row[c.trip_id], [number, line]);
  });

  const stops = new Map();
  await rows(input, 'stops.txt', (row, c) => stops.set(row[c.stop_id], [row[c.didok] || row[c.stop_id].match(/\d{7}/)?.[0] || '', row[c.stop_name], Number(row[c.stop_lat]), Number(row[c.stop_lon])]));

  await mkdir(output, { recursive: true });
  const states = new Map();
  for (const city of cityFiles) {
    const stream = createWriteStream(join(output, `${city}.json`));
    await write(stream, JSON.stringify({ source: basename(input), feedVersion, serviceDates, generatedAt: new Date().toISOString(), city }).replace(/}$/, ',"trips":{'));
    states.set(city, { stream, first: true, stations: new Map(), trips: 0 });
  }

  const seenTrips = new Set();
  let current = '', meta, currentStops = [];
  async function flush() {
    if (!meta || !currentStops.length) return;
    if (seenTrips.has(current)) throw new Error(`stop_times.txt is not grouped by trip_id (${current})`);
    seenTrips.add(current);
    const matched = cityFiles.filter(city => currentStops.some(stop => cityStations.get(city).has(stops.get(stop[1])?.[0])));
    if (!matched.length) return;
    const compactStops = currentStops.map(([sequence, stopId, arrival, departure]) => [sequence, stopId, arrival, departure]);
    const value = JSON.stringify({ n: meta[0], l: meta[1], s: compactStops });
    for (const city of matched) {
      const state = states.get(city);
      await write(state.stream, `${state.first ? '' : ','}${JSON.stringify(current)}:${value}`);
      state.first = false; state.trips++;
      for (const [, stopId] of currentStops) {
        const stop = stops.get(stopId);
        state.stations.set(stopId, { name: stop?.[1] || stopId, lat: stop?.[2], lon: stop?.[3] });
      }
    }
  }

  await rows(input, 'stop_times.txt', async (row, c) => {
    const tripId = row[c.trip_id];
    if (tripId !== current) {
      await flush();
      current = tripId; meta = trips.get(tripId); currentStops = [];
    }
    if (meta) currentStops.push([Number(row[c.stop_sequence]), row[c.stop_id], row[c.arrival_time], row[c.departure_time]]);
  });
  await flush();

  for (const [city, state] of states) {
    await write(state.stream, `},"stations":${JSON.stringify(Object.fromEntries(state.stations))}}`);
    state.stream.end();
    await once(state.stream, 'close');
    console.log(`${city}: ${state.trips.toLocaleString()} train trips`);
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
