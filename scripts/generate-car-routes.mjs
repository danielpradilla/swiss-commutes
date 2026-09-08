import { readFile, writeFile, rename } from 'node:fs/promises';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { cities, cityBySlug } from '../app/cities.ts';
import { decodePolyline, routeKey } from '../app/route-geometry.ts';
import { distanceKm, selectCarCorridors } from '../app/road-flow.ts';

const outputFor = (slug) => new URL(`../app/data/${slug}-car-routes.json`, import.meta.url);
const endpoint = 'https://valhalla1.openstreetmap.de/route';

export function parseCarRoute(result, locations) {
  const leg = result.trip?.legs?.[0];
  if (result.trip?.legs?.length !== 1 || !leg?.shape || !Number.isFinite(leg.summary?.time) || !(leg.summary.time > 0)) {
    throw new Error('Missing route shape or travel time');
  }
  const points = decodePolyline(leg.shape, 6);
  if (points.length < 2 || points.some(([lat, lon]) => !Number.isFinite(lat + lon) ||
    lat < 44 || lat > 49 || lon < 4 || lon > 11.5)) throw new Error('Invalid route coordinates');
  if (distanceKm(points[0], locations[0]) > 2 || distanceKm(points.at(-1), locations[1]) > 2) {
    throw new Error('Route endpoint is over 2 km from its commune point');
  }
  const steps = [];
  let end = 0;
  for (const maneuver of leg.maneuvers ?? []) {
    if (maneuver.begin_shape_index !== end || !Number.isInteger(maneuver.end_shape_index) ||
      maneuver.end_shape_index < end || maneuver.end_shape_index >= points.length ||
      !Number.isFinite(maneuver.time) || maneuver.time < 0) throw new Error('Invalid route step');
    if (maneuver.end_shape_index > end) {
      steps.push([maneuver.end_shape_index, maneuver.time, (maneuver.street_names ?? []).join(' / ')]);
    }
    end = maneuver.end_shape_index;
  }
  if (end !== points.length - 1 || !steps.length || steps.reduce((sum, step) => sum + step[1], 0) <= 0) {
    throw new Error('Incomplete route steps');
  }
  return { shape: leg.shape, seconds: leg.summary.time, steps };
}

export function planRouteBatch(jobs) {
  const locations = [];
  const legs = [];
  for (const job of jobs) {
    const [from, to] = job.locations;
    if (JSON.stringify(locations.at(-1)) !== JSON.stringify(from)) locations.push(from);
    legs.push(locations.length - 1);
    locations.push(to);
  }
  return { locations, legs };
}

export async function fetchRoutes(jobs, costing = 'auto') {
  const { locations, legs } = planRouteBatch(jobs);
  const url = new URL(endpoint);
  // ponytail: one route per commune pair; add workplace zones and route shares for calibrated traffic estimates.
  url.searchParams.set('json', JSON.stringify({
    locations: locations.map(([lat, lon]) => ({ lat, lon, type: 'break' })),
    costing, units: 'kilometers',
  }));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // One request per second at most; the browser only uses the committed cache.
    await wait(1000);
    try {
      const response = await fetch(url, {
        headers: { 'X-Client-Id': 'swiss-commutes', 'User-Agent': 'swiss-commutes/0.1 (https://www.danielpradilla.info/swiss-commutes/)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter) {
          const delay = Number(retryAfter) * 1000 || Date.parse(retryAfter) - Date.now();
          if (Number.isFinite(delay) && delay > 0) await wait(delay);
        }
        const error = new Error(`Valhalla HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
        error.status = response.status;
        throw error;
      }
      const result = await response.json();
      if (result.trip?.legs?.length !== locations.length - 1) throw new Error('Missing route legs');
      return jobs.map((job, index) => parseCarRoute({ trip: { legs: [result.trip.legs[legs[index]]] } }, job.locations));
    } catch (error) {
      // A connecting leg between unrelated jobs can fail even when both commuter journeys are valid.
      if (error.status === 400 && jobs.length > 1) {
        const routes = [];
        for (const job of jobs) routes.push(...await fetchRoutes([job], costing));
        return routes;
      }
      if (attempt === 2 || (error.status >= 400 && error.status < 500 && error.status !== 429)) {
        throw new Error(`${error.message}; locations: ${JSON.stringify(locations)}`, { cause: error });
      }
      await wait(5000 * (attempt + 1));
    }
  }
}

export async function generate(city, knownPoints, knownRoutes, output = outputFor(city.slug)) {
  const checkpoint = new URL(`${output.href}.pending`);
  let data = { provider: endpoint, generatedAt: '', coverageTarget: 0.95, routes: {} };
  for (const input of [checkpoint, output]) {
    try { data = JSON.parse(await readFile(input, 'utf8')); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const selected = selectCarCorridors(city.data.corridors, data.coverageTarget);
  const currentKeys = new Set(selected.map((c) => routeKey(city.slug, c)));
  for (const key of Object.keys(data.routes)) if (!currentKeys.has(key)) delete data.routes[key];
  const points = new Map(selected.flatMap((c) => [c.origin, c.target]).map((point) => [point.code, point]));
  data.communePoints ??= {};
  for (const point of points.values()) {
    // Geneva's CH22/CH25 are canton aggregates; elsewhere those IDs identify real communes.
    if (city.slug !== 'geneva' && data.communePoints[point.code] &&
      distanceKm(data.communePoints[point.code], [point.lat, point.lon]) >= 15) delete data.communePoints[point.code];
    if (!data.communePoints[point.code] && knownPoints[point.code] &&
      distanceKm(knownPoints[point.code], [point.lat, point.lon]) < 15) data.communePoints[point.code] = knownPoints[point.code];
  }
  // The Glarus Süd centroid falls above the valley. Use the DiDok Linthal station in its inhabited valley.
  if (points.has('CH1631')) data.communePoints.CH1631 = [46.92556359068011, 8.99779486958079];
  const save = async () => {
    data.generatedAt = new Date().toISOString();
    await writeFile(new URL(`${checkpoint.href}.tmp`), `${JSON.stringify(data)}\n`);
    await rename(new URL(`${checkpoint.href}.tmp`), checkpoint);
  };
  const departments = new Set([...points.values()].filter((point) => point.code.startsWith('FR') && !data.communePoints[point.code])
    .map((point) => point.code.slice(2, 4)));
  if (departments.size) {
    // Commune centroids can land on mountain tracks; town halls anchor the inhabited town.
    for (const department of departments) {
      const response = await fetch(`https://geo.api.gouv.fr/departements/${department}/communes?fields=code,mairie`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`API Géo HTTP ${response.status}`);
      for (const commune of await response.json()) {
        const [lon, lat] = commune.mairie?.coordinates ?? [];
        if (Number.isFinite(lat + lon) && lat >= 44 && lat <= 49 && lon >= 4 && lon <= 11.5) {
          knownPoints[`FR${commune.code}`] = [lat, lon];
          if (points.has(`FR${commune.code}`)) data.communePoints[`FR${commune.code}`] = [lat, lon];
        }
      }
    }
  }
  {
    const source = 'https://api3.geo.admin.ch/rest/services/ech/SearchServer';
    const normalise = (name) => name.toLowerCase().replace(/\s*\([a-z]{2}\)$/, '').replace(/^saint-/, 'st-');
    const swissPoints = [...points.values()].filter((point) => /^CH\d+$/.test(point.code) &&
      !(city.slug === 'geneva' && /^CH\d{1,3}$/.test(point.code)) && !data.communePoints[point.code]);
    console.log(`${city.slug}: locating ${swissPoints.length} Swiss communes`);
    for (const [index, point] of swissPoints.entries()) {
      const url = new URL(source);
      url.search = new URLSearchParams({ type: 'locations', origins: 'gazetteer', searchText: point.name, limit: '10', sr: '4326' });
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`swisstopo HTTP ${response.status}`);
      const matches = (await response.json()).results.map((result) => result.attrs).filter((place) =>
        place.objectclass === 'TLM_SIEDLUNGSNAME' && place.rank === 5 &&
        normalise(place.label.match(/<b>(.*?)<\/b>/)?.[1] ?? '') === normalise(point.name) &&
        distanceKm([point.lat, point.lon], [place.lat, place.lon]) < 15);
      // Keep the original point when a merged commune has no single unambiguous settlement.
      data.communePoints[point.code] = matches.length === 1 ? [matches[0].lat, matches[0].lon] : [point.lat, point.lon];
      knownPoints[point.code] = data.communePoints[point.code];
      if ((index + 1) % 25 === 0) {
        await save();
        console.log(`${city.slug}: located ${index + 1}/${swissPoints.length} Swiss communes`);
      }
    }
    data.settlementSource = source;
  }
  delete data.gateway;
  delete data.returnCommunePoints;
  const pending = new Map();
  for (const corridor of selected) {
    const key = routeKey(city.slug, corridor);
    const locations = [corridor.origin, corridor.target].map(({ code, lat, lon }) => {
      if (code.startsWith('FR') && !data.communePoints[code]) throw new Error(`Missing town-hall location for ${code}`);
      return data.communePoints[code] ?? [lat, lon];
    });
    const returnLocations = [corridor.target, corridor.origin].map(({ code }, index) =>
      data.returnCommunePoints?.[code] ?? locations[1 - index]);
    const homeOverride = corridor.target.code === data.gateway?.code ? returnLocations.flat() : undefined;
    let pair = data.routes[key];
    if (JSON.stringify(pair?.locations) !== JSON.stringify(locations.flat()) ||
      JSON.stringify(pair?.returnLocations) !== JSON.stringify(homeOverride)) {
      pair = { locations: locations.flat(), ...(homeOverride ? { returnLocations: homeOverride } : {}) };
    }
    data.routes[key] = pair;
    for (const [name, stops] of [['toWork', locations], ['toHome', returnLocations]]) {
      if (pair[name]) continue;
      const routeId = JSON.stringify(stops.flat());
      if (knownRoutes.has(routeId)) { pair[name] = knownRoutes.get(routeId); continue; }
      const job = pending.get(routeId) ?? { locations: stops, consumers: [] };
      job.consumers.push({ pair, name });
      pending.set(routeId, job);
    }
  }
  await save();
  const jobs = [...pending.values()];
  console.log(`${city.slug}: ${selected.length} commune pairs, ${jobs.length} new directional routes`);
  // Break waypoints give each journey its own leg; this public server allows ten locations per request.
  for (let index = 0; index < jobs.length;) {
    let end = index + 1;
    while (end < jobs.length && planRouteBatch(jobs.slice(index, end + 1)).locations.length <= 10) end += 1;
    const batch = jobs.slice(index, end);
    const routes = await fetchRoutes(batch);
    for (const [i, job] of batch.entries()) {
      knownRoutes.set(JSON.stringify(job.locations.flat()), routes[i]);
      for (const { pair, name } of job.consumers) pair[name] = routes[i];
    }
    await save();
    index = end;
    console.log(`${city.slug}: cached ${index}/${jobs.length} new directional routes`);
  }
  if (Object.values(data.routes).some(pair => !pair.toWork || !pair.toHome)) throw new Error('Incomplete car cache; previous export preserved');
  await rename(checkpoint, output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slugs = process.argv.slice(2);
  if (slugs.some((slug) => !cityBySlug[slug]?.data)) throw new Error('Unknown city; use a city slug or omit for all cities');
  const knownPoints = {};
  const knownRoutes = new Map();
  for (const city of cities) {
    try {
      const cache = JSON.parse(await readFile(outputFor(city.slug), 'utf8'));
      for (const [code, point] of Object.entries(cache.communePoints ?? {})) {
        if (!(city.slug === 'geneva' && /^CH\d{1,3}$/.test(code))) knownPoints[code] = point;
      }
      for (const pair of Object.values(cache.routes)) {
        const [a, b, c, d] = pair.locations;
        if (pair.toWork) knownRoutes.set(JSON.stringify(pair.locations), pair.toWork);
        if (pair.toHome) knownRoutes.set(JSON.stringify(pair.returnLocations ?? [c, d, a, b]), pair.toHome);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const city of slugs.length ? slugs.map((slug) => cityBySlug[slug]) : cities) {
    await generate(city, knownPoints, knownRoutes);
  }
}
