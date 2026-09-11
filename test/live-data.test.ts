import test from 'node:test';
import assert from 'node:assert/strict';
import { currentReading, stationIsCurrent, stationVolume, volumeColor, isReplayFeed, replayStations, availableFrameIndices, frameCollected, detectorStatus, stationStatus, type Reading, type Station, type ReplayFeed } from '../app/live/live-data.ts';

test('live readings preserve measured zero and expire independently of fetching', () => {
  const now = Date.parse('2026-09-10T14:31:20Z');
  const reading: Reading = { at: '2026-09-10T14:30:00Z', light: 0, heavy: null, lightSpeed: null, heavySpeed: null };
  assert.equal(currentReading(reading, now, 180), reading);
  assert.equal(currentReading(reading, now + 101_000, 180), null);
  assert.equal(currentReading({ ...reading, at: 'invalid' }, now, 180), null);
  assert.equal(currentReading({ ...reading, at: '2026-09-10T14:32:00Z' }, now, 180), null);
  assert.equal(currentReading({ ...reading, light: null }, now, 180), null);
  assert.equal(currentReading(null, now, 180), null);
  assert.equal(stationIsCurrent({ id: 'CH:0001', lat: 47, lon: 8, detectors: [
    { id: 'CH:0001.01', lane: 'lane1', direction: 'positive', reading },
    { id: 'CH:0001.02', lane: 'lane1', direction: 'negative', reading: null },
  ] }, now, 180), true);
});

test('replay uses the selected minute, validates its window and never fills gaps with latest readings', () => {
  const generated = Date.parse('2026-09-10T14:31:20Z');
  const latest: Reading = { at: '2026-09-10T14:30:00Z', light: 50, heavy: 1, lightSpeed: 70, heavySpeed: 60 };
  const feed: ReplayFeed = { generatedAt: new Date(generated).toISOString(), collectedAt: new Date(generated).toISOString(), intervalSeconds: 60,
    stations: [{ id: 'test', lat: 47, lon: 8, detectors: [{ id: 'a', lane: '', direction: '', reading: latest }] }],
    frames: Array.from({ length: 30 }, (_, index) => ({ at: new Date(Date.parse('2026-09-10T14:01:00Z') + index * 60_000).toISOString(), readings: {} })),
  };
  feed.frames[0].readings.a = [0, 0, null, null];
  feed.frames[29].readings.a = [50, 1, 70, 60];
  feed.frames[2].readings.otherCity = [9, 0, null, null];
  feed.frames[3].readings.a = [9, null, null, null];
  assert.deepEqual(availableFrameIndices(feed, new Set(['a'])), [0, 29], 'Skip local gaps and incomplete totals, but preserve measured zero');
  assert.deepEqual(availableFrameIndices(feed, new Set(['otherCity'])), [2], 'Availability follows the map view');
  assert.deepEqual(availableFrameIndices(feed, new Set(['offline'])), [], 'An entirely empty view has no frames to play');
  assert.equal(isReplayFeed(feed), true);
  assert.equal(replayStations(feed, 0)[0].detectors[0].reading!.light, 0);
  assert.equal(stationVolume(replayStations(feed, 0)[0], Date.parse(feed.frames[0].at), 0), 0);
  assert.equal(replayStations(feed, 1)[0].detectors[0].reading, null);
  assert.equal(replayStations(feed, 29)[0].detectors[0].reading!.light, 50);
  assert.equal(replayStations(feed, 30)[0].detectors[0].reading, null);
  const missing = feed.frames[1];
  assert.equal(detectorStatus(replayStations(feed, 1)[0].detectors[0], missing), 'Minute not collected');
  missing.collected = true;
  missing.errors = { a: 'VD_OFFLINE' };
  assert.equal(isReplayFeed(feed), true);
  assert.equal(frameCollected(missing), true);
  const offline = replayStations(feed, 1)[0];
  assert.equal(stationVolume(offline, Date.parse(missing.at), 0), null);
  assert.equal(stationStatus(offline, missing), 'Detector offline');
  assert.equal(replayStations(feed, 2)[0].detectors[0].reading, null, 'Do not carry an offline flag into another minute');
  missing.errors = { a: 'SENSOR_ERROR' };
  assert.equal(detectorStatus(replayStations(feed, 1)[0].detectors[0], missing), 'Sensor error');
  missing.errors = {};
  assert.equal(detectorStatus(replayStations(feed, 1)[0].detectors[0], missing), 'No source reading');
  for (const errors of [{ a: 'unknown' }, { a: 'constructor' }, [], null]) {
    assert.equal(isReplayFeed({ ...feed, frames: feed.frames.map((frame, i) => i === 1 ? { ...frame, errors } : frame) }), false);
  }
  for (const invalid of [null, {}, { ...feed, frames: feed.frames.slice(1) }, { ...feed, generatedAt: 'invalid' }]) assert.equal(isReplayFeed(invalid), false);
  feed.frames[1].at = feed.frames[0].at;
  assert.equal(isReplayFeed(feed), false);
  feed.frames[1].at = '2026-09-10T14:02:00Z';
  feed.frames[0].readings.a[0] = -1;
  assert.equal(isReplayFeed(feed), false);
  feed.frames[0].readings.a[0] = 1.5;
  assert.equal(isReplayFeed(feed), false);
});

test('volume colours use the busiest complete detector without summing across sensors', () => {
  const now = Date.parse('2026-09-10T14:31:20Z');
  const reading: Reading = { at: '2026-09-10T14:30:00Z', light: 12, heavy: 2, lightSpeed: null, heavySpeed: null };
  const station: Station = { id: 'test', lat: 47, lon: 8, detectors: [
    { id: 'a', lane: '', direction: '', reading },
    { id: 'b', lane: '', direction: '', reading: { ...reading, light: 20 } },
    { id: 'partial', lane: '', direction: '', reading: { ...reading, light: 40, heavy: null } },
  ] };
  assert.equal(stationVolume(station, now, 180), 22);
  assert.equal(stationVolume(station, now + 101_000, 180), null);
  station.detectors = [{ ...station.detectors[0], reading: { ...reading, light: 0, heavy: 0 } }];
  assert.equal(stationVolume(station, now, 180), 0);
  station.detectors[0].reading!.heavy = null;
  assert.equal(stationVolume(station, now, 180), null);
  assert.deepEqual([0, 9, 10, 19, 20, 29, 30, 100, null].map(volumeColor),
    ['#2d8656', '#2d8656', '#b39a24', '#b39a24', '#e18a25', '#e18a25', '#c93d36', '#c93d36', '#a3a3a3']);
});
