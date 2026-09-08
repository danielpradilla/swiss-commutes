import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate as generateCars } from '../scripts/generate-car-routes.mjs';
import { generate as generatePreviews } from '../scripts/generate-route-geometries.mjs';
import { activeRoutePair } from '../scripts/generate-active-routes.mjs';
import { reuseTransitRoute } from '../scripts/generate-transit-routes.mjs';
import { encodePolyline, routeKey } from '../app/route-geometry.ts';

test('changed endpoints retry rejected routes and remove stale accepted transit evidence', () => {
  const locations = [[46, 6], [46, 6.01]];
  const changed = [[46, 6], [46, 6.02]];
  const active = { routes: { pair: { locations: locations.flat(), costing: 'pedestrian' } }, skipped: { pair: 'too far' } };
  activeRoutePair(active, 'pair', locations, 'pedestrian');
  assert.equal(active.skipped.pair, 'too far');
  activeRoutePair(active, 'pair', changed, 'pedestrian');
  assert.equal(active.skipped.pair, undefined);
  active.skipped.pair = 'too slow';
  activeRoutePair(active, 'pair', changed, 'bicycle');
  assert.equal(active.skipped.pair, undefined);
  const transit = { routes: { pair: { locations: locations.flat(), toWork: {}, toHome: {} } }, evidence: { pair: {} }, skipped: { pair: 'no service' }, skippedLocations: { pair: locations.flat() } };
  assert.equal(reuseTransitRoute(transit, 'pair', locations), true);
  assert.equal(reuseTransitRoute(transit, 'pair', changed), false);
  assert.deepEqual(transit, { routes: {}, evidence: {}, skipped: {}, skippedLocations: {} });
  const rejected = { routes: {}, evidence: {}, skipped: { pair: 'no service' }, skippedLocations: { pair: locations.flat() } };
  assert.equal(reuseTransitRoute(rejected, 'pair', locations), true);
  assert.equal(reuseTransitRoute(rejected, 'pair', changed), false);
});

test('failed car refresh preserves the published cache and resumes its checkpoint', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'swiss-car-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = pathToFileURL(join(dir, 'routes.json'));
  const origin = { code: 'DE1', name: 'Home', lat: 46, lon: 6 };
  const target = { code: 'DE2', name: 'Work', lat: 46, lon: 6.02 };
  const corridor = { origin, target, mode: 'car' as const, direction: 'inbound' as const, commuters: 100, source: 'test' };
  const city = { slug: 'test', data: { corridors: [corridor] } };
  const key = routeKey(city.slug, corridor);
  const toWork = { shape: encodePolyline([[46, 6], [46, 6.02]], 6), seconds: 60, steps: [[1, 60, 'Road']] };
  const toHome = { ...toWork, shape: encodePolyline([[46, 6.02], [46, 6]], 6) };
  const previous = JSON.stringify({ coverageTarget: 0.95, routes: { [key]: { locations: [46, 6, 46, 6.01], toWork, toHome } } });
  await writeFile(output, previous);
  const known = new Map([[JSON.stringify([46, 6, 46, 6.02]), toWork]]);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 400 }));
  await assert.rejects(generateCars(city, {}, known, output), /HTTP 400/);
  assert.equal(await readFile(output, 'utf8'), previous);
  const checkpoint = new URL(`${output.href}.pending`);
  assert.ok(JSON.parse(await readFile(checkpoint, 'utf8')).routes[key].toWork);
  known.set(JSON.stringify([46, 6.02, 46, 6]), toHome);
  await generateCars(city, {}, known, output);
  const published = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(published.routes[key], { locations: [46, 6, 46, 6.02], toWork, toHome });
  await assert.rejects(readFile(checkpoint), { code: 'ENOENT' });
  assert.equal(fetch.mock.callCount(), 1, 'resume must reuse completed directional routes');
});

test('failed preview refresh cannot replace the previous geometry file', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'swiss-preview-refresh-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = pathToFileURL(join(dir, 'route-geometries.ts'));
  await writeFile(output, 'previous complete geometry');
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));
  await assert.rejects(generatePreviews(output), /previous cache preserved/);
  assert.equal(await readFile(output, 'utf8'), 'previous complete geometry');
});
