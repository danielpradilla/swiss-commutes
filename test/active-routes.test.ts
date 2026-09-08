import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cities, cityBySlug } from '../app/cities.ts';
import { activeLocations, validateActiveRoute } from '../scripts/generate-active-routes.mjs';
import { encodePolyline } from '../app/route-geometry.ts';
import { prepareCarRoute, type ActiveRouteCache } from '../app/road-flow.ts';

test('active routing excludes distant and unknown destinations and rejects bad geometry', () => {
  const city = cityBySlug.geneva;
  const canton = { ...city.data!.corridors.find((c) => c.mode === 'soft')!, target: { code: 'CH22', name: 'Unknown Vaud workplace', lat: 46.5, lon: 6.5 } };
  assert.equal(activeLocations(city, canton, {}), null);
  const far = { ...canton, target: { code: 'CH1', name: 'Far away', lat: 47, lon: 8 } };
  assert.equal(activeLocations(city, far, {}), null);
  const locations: [number, number][] = [[46.2, 6.1], [46.21, 6.12]];
  const valid = { shape: encodePolyline(locations, 6), seconds: 600, steps: [[1, 600, 'Path']] };
  assert.equal(validateActiveRoute(valid, locations).seconds, 600);
  assert.throws(() => validateActiveRoute({ ...valid, seconds: 12000 }, locations), /three hours/);
  assert.throws(() => validateActiveRoute(valid, [[47, 8], locations[1]]), /400 m/);
});

test('every city has expanded local walking/cycling routes with valid independent return trips', async () => {
  for (const city of cities) {
    const raw = await readFile(new URL(`../app/data/${city.slug}-active-routes.json`, import.meta.url), 'utf8');
    const cache: { routes: ActiveRouteCache; skipped: Record<string, string> } = JSON.parse(raw);
    const complete = Object.entries(cache.routes).filter(([key, pair]) => pair.toWork && pair.toHome && !cache.skipped[key]);
    assert.ok(complete.length >= 10, `${city.slug}: expected expanded coverage`);
    assert.ok(complete.some(([, pair]) => pair.costing === 'bicycle'));
    const keys = new Set(city.data!.corridors.filter((c) => c.mode === 'soft').map((c) => `${city.slug}:${c.origin.code}>${c.target.code}:soft:${c.direction}`));
    for (const [key, pair] of complete) {
      assert.ok(keys.has(key), key);
      const [a, b, c, d] = pair.locations;
      for (const [route, locations] of [[pair.toWork, [[a, b], [c, d]]], [pair.toHome, [[c, d], [a, b]]]] as const) {
        validateActiveRoute(route, locations);
        const prepared = prepareCarRoute(route);
        assert.ok(prepared.duration > 0 && prepared.duration <= 180);
        assert.ok(prepared.points.every((p) => p.every(Number.isFinite)));
        assert.ok(prepared.minutes.every((v, i, values) => Number.isFinite(v) && (!i || v >= values[i - 1])));
      }
    }
  }
});
