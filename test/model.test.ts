import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyPeak, formatTime, populationChange } from '../app/model.ts';

test('weekday model returns to baseline and has a credible daytime peak', () => {
  assert.ok(Math.abs(populationChange(0)) < 100);
  assert.ok(populationChange(480) > 65_000);
  assert.ok(dailyPeak.value > 90_000);
  assert.ok(dailyPeak.minute >= 540 && dailyPeak.minute <= 900);
  assert.equal(formatTime(465), '07:45');
  assert.equal(formatTime(1440), '24:00');
});
