import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRailIndex, isTrainFeed, trainColor, trainMatches, trainPosition, type TrainFeed } from '../app/trains/train-data.ts';
import { csv } from '../scripts/generate-train-timetable.mjs';

test('train feeds validate current stop estimates and delay precision', () => {
  const feed: TrainFeed = { fetchedAt: '2026-09-19T08:00:00Z', publishedAt: '2026-09-19T07:59:30Z', feedVersion: '20260916', trains: [{
    tripId: 'trip', trainNumber: '515', line: 'IC1', cancelled: false,
    lastStation: { id: '8503000', name: 'Zürich HB', lat: 47, lon: 8, departedAt: '2026-09-19T08:01:00Z' },
    nextStation: { id: '8500010', name: 'Baden', lat: 48, lon: 9, scheduledAt: '2026-09-19T08:18:00Z', estimatedAt: '2026-09-19T08:21:00Z', delayMinutes: 3, event: 'departure' },
  }] };
  assert.equal(isTrainFeed(feed), true);
  for (const invalid of [null, {}, { ...feed, fetchedAt: 'bad' }, { ...feed, trains: [{ ...feed.trains[0], nextStation: { ...feed.trains[0].nextStation, event: 'passing' } }] }]) {
    assert.equal(isTrainFeed(invalid), false);
  }
  assert.deepEqual(trainPosition(feed.trains[0], Date.parse('2026-09-19T08:06:00Z')), [47, 8]);
  assert.deepEqual(trainPosition(feed.trains[0], Date.parse('2026-09-19T08:16:00Z')), [48, 9]);
  const localTrain = { ...feed.trains[0], lastStation: { ...feed.trains[0].lastStation!, lat: 47, lon: 8 },
    nextStation: { ...feed.trains[0].nextStation, lat: 47.1, lon: 8.1 } };
  const rail = buildRailIndex([[[47, 8], [47, 8.1], [47.1, 8.1]]]);
  const firstPosition = trainPosition(localTrain, Date.parse('2026-09-19T08:06:00Z'), rail);
  const secondPosition = trainPosition(localTrain, Date.parse('2026-09-19T08:16:00Z'), rail);
  assert.notDeepEqual(firstPosition, secondPosition);
  assert.equal(firstPosition[0] === 47 || firstPosition[1] === 8.1, true, 'Position stays on rail geometry');
  assert.deepEqual(trainPosition({ ...feed.trains[0], lastStation: null }, 0), [48, 9]);
  assert.deepEqual([trainColor(0), trainColor(3), trainColor(6), trainColor(0, true)], ['#0f766e', '#b7791f', '#c2413f', '#6d6d6d']);
  assert.equal(trainMatches(feed.trains[0], 'ic1'), true);
  assert.equal(trainMatches(feed.trains[0], '515'), true);
  assert.equal(trainMatches(feed.trains[0], 'baden'), true);
  assert.equal(trainMatches(feed.trains[0], 'ic1 51'), true);
  assert.equal(trainMatches(feed.trains[0], 'baden ic1'), true);
  assert.equal(trainMatches({ ...feed.trains[0], nextStation: { ...feed.trains[0].nextStation, name: 'Genève' } }, 'GENEVE'), true);
  assert.equal(trainMatches(feed.trains[0], 'geneva'), false);
});

test('GTFS CSV parser preserves quoted commas and escaped quotes', () => {
  assert.deepEqual(csv('"trip","Genève, gare","say ""hello"""\r'), ['trip', 'Genève, gare', 'say "hello"']);
});
