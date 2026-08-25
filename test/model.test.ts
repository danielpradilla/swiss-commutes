import test from 'node:test';
import assert from 'node:assert/strict';
import { corridors, dataSummary } from '../app/commutes.ts';
import { arrivalBlip, commutersAtHomeShare, dailyPeak, flowAt, formatTime, populationChange } from '../app/model.ts';

test('weekday model returns to baseline and has a credible daytime peak', () => {
  assert.ok(Math.abs(populationChange(0)) < 100);
  assert.ok(populationChange(480) > 65_000);
  assert.ok(dailyPeak.value > 90_000);
  assert.ok(dailyPeak.minute >= 540 && dailyPeak.minute <= 900);
  assert.equal(formatTime(465), '07:45');
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
  assert.ok(commutersAtHomeShare(0) > 0.99);
  assert.ok(commutersAtHomeShare(720) < 0.05);
  assert.ok(commutersAtHomeShare(1430) > 0.99);
});

test('commune data matches its published totals and contains valid routes', () => {
  assert.equal(corridors.length, dataSummary.corridors);
  assert.equal(new Set(corridors.map(({ origin }) => origin.code)).size, dataSummary.originCommunes);
  assert.ok(corridors.every(({ commuters, origin, target }) =>
    commuters > 0 && [origin.lat, origin.lon, target.lat, target.lon].every(Number.isFinite)));
  assert.equal(
    corridors.filter(({ direction }) => direction === 'inbound').reduce((sum, { commuters }) => sum + commuters, 0),
    dataSummary.frenchCommuters2023 + dataSummary.vaudToGeneva2024,
  );
  assert.equal(
    corridors.filter(({ direction }) => direction === 'outbound').reduce((sum, { commuters }) => sum + commuters, 0),
    dataSummary.genevaToVaud2024,
  );
});
