import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readItinerary } from '../scripts/generate-transit-routes.mjs';
import { encodePolyline, routeKey, type RouteCoordinate } from '../app/route-geometry.ts';
import { carPosition, packCarRoutes, prepareCarRoute, unpackCarRoutes, type CarRouteCache } from '../app/road-flow.ts';
import { cityBySlug } from '../app/cities.ts';

test('timetable import preserves transfer waiting and rejects incomplete journeys', () => {
  const a: RouteCoordinate = [46.2, 6.14], b: RouteCoordinate = [46.201, 6.141], c: RouteCoordinate = [46.203, 6.143];
  const point = ([lat, lon]: RouteCoordinate) => ({ lat, lon, name: 'stop' });
  const leg = (mode: string, from: RouteCoordinate, to: RouteCoordinate, start: string, end: string) => ({
    mode, from: point(from), to: point(to), startTime: `2026-09-08T${start}:00Z`, endTime: `2026-09-08T${end}:00Z`,
    ...(mode === 'WALK' ? {} : { tripId: 'trip', routeId: 'route', routeShortName: '80' }),
    legGeometry: { points: encodePolyline([from, to], 6), precision: 6 },
  });
  const itinerary = { startTime: '2026-09-08T05:00:00Z', endTime: '2026-09-08T05:20:00Z',
    legs: [leg('WALK', a, b, '05:00', '05:02'), leg('BUS', b, c, '05:07', '05:20')] };
  const { route } = readItinerary(itinerary, [a, c], '2026-09-08');
  assert.equal(route.seconds, 1200);
  assert.deepEqual(carPosition(prepareCarRoute(route), 5), b, 'waiting passengers stay at the transfer stop');
  assert.deepEqual(carPosition(prepareCarRoute(route), 20), c);
  assert.throws(() => readItinerary({ ...itinerary, legs: [itinerary.legs[0]] }, [a, c], '2026-09-08'));
  assert.throws(() => readItinerary({ ...itinerary, legs: [itinerary.legs[0], { ...itinerary.legs[1], cancelled: true }] }, [a, c], '2026-09-08'));
  assert.throws(() => readItinerary(itinerary, [a, c], '2026-09-09'));
  assert.throws(() => readItinerary({ ...itinerary, legs: [itinerary.legs[0], { ...itinerary.legs[1], legGeometry: undefined }] }, [a, c], '2026-09-08'));
  const straight: RouteCoordinate = [46.215, 6.141], gap: RouteCoordinate = [46.23, 6.141];
  assert.equal(readItinerary({ ...itinerary, legs: [itinerary.legs[0], leg('BUS', b, straight, '05:07', '05:20')] }, [a, straight], '2026-09-08').route.seconds, 1200);
  assert.throws(() => readItinerary({ ...itinerary, legs: [itinerary.legs[0], leg('BUS', b, gap, '05:07', '05:20')] }, [a, gap], '2026-09-08'), /gap over 2 km/);
});

test('Geneva scheduled routes cover multiple border origins and conserve packed journey times', async () => {
  const cache = JSON.parse(await readFile(new URL('../app/data/geneva-transit-routes.json', import.meta.url), 'utf8'));
  const routes: CarRouteCache = cache.routes;
  const corridors = new Map(cityBySlug.geneva.data!.corridors.map(c => [routeKey('geneva', c), c]));
  const origins = new Set<string>();
  for (const [key, pair] of Object.entries(routes)) {
    assert.equal(corridors.get(key)?.mode, 'transit', key);
    const c = corridors.get(key)!;
    if (c.origin.code.startsWith('FR')) origins.add(c.origin.name);
    for (const side of ['toWork', 'toHome'] as const) {
      const prepared = prepareCarRoute(pair[side]);
      assert.equal(prepared.minutes.length, prepared.points.length, key);
      assert.ok(prepared.minutes.every((v, i, a) => Number.isFinite(v) && (!i || v >= a[i - 1])), key);
      const evidence = cache.evidence[key][side];
      assert.equal(pair[side].seconds, (Date.parse(evidence.endTime) - Date.parse(evidence.startTime)) / 1000, key);
      assert.ok(evidence.legs.some((leg: { mode: string; tripId: string }) => leg.mode !== 'WALK' && leg.tripId), key);
    }
  }
  for (const name of ['Saint-Julien-en-Genevois', 'Gaillard', 'Ferney-Voltaire', 'Saint-Genis-Pouilly', 'Ville-la-Grand', 'Thonon-les-Bains', 'Ambilly', 'Valserhône', 'Annecy']) assert.ok(origins.has(name), name);
  assert.deepEqual(unpackCarRoutes(packCarRoutes(routes)), routes);
});
