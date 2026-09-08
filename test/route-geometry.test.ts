import test from 'node:test';
import assert from 'node:assert/strict';
import { routeGeometries } from '../app/data/route-geometries.ts';
import { decodePolyline, encodePolyline, pointAlongPolyline } from '../app/route-geometry.ts';

test('route geometry round-trips and interpolates by distance', () => {
  const route: [number, number][] = [[46.2044, 6.1432], [46.25, 6.5], [46.3164, 6.9698]];
  assert.deepEqual(decodePolyline(encodePolyline(route)), route);
  assert.deepEqual(pointAlongPolyline([[0, 0], [10, 0], [10, 30]], 0.5), [10, 10]);
  const repeated: [number, number][] = [[0, 0], [0, 0], [10, 0], [10, 0]];
  assert.deepEqual(pointAlongPolyline(repeated, -1), [0, 0]);
  assert.deepEqual(pointAlongPolyline(repeated, 0.5), [5, 0]);
  assert.deepEqual(pointAlongPolyline(repeated, 2), [10, 0]);
  assert.deepEqual(pointAlongPolyline([[1, 1], [1, 1]], 0.5), [1, 1]);
});

test('generated preview routes contain valid regional coordinates', () => {
  assert.ok(Object.keys(routeGeometries).length > 0);
  for (const encoded of Object.values(routeGeometries)) {
    const points = decodePolyline(encoded);
    assert.ok(points.length > 2);
    assert.ok(points.every(([latitude, longitude]) =>
      latitude >= 44 && latitude <= 49 && longitude >= 4 && longitude <= 11.5));
  }
});
