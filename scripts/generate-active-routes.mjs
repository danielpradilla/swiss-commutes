import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cities, cityBySlug } from '../app/cities.ts';
import { distanceKm } from '../app/road-flow.ts';
import { decodePolyline, routeKey } from '../app/route-geometry.ts';
import { fetchRoutes, planRouteBatch } from './generate-car-routes.mjs';

export function activeLocations(city, corridor, points) {
  // Reject the former canton aggregate if an older input is loaded: it has no trip endpoint.
  if (city.slug === 'geneva' && corridor.target.code === 'CH22') return null;
  const locations = [corridor.origin, corridor.target].map((p) =>
    city.slug === 'geneva' && p.code === 'CH25' ? [city.centre.lat, city.centre.lon]
      : points[p.code] ?? [p.lat, p.lon]);
  return corridor.mode === 'soft' && distanceKm(...locations) <= 25 ? locations : null;
}

export function validateActiveRoute(route, locations) {
  const points = decodePolyline(route.shape, 6);
  if (distanceKm(points[0], locations[0]) > 0.4 || distanceKm(points.at(-1), locations[1]) > 0.4) throw new Error('Route endpoint is over 400 m from the settlement');
  const km = points.slice(1).reduce((sum, p, i) => sum + distanceKm(points[i], p), 0);
  if (km > 35 || route.seconds > 3 * 3600) throw new Error('Route exceeds 35 km or three hours');
  return { ...route, steps: route.steps.map(([end, seconds]) => [end, seconds, '']) };
}

export function activeRoutePair(cache, key, locations, costing) {
  if (JSON.stringify(cache.routes[key]?.locations) !== JSON.stringify(locations.flat()) || cache.routes[key].costing !== costing) {
    cache.routes[key] = { locations: locations.flat(), costing };
    delete cache.skipped[key];
  }
  return cache.routes[key];
}

async function generate(slugs) {
  const known = new Map();
  const outputFor = (slug) => new URL(`../app/data/${slug}-active-routes.json`, import.meta.url);
  for (const city of cities) {
    try {
      const cache = JSON.parse(await readFile(outputFor(city.slug), 'utf8'));
      for (const pair of Object.values(cache.routes)) {
        const [a, b, c, d] = pair.locations;
        if (pair.toWork) known.set(JSON.stringify([pair.costing, [a, b], [c, d]]), pair.toWork);
        if (pair.toHome) known.set(JSON.stringify([pair.costing, [c, d], [a, b]]), pair.toHome);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const city of cities.filter((c) => !slugs.length || slugs.includes(c.slug))) {
    const output = outputFor(city.slug), checkpoint = new URL(`${output.href}.pending`);
    const car = JSON.parse(await readFile(new URL(`../app/data/${city.slug}-car-routes.json`, import.meta.url), 'utf8'));
    let cache = { provider: 'https://valhalla1.openstreetmap.de/route', generatedAt: '', coverageTarget: 0.95, maxDirectKm: 25, maxRouteKm: 35, routes: {}, skipped: {} };
    for (const input of [checkpoint, output]) {
      try { cache = JSON.parse(await readFile(input, 'utf8')); break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const save = async () => {
      cache.generatedAt = new Date().toISOString();
      const tmp = new URL(`${checkpoint.href}.tmp`);
      await writeFile(tmp, `${JSON.stringify(cache)}\n`);
      await rename(tmp, checkpoint);
    };
    const eligible = city.data.corridors.map((c) => ({ c, locations: activeLocations(city, c, car.communePoints) })).filter((x) => x.locations);
    const selected = ['inbound', 'outbound'].flatMap((direction) => {
      const ordered = eligible.filter(({ c }) => c.direction === direction).sort((a, b) => b.c.commuters - a.c.commuters);
      const target = ordered.reduce((sum, { c }) => sum + c.commuters, 0) * cache.coverageTarget;
      let total = 0;
      return ordered.filter(({ c }) => { if (total >= target) return false; total += c.commuters; return true; });
    });
    const currentKeys = new Set(selected.map(({ c }) => routeKey(city.slug, c)));
    for (const key of Object.keys(cache.routes)) if (!currentKeys.has(key)) delete cache.routes[key];
    for (const key of Object.keys(cache.skipped)) if (!currentKeys.has(key)) delete cache.skipped[key];
    const pending = new Map();
    for (const { c, locations } of selected) {
      const key = routeKey(city.slug, c);
      // ponytail: combined walk/bike counts; use walking under 3 km, cycling beyond, until separate counts are available.
      const costing = distanceKm(...locations) <= 3 ? 'pedestrian' : 'bicycle';
      const pair = activeRoutePair(cache, key, locations, costing);
      if (cache.skipped[key]) continue;
      for (const [name, stops] of [['toWork', locations], ['toHome', [...locations].reverse()]]) {
        if (pair[name]) continue;
        const id = JSON.stringify([costing, ...stops]);
        if (known.has(id)) { pair[name] = known.get(id); continue; }
        if (!pending.has(id)) pending.set(id, { id, locations: stops, costing, consumers: [] });
        pending.get(id).consumers.push({ pair, name, key });
      }
    }
    await save();
    let completed = 0;
    console.log(`${city.slug}: ${selected.length} local walk/bike pairs, ${pending.size} new directional routes`);
    for (const costing of ['pedestrian', 'bicycle']) {
      const jobs = [...pending.values()].filter((job) => job.costing === costing);
      for (let i = 0; i < jobs.length;) {
        let end = i + 1;
        while (end < jobs.length && planRouteBatch(jobs.slice(i, end + 1)).locations.length <= 10) end += 1;
        const batch = jobs.slice(i, end);
        const routes = await fetchRoutes(batch, costing);
        for (const [index, job] of batch.entries()) {
          try {
            const route = validateActiveRoute(routes[index], job.locations);
            known.set(job.id, route);
            for (const { pair, name } of job.consumers) pair[name] = route;
          } catch (error) {
            for (const { key } of job.consumers) cache.skipped[key] = error.message;
          }
        }
        completed += batch.length;
        await save();
        console.log(`${city.slug}: cached ${completed}/${pending.size}; ${Object.keys(cache.skipped).length} unsuitable pairs`);
        i = end;
      }
    }
    await rename(checkpoint, output);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slugs = process.argv.slice(2);
  if (slugs.some((slug) => !cityBySlug[slug]?.data)) throw new Error('Unknown city');
  await generate(slugs);
}
