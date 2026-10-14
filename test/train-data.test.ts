import test from 'node:test';
import assert from 'node:assert/strict';
import { mercatorToLatLng, networkModes, parseTrackContext, parseTransitFeed, parseTrip, vehicleColor, vehicleLabel, vehicleMatches, vehiclePosition, vehicleRadius, vehiclesForView } from '../app/trains/train-data.ts';
import type { TransitPoint } from '../app/trains/train-data.ts';
import { encodePolyline } from '../app/route-geometry.ts';
import { PbfWriter } from 'pbf';
import { decodeNetwork, drawNetwork } from '../app/trains/network-layer.ts';

const epoch = Date.parse('2026-10-14T10:00:00Z');
const feature = {
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[0, 0], [1000, 0], [1000, 1000]] },
  properties: {
    train_id: 515, type: 'rail', line: { name: 'IC1' }, train_number: '515',
    delay: 180000, has_realtime_journey: true, state: 'DRIVING',
    time_intervals: [[epoch, 0, null], [epoch + 10000, 1, 90]],
  },
};
const feed = {
  fetchedAt: '2026-10-14T10:00:00Z', city: 'zurich', coverage: [-80000, -80000, 80000, 80000],
  features: [feature],
};

function near(actual: number[], expected: number[]) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) < 1e-10, `${actual[i]} != ${expected[i]}`);
}

test('vehicle movement follows cumulative bent-route distance, not the endpoint chord', () => {
  const vehicle = parseTransitFeed(feed).vehicles[0];
  assert.deepEqual(vehicle.distances, [0, 1000, 2000]);
  near(vehiclePosition(vehicle, epoch + 2500), mercatorToLatLng([500, 0]));
  near(vehiclePosition(vehicle, epoch + 5000), mercatorToLatLng([1000, 0]));
  near(vehiclePosition(vehicle, epoch + 7500), mercatorToLatLng([1000, 500]));
  assert.notDeepEqual(vehiclePosition(vehicle, epoch + 5000), mercatorToLatLng([500, 500]));
  near(mercatorToLatLng([6378137 * Math.PI / 180, 0]), [0, 1]);
});

test('duplicate times, dwell, repeated vertices and endpoint clamping stay finite', () => {
  const vehicle = parseTransitFeed({ ...feed, features: [{ ...feature, properties: {
    ...feature.properties, time_intervals: [[epoch, 0, null], [epoch, 0, null], [epoch + 4000, .5, null],
      [epoch + 6000, .5, null], [epoch + 10000, 1, null], [epoch + 10000, 1, null]],
  } }] }).vehicles[0];
  near(vehiclePosition(vehicle, epoch - 1), mercatorToLatLng([0, 0]));
  near(vehiclePosition(vehicle, epoch), mercatorToLatLng([0, 0]));
  near(vehiclePosition(vehicle, epoch + 5000), mercatorToLatLng([1000, 0]));
  near(vehiclePosition(vehicle, epoch + 10000), mercatorToLatLng([1000, 1000]));
  near(vehiclePosition(vehicle, epoch + 20000), mercatorToLatLng([1000, 1000]));
  const repeated = parseTransitFeed({ ...feed, features: [{ ...feature, geometry: {
    type: 'LineString', coordinates: [[0, 0], [0, 0], [1000, 0], [1000, 0]],
  } }] }).vehicles[0];
  near(vehiclePosition(repeated, epoch + 5000), mercatorToLatLng([500, 0]));
  near(vehiclePosition(repeated, epoch + 10001), mercatorToLatLng([1000, 0]));
  const sameTime = { ...vehicle, intervals: [[epoch, 0, null], [epoch, 1, null]] as typeof vehicle.intervals };
  near(vehiclePosition(sameTime, epoch), mercatorToLatLng([1000, 1000]));
  assert.throws(() => vehiclePosition(vehicle, NaN));
});

test('stationary points and zero-length lines need no moving geometry', () => {
  for (const geometry of [
    { type: 'Point', coordinates: [1000, 2000] },
    { type: 'LineString', coordinates: [[1000, 2000], [1000, 2000]] },
  ]) {
    const vehicle = parseTransitFeed({ ...feed, features: [{ ...feature, geometry }] }).vehicles[0];
    for (const time of [epoch - 1, epoch, epoch + 5000, epoch + 20000]) near(vehiclePosition(vehicle, time), mercatorToLatLng([1000, 2000]));
    near(vehiclePosition({ ...vehicle, intervals: [] }, epoch), mercatorToLatLng([1000, 2000]));
  }
});

test('feed modes, realtime delays, labels and accent-free all-term search normalize once', () => {
  const vehicles = parseTransitFeed({ ...feed, features: [feature,
    { ...feature, properties: { ...feature.properties, type: 'subway', train_number: null, line: { name: 'Genève 12' }, has_realtime_journey: false } },
    { ...feature, properties: { ...feature.properties, type: 'bus', train_number: 10, delay: null } },
    { ...feature, geometry: null, properties: { type: 'ferry' } },
  ] }).vehicles;
  assert.deepEqual(vehicles.map(vehicle => vehicle.mode), ['rail', 'tram', 'bus']);
  assert.deepEqual(vehicles.map(vehicle => vehicle.delayMinutes), [3, null, null]);
  assert.equal(vehicles[1].realtime, false);
  assert.equal(vehicleLabel(vehicles[0]), 'Train IC1 515');
  assert.equal(vehicleLabel(vehicles[1]), 'Tram Genève 12');
  assert.equal(vehicleLabel({ ...vehicles[2], line: '10' }), 'Bus 10');
  assert.equal(vehicleMatches(vehicles[0], '515 ic1 train'), true);
  assert.equal(vehicleMatches(vehicles[1], 'GENEVE 12'), true);
  assert.equal(vehicleMatches(vehicles[1], '  '), true);
  assert.equal(vehicleMatches(vehicles[0], 'bus'), false);
  assert.deepEqual([vehicleColor(0), vehicleColor(3), vehicleColor(6), vehicleColor(null), vehicleColor(0, true)],
    ['#0f766e', '#b7791f', '#c2413f', '#6d6d6d', '#6d6d6d']);
  assert.equal(parseTransitFeed({ ...feed, features: [{ ...feature, properties: { ...feature.properties, state: 'CANCELLED' } }] }).vehicles[0].cancelled, true);
});

test('rail view excludes all other modes from a mixed feed while public transport retains them', () => {
  const vehicles = parseTransitFeed({ ...feed, features: ['rail', 'tram', 'subway', 'bus'].map((type, index) => ({
    ...feature, properties: { ...feature.properties, type, train_id: index },
  })) }).vehicles;
  assert.deepEqual(vehiclesForView(vehicles, 'trains').map(vehicle => vehicle.mode), ['rail']);
  assert.deepEqual(vehiclesForView(vehicles, 'public-transport').map(vehicle => vehicle.mode), ['rail', 'tram', 'tram', 'bus']);
  assert.deepEqual(vehiclesForView([], 'trains'), []);
});

test('vehicle size depends only on mode and zoom, preserving train over tram over bus', () => {
  for (const zoom of [7, 12, 13, 14, 17]) {
    const rail = vehicleRadius('rail', zoom);
    const tram = vehicleRadius('tram', zoom);
    const bus = vehicleRadius('bus', zoom);
    assert.ok(rail > tram && tram > bus);
    assert.deepEqual([rail, tram, bus], zoom >= 14 ? [9, 7, 5] : [7, 5, 3]);
  }
});

test('mapped network accepts only explicit numeric or named public transport route flags', () => {
  for (const value of [0, '', '0', '  ', ' 0 ', false, true, 2, null, undefined]) {
    assert.deepEqual(networkModes({ bus_route: value }), []);
  }
  for (const value of [1, '1', '12', 'Ferney–Genève']) {
    assert.deepEqual(networkModes({ bus_route: value }), ['bus']);
  }
  assert.deepEqual(networkModes({ class: 'primary', subclass: 'rail', route: 'bus', name: 'Main road' }), []);
  assert.deepEqual(networkModes({ train_route: 1 }), ['rail']);
  assert.deepEqual(networkModes({ trolleybus_route: '10' }), ['bus']);
});

test('mapped network groups tram variants and preserves shared roads under mode filtering', () => {
  for (const flag of ['tram_route', 'light_rail_route', 'subway_route']) {
    assert.deepEqual(networkModes({ [flag]: 1 }), ['tram']);
    assert.deepEqual(networkModes({ [flag]: 1 }, ['rail', 'bus']), []);
  }
  const shared = { train_route: 'IC1', tram_route: 1, bus_route: '5', trolleybus_route: 1 };
  assert.deepEqual(networkModes(shared), ['rail', 'tram', 'bus']);
  assert.deepEqual(networkModes(shared, ['tram', 'bus']), ['tram', 'bus']);
  assert.deepEqual(networkModes(shared, ['rail']), ['rail']);
  assert.deepEqual(networkModes(shared, []), []);
});

function networkTile({ types = [2], extent = 4096, flag = 'bus_route', geometry = [9, 0, 0, 10, 20, 20, 9, 80, 80, 10, 20, 0], name = 'transportation' } = {}): ArrayBuffer {
  const writer = new PbfWriter();
  writer.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, name);
    for (const type of types) layer.writeMessage(2, (_, feature) => {
      feature.writePackedVarint(2, [0, 0]);
      feature.writeVarintField(3, type);
      feature.writePackedVarint(4, geometry);
    }, null);
    layer.writeStringField(3, flag);
    layer.writeMessage(4, (_, value) => value.writeVarintField(4, 1), null);
    layer.writeVarintField(5, extent);
    layer.writeVarintField(15, 2);
  }, null);
  return writer.finish().slice().buffer;
}

test('network protobuf decoding keeps only route-flagged line features in supported layers', () => {
  const lines = decodeNetwork(networkTile({ types: [1, 2, 3] }));
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].modes, ['bus']);
  assert.equal(lines[0].extent, 4096);
  assert.deepEqual(lines[0].parts.map(part => part.map(point => [point.x, point.y])), [[[0, 0], [10, 10]], [[50, 50], [60, 50]]]);
  assert.equal(decodeNetwork(networkTile({ name: 'transportation_name' })).length, 1);
  const primary = networkTile();
  const named = networkTile({ name: 'transportation_name' });
  const both = new Uint8Array(primary.byteLength + named.byteLength);
  both.set(new Uint8Array(primary));
  both.set(new Uint8Array(named), primary.byteLength);
  assert.equal(decodeNetwork(both.buffer).length, 1, 'label-layer geometry does not double the road network');
  assert.deepEqual(decodeNetwork(networkTile({ flag: 'class' })), []);
  assert.deepEqual(decodeNetwork(networkTile({ name: 'waterway' })), []);
});

test('network drawing scales original extent and never connects multipart gaps or disabled modes', () => {
  const commands: unknown[][] = [];
  const context = {
    clearRect: (...values: number[]) => commands.push(['clear', ...values]),
    beginPath: () => commands.push(['begin']),
    moveTo: (x: number, y: number) => commands.push(['move', x, y]),
    lineTo: (x: number, y: number) => commands.push(['line', x, y]),
    stroke: () => commands.push(['stroke']),
  } as unknown as CanvasRenderingContext2D;
  const lines = decodeNetwork(networkTile());
  drawNetwork(context, 256, 256, lines, ['bus']);
  assert.deepEqual(commands, [['clear', 0, 0, 256, 256], ['begin'], ['move', 0, 0], ['line', .625, .625],
    ['move', 3.125, 3.125], ['line', 3.75, 3.125], ['stroke']]);
  commands.length = 0;
  drawNetwork(context, 256, 256, lines, ['rail', 'tram']);
  assert.deepEqual(commands, [['clear', 0, 0, 256, 256], ['begin'], ['stroke']]);
});

test('network decoder rejects malformed protobuf, invalid extents and unreasonable coordinates', () => {
  for (const buffer of [new ArrayBuffer(0), new Uint8Array([255]).buffer,
    networkTile({ extent: 0 }), networkTile({ extent: 65537 }),
    networkTile({ geometry: [9, 0, 0, 10, 1000000, 0] }),
  ]) assert.throws(() => decodeNetwork(buffer));
});

test('track context decodes exact geographic points and ignores empty or point-only segments', () => {
  const tracks = { source: 'ARE', networkYear: 2023, segments: {
    line: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', empty: '', point: '??',
  } };
  assert.deepEqual(parseTrackContext(tracks), [[[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]]]);
});

test('track boundary rejects malformed payloads, encodings and out-of-world coordinates', () => {
  const tracks = { source: 'ARE', networkYear: 2023, segments: { line: '????' } };
  for (const invalid of [null, [], {}, { ...tracks, source: null }, { ...tracks, networkYear: '2023' },
    { ...tracks, segments: [] }, { ...tracks, segments: { line: {} } },
    { ...tracks, segments: { line: '_' } }, { ...tracks, segments: { line: '?' } },
    { ...tracks, segments: { line: '!!' } },
    { ...tracks, segments: { line: encodePolyline([[91, 0], [92, 0]]) } },
    { ...tracks, segments: { line: encodePolyline([[0, 181], [0, 182]]) } },
  ]) assert.throws(() => parseTrackContext(invalid));
});

test('feed trust boundary rejects malformed geometry, intervals, metadata and dates', () => {
  for (const geometry of [null, { type: 'LineString', coordinates: [[0, 0]] },
    { type: 'Point', coordinates: [NaN, 0] }, { type: 'Point', coordinates: [0, Infinity] },
    { type: 'Point', coordinates: [0, '1'] }, { type: 'LineString', coordinates: [[0, 0], [1, 2, 3]] },
    { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] },
  ]) assert.throws(() => parseTransitFeed({ ...feed, features: [{ ...feature, geometry }] }));
  for (const time_intervals of [[[epoch, -.1, null]], [[epoch, 1.1, null]], [[epoch, NaN, null]],
    [[epoch + 1, 0, null], [epoch, 1, null]], [[epoch, 0, Infinity]], [['bad', 0, null]], [[epoch, 0]],
  ]) assert.throws(() => parseTransitFeed({ ...feed, features: [{ ...feature, properties: { ...feature.properties, time_intervals } }] }));
  for (const invalid of [null, {}, { ...feed, fetchedAt: 'bad' }, { ...feed, fetchedAt: '2026-10-14' },
    { ...feed, fetchedAt: '2026-02-30T10:00:00Z' }, { ...feed, fetchedAt: '2026-10-14T24:00:00Z' },
    { ...feed, coverage: [0, 0, 0, 1] }, { ...feed, coverage: [0, 0, Infinity, 1] },
    { ...feed, features: [{ ...feature, type: 'FeatureCollection' }] },
    { ...feed, features: [{ ...feature, properties: { ...feature.properties, type: null } }] },
    { ...feed, features: [{ ...feature, properties: { ...feature.properties, has_realtime_journey: 'yes' } }] },
    { ...feed, features: [{ ...feature, properties: { ...feature.properties, delay: '3' } }] },
  ]) assert.throws(() => parseTransitFeed(invalid));
});

const rawTrip = {
  fetchedAt: feed.fetchedAt, vehicleId: '515',
  route: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'GeometryCollection', geometries: [
      { type: 'LineString', coordinates: [[0, 0], [1000, 0]] },
      { type: 'MultiPoint', coordinates: [[0, 0], [10000, 10000]] },
      { type: 'GeometryCollection', geometries: [{ type: 'MultiLineString', coordinates: [
        [[2000, 0], [3000, 0]], [[5000, 0], [6000, 0]],
      ] }] },
    ],
  } }] },
  calls: [{ destination: 'Genève', operator: 'SBB', stations: [
    { stationName: '<script>alert(1)</script>', coordinate: [0, 0], platform: '2',
      departureTime: '2026-10-14T23:59:00+02:00', aimedDepartureTime: '2026-10-14T23:57:00+02:00', departureDelay: 'PT9H' },
    { stationName: 'Intermediate', coordinate: null, platform: null, cancelled: true },
    { stationName: 'Genève', coordinate: [1000, 1000], platform: 4,
      arrivalTime: '2026-10-15T00:12:30+02:00', aimedArrivalTime: '2026-10-15T00:10:00+02:00', arrivalDelay: 'PT0S' },
  ] }],
};

test('trip geometry recursively retains disconnected lines without drawing MultiPoint', () => {
  const trip = parseTrip(rawTrip);
  const expected: TransitPoint[][] = [[[0, 0], [1000, 0]], [[2000, 0], [3000, 0]], [[5000, 0], [6000, 0]]];
  assert.deepEqual(trip.lines, expected.map(line => line.map(mercatorToLatLng)));
  assert.equal(trip.destination, 'Genève');
  assert.equal(trip.operator, 'SBB');
  assert.equal(trip.vehicleId, '515');
});

test('trip stops preserve full sequence, plain names and overnight actual/scheduled times', () => {
  const trip = parseTrip(rawTrip);
  assert.equal(trip.stops.length, 3);
  assert.equal(trip.stops[0].name, '<script>alert(1)</script>');
  assert.equal(trip.stops[1].coordinate, null);
  assert.equal(trip.stops[1].arrivalAt, null);
  assert.equal(trip.stops[1].cancelled, true);
  assert.equal(trip.stops[2].platform, '4');
  assert.equal((Date.parse(trip.stops[0].departureAt!) - Date.parse(trip.stops[0].scheduledDepartureAt!)) / 60000, 2);
  assert.equal((Date.parse(trip.stops[2].arrivalAt!) - Date.parse(trip.stops[2].scheduledArrivalAt!)) / 60000, 2.5);
  assert.equal((Date.parse(trip.stops[2].arrivalAt!) - Date.parse(trip.stops[0].departureAt!)) / 60000, 13.5);
  const multiJourney = parseTrip({ ...rawTrip, calls: [...rawTrip.calls, { destination: 'Final', operator: 'Other', stations: [
    { stationName: 'Final', coordinate: [2000, 2000] },
  ] }] });
  assert.deepEqual(multiJourney.stops.map(stop => stop.name), ['<script>alert(1)</script>', 'Intermediate', 'Genève', 'Final']);
  assert.equal(multiJourney.destination, 'Final');
});

test('trip trust boundary rejects malformed routes, stop dates and optional coordinates', () => {
  for (const invalid of [null, {}, { ...rawTrip, fetchedAt: 'yesterday' }, { ...rawTrip, calls: {} },
    { ...rawTrip, calls: [{ stations: {} }] },
    { ...rawTrip, calls: [{ stations: [{ stationName: 'A', coordinate: [0, NaN] }] }] },
    { ...rawTrip, calls: [{ stations: [{ stationName: 'A', arrivalTime: 'bad' }] }] },
    { ...rawTrip, calls: [{ stations: [{ stationName: 12 }] }] },
    { ...rawTrip, route: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'MultiPoint', coordinates: [[0, NaN]] } }] } },
    { ...rawTrip, route: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'GeometryCollection', geometries: null } }] } },
  ]) assert.throws(() => parseTrip(invalid));
});
