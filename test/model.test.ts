import test from 'node:test';
import assert from 'node:assert/strict';
import { cities, cityBySlug } from '../app/cities.ts';
import { corridors, dataSummary } from '../app/data/geneva.ts';
import { arrivalBlip, createDailyModel, createJourneyModel, flowAt, formatTime, selectModelModes, transportModes } from '../app/model.ts';
import { aggregateFlows, commuteModeShares, residentModeShares, splitModes } from '../app/data/create-city-data.ts';
import { departureShare } from '../app/road-flow.ts';
import { prepareMapData, prepareMapDataAsync } from '../app/map-data.ts';
import { encodePolyline, routeKey } from '../app/route-geometry.ts';

test('synchronous and incremental maps preserve the routed cohort and support cancellation', async () => {
  const origin = { code: 'CH1', name: 'Home', lat: 46, lon: 6 };
  const target = { code: 'CH2', name: 'Work', lat: 46, lon: 6.01 };
  const routed = { origin, target, commuters: 75, mode: 'car' as const, direction: 'inbound' as const, source: 'test' };
  const missing = { ...routed, origin: { ...origin, code: 'CH3', name: 'Unrouted' }, commuters: 1000 };
  const route = { shape: encodePolyline([[46, 6], [46, 6.01]], 6), seconds: 60, steps: [[1, 60, '']] as [number, number, string][] };
  const cache = {
    [routeKey('test', routed)]: { locations: [46, 6, 46, 6.01], toWork: route, toHome: { ...route, shape: encodePolyline([[46, 6.01], [46, 6]], 6) } },
  };
  const data = prepareMapData([routed, missing], 'test', cache, undefined, {});
  const controller = new AbortController();
  assert.deepEqual(await prepareMapDataAsync(controller.signal, [routed, missing], 'test', cache, undefined, {}), data);
  controller.abort();
  await assert.rejects(prepareMapDataAsync(controller.signal, [routed, missing], 'test', cache), { name: 'AbortError' });
  assert.deepEqual(data.journeys.map(j => j.corridor), [routed]);
  assert.deepEqual(data.communeNodes.map(n => [n.point.code, n.byMode.car]), [['CH1', 75]]);
  assert.equal(data.dots.reduce((n, dot) => n + dot.weight, 0), 75);
});

test('audit fixes conserve OD modes, merged communes and route arrival accounting', () => {
  const a = { code: 'CH230', name: 'Winterthur', lat: 47.5, lon: 8.72 };
  const b = { code: 'CH261', name: 'Zürich', lat: 47.38, lon: 8.54 };
  assert.equal(splitModes(11129, residentModeShares(a)).reduce((n, [, count]) => n + count, 0), 11129);
  assert.throws(() => splitModes(-1, { car: 1, transit: 0, soft: 0 }));
  assert.deepEqual(aggregateFlows([['CH6407', 'Corcelles', 47, 6.8, 10], ['CH6458', 'Neuchâtel', 47, 6.9, 20]])[0],
    ['CH6458', 'Neuchâtel', 46.992, 6.9311, 30]);
  const corridor = { origin: a, target: b, commuters: 100, mode: 'car' as const, direction: 'inbound' as const, source: 'test' };
  const inbound = createJourneyModel([{ corridor, duration: 30, returnDuration: 40 }]);
  const outbound = createJourneyModel([{ corridor: { ...corridor, direction: 'outbound' }, duration: 30, returnDuration: 40 }]);
  for (const minute of [0, 350, 450, 720, 950, 1050, 1440]) {
    assert.equal(inbound.populationChange(minute), Math.round(100 * (departureShare(minute - 30) - departureShare(minute, true))));
    assert.equal(outbound.populationChange(minute), Math.round(100 * (-departureShare(minute) + departureShare(minute - 40, true))));
    assert.equal(inbound.travelling(minute), Math.round(100 * (departureShare(minute) - departureShare(minute - 30) + departureShare(minute, true) - departureShare(minute - 40, true))));
  }
  assert.equal(createJourneyModel([{ corridor, duration: 30, returnDuration: 40 }], []).populationChange(720), 0);
  for (const a of cities.filter(c => c.slug !== 'geneva')) for (const b of cities.filter(c => c.slug !== 'geneva' && c !== a)) {
    const outgoing = a.data!.corridors.filter(c => c.direction === 'outbound' && c.target.code === b.centre.code);
    const incoming = b.data!.corridors.filter(c => c.direction === 'inbound' && c.origin.code === a.centre.code);
    if (outgoing.length && incoming.length) for (const mode of transportModes) {
      assert.equal(outgoing.filter(c => c.mode === mode).reduce((n, c) => n + c.commuters, 0), incoming.filter(c => c.mode === mode).reduce((n, c) => n + c.commuters, 0), `${a.slug} → ${b.slug}: ${mode}`);
    }
  }
});

const model = createDailyModel(cityBySlug.geneva.model!);

test('mode selections conserve each city total and an empty selection clears population', () => {
  for (const city of cities) {
    const config = city.model!;
    const corridors = city.data!.corridors;
    const selected = selectModelModes(config, corridors, transportModes);
    if (!corridors.some(c => c.mode === 'unknown')) assert.equal(selected, config);
    const none = createDailyModel(selectModelModes(config, corridors, []));
    assert.ok(none.populationSeries.every((p) => p.value === 0));
    assert.equal(none.dailyAverage, 0);
    const singles = transportModes.map((mode) => selectModelModes(config, corridors, [mode]));
    for (const [i, group] of selected.populationGroups.entries()) {
      assert.ok(Math.abs(singles.reduce((sum, single) => sum + single.populationGroups[i].people, 0) - group.people) < 0.000001);
    }
    const all = createDailyModel(selected);
    const models = singles.map(createDailyModel);
    for (const { minute, value } of all.populationSeries) {
      assert.ok(Math.abs(models.reduce((sum, m) => sum + m.populationChange(minute), 0) - value) <= 2);
    }
  }
  const geneva = cityBySlug.geneva;
  const car = selectModelModes(geneva.model!, geneva.data!.corridors, ['car']);
  assert.notEqual(car.populationGroups[0].people / geneva.model!.populationGroups[0].people,
    car.populationGroups[1].people / geneva.model!.populationGroups[1].people,
    'French and Swiss arrivals have different estimated transport mixes');
});

test('Vaud–Geneva uses commuting evidence and does not turn other modes into bikes', () => {
  const vaud = { code: 'CH5586', name: 'Lausanne', lat: 46.52, lon: 6.63 };
  const geneva = { code: 'CH6621', name: 'Genève', lat: 46.2, lon: 6.15 };
  assert.deepEqual(Object.fromEntries(splitModes(23684, commuteModeShares(vaud, geneva))), { car: 9389, transit: 13437, unknown: 858 });
  assert.deepEqual(Object.fromEntries(splitModes(7501, commuteModeShares(geneva, vaud))), { car: 2561, transit: 4419, unknown: 521 });
  const unknown = { origin: vaud, target: geneva, mode: 'unknown' as const, commuters: 100, direction: 'inbound' as const, source: 'test' };
  const model = createJourneyModel([{ corridor: unknown, duration: 60, returnDuration: 60 }]);
  assert.equal(model.travelling(465), 0);
  assert.equal(model.dailyPeak.value, 0);
});

test('weekday model returns to baseline and has a credible daytime peak', () => {
  assert.ok(Math.abs(model.populationChange(0)) < 100);
  assert.ok(model.populationChange(480) > 65_000);
  assert.ok(model.dailyPeak.value > 90_000);
  assert.ok(model.dailyPeak.minute >= 540 && model.dailyPeak.minute <= 900);
  assert.equal(
    model.dailyAverage,
    Math.round(model.populationSeries.slice(0, -1).reduce((sum, point) => sum + point.value, 0) /
      (model.populationSeries.length - 1)),
  );
  assert.ok(model.populationChange(0) - model.dailyAverage < 0);
  assert.ok(model.dailyPeak.value - model.dailyAverage > 0);
  assert.equal(formatTime(465), '07:45');
  assert.equal(formatTime(465.9), '07:45');
  assert.equal(formatTime(1440), '24:00');
});

test('flow direction switches between the morning and evening journeys', () => {
  assert.deepEqual(flowAt(330, 300, 900, 60), { direction: 'inbound', progress: 0.5, reverse: false });
  assert.deepEqual(flowAt(930, 300, 900, 60), { direction: 'outbound', progress: 0.5, reverse: true });
  assert.deepEqual(flowAt(330, 300, 900, 60, 'outbound'), { direction: 'outbound', progress: 0.5, reverse: false });
  assert.deepEqual(flowAt(930, 300, 900, 60, 'outbound'), { direction: 'inbound', progress: 0.5, reverse: true });
  assert.equal(flowAt(700, 300, 900, 60), null);
  assert.equal(arrivalBlip(0.8), 0);
  assert.ok(Math.abs(arrivalBlip(0.9) - 0.5) < 0.0001);
  assert.ok(Math.abs(arrivalBlip(1) - 1) < 0.0001);
});

test('commune markers dim while commuters are away and recover in the evening', () => {
  assert.ok(model.commutersAtHomeShare(0) > 0.99);
  assert.ok(model.commutersAtHomeShare(720) < 0.05);
  assert.ok(model.commutersAtHomeShare(1430) > 0.99);
});

test('commune data matches its published totals and contains valid routes', () => {
  assert.equal(corridors.length, dataSummary.corridors);
  assert.equal(new Set(corridors.map(c => c.direction === 'inbound' ? c.origin.code : c.target.code)).size, dataSummary.originCommunes);
  assert.ok(corridors.every(({ commuters, origin, target }) =>
    commuters > 0 && [origin.lat, origin.lon, target.lat, target.lon].every(Number.isFinite)));
  assert.equal(
    corridors.filter(({ direction }) => direction === 'inbound').reduce((sum, { commuters }) => sum + commuters, 0),
    dataSummary.frenchCommuters2023 + dataSummary.mappedVaudToGeneva2024,
  );
  assert.equal(
    corridors.filter(({ direction }) => direction === 'outbound').reduce((sum, { commuters }) => sum + commuters, 0),
    dataSummary.mappedGenevaToVaud2024,
  );
});

test('city routes are unique and all publish checked data', () => {
  assert.deepEqual(cities.map(({ slug }) => slug), [
    'zurich',
    'geneva',
    'basel',
    'lausanne',
    'bern',
    'winterthur',
    'lucerne',
    'st-gallen',
    'lugano',
    'biel-bienne',
    'schaffhausen',
    'la-chaux-de-fonds',
    'chiasso', 'mendrisio', 'zug', 'neuchatel',
  ]);
  assert.equal(new Set(cities.map(({ slug }) => slug)).size, cities.length);
  assert.deepEqual(cities.filter(({ data, model }) => data && model).map(({ slug }) => slug), cities.map(({ slug }) => slug));
  for (const city of cities) {
    assert.ok(city.data!.corridors.length > 0);
    assert.equal(city.data!.corridors.length, city.data!.summary.corridors);
    assert.ok(city.data!.corridors.every(({ commuters, origin, target }) =>
      commuters > 0 && [origin.lat, origin.lon, target.lat, target.lon].every(Number.isFinite)));
    if (city.data!.summary.borderWorkers2025 !== undefined) {
      const crossBorderWorkers = city.data!.corridors
        .filter((corridor) => !(corridor.direction === 'inbound' ? corridor.origin : corridor.target).code.startsWith('CH'))
        .reduce((sum, corridor) => sum + corridor.commuters, 0);
      assert.equal(crossBorderWorkers, city.data!.summary.borderWorkers2025);
    }
  }
});
