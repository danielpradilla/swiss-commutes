import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cityBySlug } from '../app/cities.ts';
import { decodePolyline, encodePolyline, routeKey } from '../app/route-geometry.ts';
import { distanceKm } from '../app/road-flow.ts';

// Import sample weekday itineraries from a local MOTIS instance, never bulk-query Transitous.
export function readItinerary(itinerary, locations, date) {
  const start = Date.parse(itinerary?.startTime), finish = Date.parse(itinerary?.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(finish) || finish <= start || finish - start > 3 * 3600_000 ||
      !itinerary.startTime.startsWith(date) || !itinerary.endTime.startsWith(date)) throw new Error('No same-day itinerary under three hours');
  const legs = itinerary.legs;
  if (!Array.isArray(legs) || !legs.some(l => l.mode !== 'WALK' && l.tripId && l.routeId)) throw new Error('No scheduled public-transport leg');
  const points = [], evidence = [];
  /** @type {import('../app/road-flow.ts').CarRoute['steps']} */
  const steps = [];
  let previous = start, walking = 0;
  for (const leg of legs) {
    const departure = Date.parse(leg.startTime), arrival = Date.parse(leg.endTime);
    if (!Number.isFinite(departure) || !Number.isFinite(arrival) || departure < previous || arrival < departure ||
        leg.cancelled || leg.from?.cancelled || leg.to?.cancelled || arrival > finish) throw new Error('Invalid or cancelled timetable leg');
    if (leg.mode !== 'WALK' && (!leg.tripId || !leg.routeId)) throw new Error('Transit leg lacks a scheduled trip');
    if (![leg.from?.lat, leg.from?.lon, leg.to?.lat, leg.to?.lon].every(Number.isFinite)) throw new Error('Invalid stop coordinates');
    if (!leg.legGeometry?.points || ![5, 6].includes(leg.legGeometry.precision)) throw new Error('Missing leg geometry');
    const line = decodePolyline(leg.legGeometry.points, leg.legGeometry.precision);
    if (line.length < 2 || line.some(p => !p.every(Number.isFinite) || p[0] < 45 || p[0] > 48 || p[1] < 5 || p[1] > 11)) throw new Error('Invalid leg coordinates');
    // Straight OSM rail/road sections exceed 1 km; the audit checks the rejected examples against OSM.
    if (line.some((p, i) => i && distanceKm(line[i - 1], p) > 2)) throw new Error('Incomplete routed geometry (gap over 2 km)');
    if (distanceKm(line[0], [leg.from.lat, leg.from.lon]) > .15 || distanceKm(line.at(-1), [leg.to.lat, leg.to.lon]) > .15) throw new Error('Geometry misses its stops');
    if (points.length) {
      if (distanceKm(points.at(-1), line[0]) > .1) throw new Error('Disconnected transfer');
      if (departure > previous) {
        points.push(points.at(-1));
        steps.push([points.length - 1, (departure - previous) / 1000, 'Wait']);
      }
      points.push(...line.slice(1));
    } else points.push(...line);
    const label = leg.mode === 'WALK' ? 'Walk' : `${leg.mode} ${leg.routeShortName || leg.routeLongName || ''}`.trim();
    steps.push([points.length - 1, (arrival - departure) / 1000, label]);
    if (leg.mode === 'WALK') walking += (arrival - departure) / 1000;
    evidence.push({ mode: leg.mode, line: leg.routeShortName || leg.routeLongName || '', agency: leg.agencyName,
      tripId: leg.tripId, routeId: leg.routeId, from: leg.from.name, to: leg.to.name,
      startTime: leg.startTime, endTime: leg.endTime });
    previous = arrival;
  }
  if (walking > 45 * 60 || previous !== finish || distanceKm(points[0], locations[0]) > .2 ||
      distanceKm(points.at(-1), locations[1]) > .2) throw new Error('Excessive walking or incomplete endpoints');
  const seconds = (finish - start) / 1000;
  if (Math.abs(steps.reduce((n, s) => n + s[1], 0) - seconds) > 1) throw new Error('Journey time does not reconcile');
  return { route: { shape: encodePolyline(points, 6), seconds, steps },
    evidence: { startTime: itinerary.startTime, endTime: itinerary.endTime, legs: evidence } };
}

export function reuseTransitRoute(cache, key, locations) {
  const coordinates = JSON.stringify(locations.flat());
  if (cache.routes[key]?.toWork && cache.routes[key]?.toHome && JSON.stringify(cache.routes[key].locations) === coordinates) return true;
  if (cache.skipped[key] && JSON.stringify(cache.skippedLocations[key]) === coordinates) return true;
  delete cache.routes[key];
  delete cache.evidence[key];
  delete cache.skipped[key];
  delete cache.skippedLocations[key];
  return false;
}

async function generate(slug, date, endpoint) {
  const city = cityBySlug[slug];
  if (!city?.data || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Use a city slug and YYYY-MM-DD service date');
  const base = new URL(endpoint);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Bulk import requires a local MOTIS instance');
  const offsetHour = Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Zurich', timeZoneName: 'shortOffset' })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find(p => p.type === 'timeZoneName').value.replace('GMT', ''));
  const offset = `+${String(offsetHour).padStart(2, '0')}:00`;
  const car = JSON.parse(await readFile(new URL(`../app/data/${slug}-car-routes.json`, import.meta.url), 'utf8'));
  const output = new URL(`../app/data/${slug}-transit-routes.json`, import.meta.url);
  const checkpoint = new URL(`${output.href}.pending`);
  let cache = { provider: 'MOTIS 2.11.2 (local)', source: 'https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020',
    timetableVersion: '20260902', osmSource: ['https://download.geofabrik.de/europe/switzerland.html', 'https://download.geofabrik.de/europe/france/rhone-alpes.html'],
    serviceDate: date, generatedAt: '', routes: {}, evidence: {}, skipped: {} };
  for (const input of [checkpoint, output]) {
    try {
      const previous = JSON.parse(await readFile(input, 'utf8'));
      if (previous.serviceDate === date && previous.timetableVersion === cache.timetableVersion &&
          JSON.stringify(previous.osmSource) === JSON.stringify(cache.osmSource)) { cache = previous; break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  cache.skippedLocations ??= {};
  const selected = city.data.corridors.filter(c => c.mode === 'transit').sort((a, b) => b.commuters - a.commuters);
  const keys = new Set(selected.map(c => routeKey(slug, c)));
  for (const group of [cache.routes, cache.evidence, cache.skipped, cache.skippedLocations]) for (const key of Object.keys(group)) if (!keys.has(key)) delete group[key];
  const save = async () => {
    cache.generatedAt = new Date().toISOString();
    const tmp = new URL(`${checkpoint.href}.tmp`);
    await writeFile(tmp, JSON.stringify(cache) + '\n');
    await rename(tmp, checkpoint);
  };
  let done = 0;
  for (const corridor of selected) {
    const key = routeKey(slug, corridor);
    const locations = [corridor.origin, corridor.target].map(p => car.communePoints[p.code] ?? [p.lat, p.lon]);
    if (reuseTransitRoute(cache, key, locations)) continue;
    const pair = { locations: locations.flat() }, evidence = {};
    try {
      for (const [name, stops, hour] of [['toWork', locations, '07'], ['toHome', [...locations].reverse(), '17']]) {
        const url = new URL('/api/v6/plan', base);
        url.search = new URLSearchParams({ fromPlace: stops[0].join(','), toPlace: stops[1].join(','),
          time: `${date}T${hour}:00:00${offset}`, numItineraries: '3', maxItineraries: '3', detailedLegs: 'true',
          searchWindow: '10800', maxPreTransitTime: '1200', maxPostTransitTime: '1200' }).toString();
        const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw Object.assign(new Error(`Local routing HTTP ${response.status}`), { status: response.status });
        const result = await response.json();
        let accepted, reason = 'No scheduled itinerary';
        for (const itinerary of result.itineraries ?? []) {
          try { accepted = readItinerary(itinerary, stops, date); break; }
          catch (error) { reason = error.message; }
        }
        if (!accepted) throw new Error(`${name}: ${reason}`);
        pair[name] = accepted.route; evidence[name] = accepted.evidence;
      }
      cache.routes[key] = pair; cache.evidence[key] = evidence;
    } catch (error) {
      // A service outage is not evidence of an unavailable journey; stop and preserve the cache.
      if (error.status || /fetch failed|timeout|aborted/i.test(error.message)) { await save(); throw error; }
      cache.skipped[key] = error.message;
      cache.skippedLocations[key] = locations.flat();
    }
    if (++done % 25 === 0) {
      await save();
      console.log(`${slug}: ${done} checked, ${Object.keys(cache.routes).length} paired itineraries, ${Object.keys(cache.skipped).length} unavailable`);
    }
  }
  await save();
  await rename(checkpoint, output);
  const covered = selected.filter(c => cache.routes[routeKey(slug, c)]).reduce((n, c) => n + c.commuters, 0);
  console.log(`${slug}: ${Object.keys(cache.routes).length} paired itineraries covering ${covered} public-transport commuters`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generate(process.argv[2] ?? 'geneva', process.argv[3] ?? '2026-09-08', process.argv[4] ?? 'http://127.0.0.1:8089');
}
