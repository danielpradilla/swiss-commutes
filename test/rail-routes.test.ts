import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cities } from '../app/cities.ts';
import { distanceKm } from '../app/road-flow.ts';
import { decodePolyline, prepareRailRoutes, routeKey, type RailRouteCache } from '../app/route-geometry.ts';
import { readLine, shortestPaths, toWgs84 } from '../scripts/generate-rail-routes.mjs';

test('rail import validates coordinates and finds connected shortest paths', () => {
  const point = toWgs84(2700000, 1100000);
  assert.ok(distanceKm(point, [46 + 2 / 60 + 38.86 / 3600, 8 + 43 / 60 + 49.8 / 3600]) < 0.002);
  const blob = Buffer.alloc(49);
  blob.write('GP'); blob[3] = 1; blob.writeInt32LE(2056, 4);
  blob[8] = 1; blob.writeUInt32LE(2, 9); blob.writeUInt32LE(2, 13);
  for (const [i, value] of [2700000, 1100000, 2700100, 1100200].entries()) blob.writeDoubleLE(value, 17 + i * 8);
  assert.deepEqual(readLine(blob)[0], point);
  blob.writeInt32LE(4326, 4);
  assert.throws(() => readLine(blob), /LV95/);
  assert.throws(() => readLine(Buffer.from('bad input')));
  const graph = new Map([
    [1, [{ to: 2, id: 1, km: 4 }, { to: 3, id: 2, km: 1 }]],
    [3, [{ to: 2, id: 3, km: 1 }]],
  ]);
  const { costs, previous } = shortestPaths(graph, 1);
  assert.equal(costs.get(2), 2);
  assert.equal(previous.get(2)?.node, 3);
  assert.equal(previous.has(4), false);
  const separateLines = new Map([...graph, [5, [{ to: 6, id: 4, km: 2 }]]]);
  const multi = shortestPaths(separateLines, [1, 5]);
  assert.equal(multi.costs.get(2), 2);
  assert.equal(multi.previous.get(6)?.node, 5, 'independent city rail termini remain reachable');
});

test('every city rail cache follows continuous station paths for existing transit corridors', async () => {
  for (const city of cities) {
    const raw = await readFile(new URL(`../app/data/${city.slug}-rail-routes.json`, import.meta.url), 'utf8');
    assert.ok(Buffer.byteLength(raw) < 600_000, `${city.slug}: keep the city download small`);
    const cache: RailRouteCache = JSON.parse(raw);
    const prepared = prepareRailRoutes(cache);
    assert.ok(prepared.routes.size >= (['chiasso', 'mendrisio'].includes(city.slug) ? 20 : 40), `${city.slug}: missing rail routes`);
    const corridors = new Map(city.data!.corridors.map((c) => [routeKey(city.slug, c), c]));
    const used = new Set<number>();
    for (const [key, route] of Object.entries(cache.routes)) {
      const corridor = corridors.get(key);
      assert.equal(corridor?.mode, 'transit', key);
      assert.ok(corridor!.origin.code.startsWith('CH') && corridor!.target.code.startsWith('CH'), key);
      assert.ok(route.edges.length > 0, key);
      let last: [number, number] | undefined;
      for (const id of route.edges) {
        used.add(Math.abs(id));
        const encoded = cache.segments[Math.abs(id)];
        assert.ok(encoded, `${key}: missing segment ${id}`);
        const line = decodePolyline(encoded);
        if (id < 0) line.reverse();
        assert.ok(line.every(([lat, lon]) => lat >= 45 && lat <= 48 && lon >= 5 && lon <= 11), key);
        if (last) assert.ok(distanceKm(last, line[0]) < 0.02, `${key}: track discontinuity`);
        last = line.at(-1)!;
      }
      const points = prepared.routes.get(key)!.points;
      assert.ok(distanceKm(points[0], cache.stations[route.from].point) < 0.51, `${key}: origin station`);
      assert.ok(distanceKm(points.at(-1)!, cache.stations[route.to].point) < 0.51, `${key}: destination station`);
    }
    assert.equal(used.size, Object.keys(cache.segments).length, 'Do not ship unused network segments');
    if (city.slug === 'zurich') {
      for (const [name, terminus] of [
        ['Winterthur', 'Zürich HB'], ['Adliswil', 'Zürich HB SZU'],
        ['Langnau am Albis', 'Zürich HB SZU'], ['Uitikon', 'Zürich HB SZU'],
        ['Egg', 'Zürich Stadelhofen, Bahnhof'], ['Zumikon', 'Zürich Stadelhofen, Bahnhof'],
      ]) {
        const matched = city.data!.corridors.filter((c) => c.mode === 'transit' &&
          (c.direction === 'inbound' ? c.origin : c.target).name === name);
        assert.ok(matched.length > 0, `${name}: missing source corridor`);
        for (const c of matched) {
          const route = prepared.routes.get(routeKey(city.slug, c));
          assert.ok(route, `${name}: missing ${c.direction} rail route`);
          assert.equal(c.direction === 'inbound' ? route.to : route.from, terminus);
        }
      }
    }
    if (city.slug === 'bern') {
      const c = city.data!.corridors.find((c) => c.mode === 'transit' && c.origin.code === 'CH942')!;
      assert.equal(prepared.routes.get(routeKey(city.slug, c))?.to, 'Bern', 'preserve the main station when adding independent railways');
    }
    if (city.slug === 'geneva') {
      const meyrin = city.data!.corridors.find((c) => c.mode === 'transit' && c.origin.name === 'Gland' && c.target.name === 'Meyrin')!;
      assert.equal(prepared.routes.get(routeKey(city.slug, meyrin))?.to, 'Meyrin', 'canton workplaces must not all route to central Genève');
      for (const name of ['Nyon', 'Lausanne', 'Gland', 'Morges', 'Coppet']) {
        const c = city.data!.corridors.find((c) => c.mode === 'transit' && c.origin.name === name && c.target.code === 'CH6621')!;
        const route = prepared.routes.get(routeKey(city.slug, c));
        assert.ok(route, `${name} → Genève must be present`);
        assert.equal(route.to, 'Genève');
        assert.equal(route.from, name);
      }
      assert.ok(![...prepared.routes.keys()].some((key) => key.includes('>CH22:')), 'Do not turn canton totals into invented station destinations');
    }
  }
});
