import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cities } from '../app/cities.ts';
import type { Corridor } from '../app/data/types.ts';
import { encodePolyline, decodePolyline, routeKey } from '../app/route-geometry.ts';
import { flowAt } from '../app/model.ts';
import {
  carPosition, carsInTransit, departureMinute, departureShare, distanceKm,
  prepareCarRoute, prepareRoadFlow, selectCarCorridors,
  packCarRoutes, unpackCarRoutes,
  type CarRoute, type CarRouteCache, type RoadJourney,
} from '../app/road-flow.ts';
import { parseCarRoute, planRouteBatch } from '../scripts/generate-car-routes.mjs';

test('shared road export preserves every route byte, timing and endpoint', () => {
  const cache = JSON.parse(readFileSync(new URL('../app/data/geneva-car-routes.json', import.meta.url), 'utf8')).routes;
  const packed = packCarRoutes(cache);
  assert.deepEqual(unpackCarRoutes(packed), cache);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(cache).length / 2, 'share repeated canton-wide road geometry');
  packed.shapes = [];
  assert.throws(() => unpackCarRoutes(packed), /Missing shared road geometry/);
});

test('road flow logic preserves weights, road direction and route-specific timing', () => {
  const a = { code: 'a', name: 'A', lat: 46, lon: 6 };
  const b = { code: 'b', name: 'B', lat: 46, lon: 6.02 };
  const corridor: Corridor = { origin: a, target: b, mode: 'car', direction: 'inbound', commuters: 100, source: 'test' };
  const route: CarRoute = {
    shape: encodePolyline([[46, 6], [46, 6.01], [46, 6.02]], 6), seconds: 240,
    steps: [[1, 60, 'Main road'], [2, 180, 'Main road']],
  };
  const prepared = prepareCarRoute(route);
  const coordinates = new Map();
  const shared = prepareCarRoute(route, coordinates);
  assert.deepEqual(shared, prepared, 'sharing coordinates must preserve exact points and times');
  assert.equal(prepareCarRoute(route, coordinates).points[1], shared.points[1], 'identical vertices share storage');
  assert.notEqual(shared.points[0], shared.points[1], 'different longitudes stay distinct');
  assert.deepEqual(prepared.minutes, [0, 1, 4]);
  assert.deepEqual(carPosition(prepared, 1), [46, 6.01]);
  assert.ok(Math.abs(carPosition(prepared, 2.5)[1] - 6.015) < 1e-10);
  assert.deepEqual(carPosition(prepared, 10), [46, 6.02]);
  assert.deepEqual(flowAt(912, 300, 900, 4, 'inbound', 24), { direction: 'outbound', progress: 0.5, reverse: true });
  for (const returning of [true, false]) {
    for (const share of [0, 0.1, 0.5, 0.9, 1]) {
      assert.ok(Math.abs(departureShare(departureMinute(share, returning), returning) - share) < 1e-10);
    }
  }
  const journey: RoadJourney = { corridor, route: prepared, returning: false, direction: 'inbound' };
  assert.equal(carsInTransit([journey], 450), Math.round(100 * (departureShare(450) - departureShare(446))));
  assert.equal(carsInTransit([journey], 0), 0);
  const small = { ...corridor, commuters: 5 };
  const outward = { ...corridor, direction: 'outbound' as const, commuters: 1 };
  assert.deepEqual(selectCarCorridors([corridor, small, outward, { ...corridor, mode: 'transit' }]), [corridor, outward]);
});

test('route validation rejects missing, incomplete and detached road geometry', () => {
  const shape = encodePolyline([[46, 6], [46, 6.01]], 6);
  const result = { trip: { legs: [{ shape, summary: { time: 60 }, maneuvers: [
    { begin_shape_index: 0, end_shape_index: 1, time: 60, street_names: ['Road'] },
  ] }] } };
  assert.equal(parseCarRoute(result, [[46, 6], [46, 6.01]]).seconds, 60);
  assert.throws(() => parseCarRoute({}, [[46, 6], [46, 6.01]]));
  assert.throws(() => parseCarRoute(result, [[47, 6], [46, 6.01]]));
  assert.throws(() => parseCarRoute({ trip: { legs: [{ ...result.trip.legs[0], maneuvers: [] }] } }, [[46, 6], [46, 6.01]]));
  const a = [46, 6], b = [46, 6.01], c = [47, 7];
  const batch = planRouteBatch([{ locations: [a, b] }, { locations: [b, a] }, { locations: [c, a] }]);
  assert.deepEqual(batch.locations, [a, b, a, c, a]);
  assert.deepEqual(batch.legs, [0, 1, 3], 'connecting legs are not commuter journeys');
});

for (const city of cities) test(`${city.name} car cache covers 95% in each direction with complete independent return routes`, () => {
  const cache = JSON.parse(readFileSync(new URL(`../app/data/${city.slug}-car-routes.json`, import.meta.url), 'utf8'));
  const corridors = city.data!.corridors;
  const routes = cache.routes as unknown as CarRouteCache;
  const flow = prepareRoadFlow(corridors, routes, city.slug);
  for (const direction of ['inbound', 'outbound'] as const) {
    assert.ok(flow.covered[direction] / flow.total[direction] >= 0.95, `${direction} coverage`);
  }
  let differentReturns = 0;
  for (const corridor of selectCarCorridors(corridors)) {
    const pair = routes[routeKey(city.slug, corridor)];
    assert.ok(pair?.toWork && pair.toHome);
    const communePoints = cache.communePoints as Record<string, number[]>;
    for (const point of [corridor.origin, corridor.target]) {
      if (city.slug !== 'geneva' && point.code.startsWith('CH')) {
        assert.ok(communePoints[point.code], `${point.code}: short and long commune IDs are both located`);
        assert.ok(distanceKm(communePoints[point.code] as [number, number], [point.lat, point.lon]) < 15,
          `${point.code}: Geneva canton gateways must not replace another city's commune`);
      }
    }
    assert.deepEqual(pair.locations, [corridor.origin, corridor.target].flatMap((point) =>
      communePoints[point.code] ?? [point.lat, point.lon]));
    const [fromLat, fromLon, toLat, toLon] = pair.locations;
    const [homeFromLat, homeFromLon, homeToLat, homeToLon] = pair.returnLocations ?? [toLat, toLon, fromLat, fromLon];
    if (city.slug === 'geneva' && corridor.target.code === 'CH22') {
      assert.ok(pair.returnLocations, 'Vaud gateway uses separate motorway carriageways');
      assert.notDeepEqual([homeFromLat, homeFromLon], [toLat, toLon]);
      assert.ok(toLat > corridor.origin.lat, 'Vaud gateway is north of the departure commune');
      const work = decodePolyline(pair.toWork.shape, 6);
      const home = decodePolyline(pair.toHome.shape, 6);
      assert.ok(work.at(-1)![0] > work.findLast((p) => p[0] !== work.at(-1)![0])![0], 'arrive northbound on A1');
      assert.ok(home[0][0] > home.find((p) => p[0] !== home[0][0])![0], 'leave southbound on A1');
    }
    for (const [route, origin, target] of [
      [pair.toWork, [fromLat, fromLon], [toLat, toLon]], [pair.toHome, [homeFromLat, homeFromLon], [homeToLat, homeToLon]],
    ] as const) {
      const prepared = prepareCarRoute(route);
      assert.equal(prepared.points.length, prepared.minutes.length);
      assert.ok(prepared.minutes.every((minute, i, minutes) => Number.isFinite(minute) && (i === 0 || minute >= minutes[i - 1])));
      assert.ok(Math.abs(prepared.minutes.at(-1)! - route.seconds / 60) < 1e-7);
      assert.ok(distanceKm(prepared.points[0], [...origin]) < 2);
      assert.ok(distanceKm(prepared.points.at(-1)!, [...target]) < 2);
    }
    if (pair.toHome.shape !== encodePolyline(decodePolyline(pair.toWork.shape, 6).reverse(), 6)) differentReturns += 1;
  }
  assert.ok(differentReturns > flow.pairs.size * 0.5);
  assert.equal(carsInTransit(flow.journeys, 0), 0);
  assert.equal(carsInTransit(flow.journeys, 1440), 0);
});
