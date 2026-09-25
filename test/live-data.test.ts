import test from 'node:test';
import assert from 'node:assert/strict';
import { isLiveFeed, measuredMinute, minuteReading, stationHasCount, stationStatus, stationVolume, volumeColor, markerOpacity, readingStatus, litOpacity, missingOpacity, type LiveFeed, type Reading, type Station } from '../app/live/live-data.ts';

test('the map shows one measured minute and ignores readings reported for other minutes', () => {
  const minute = Date.parse('2026-09-10T14:30:00Z');
  const reading: Reading = { at: '2026-09-10T14:30:00Z', light: 0, heavy: null, lightSpeed: null, heavySpeed: null };
  assert.equal(minuteReading(reading, minute), reading, 'A measured zero is still a reading');
  assert.equal(minuteReading({ ...reading, at: '2026-09-10T14:29:00Z' }, minute), null, 'The previous minute is a different minute');
  assert.equal(minuteReading({ ...reading, at: '2026-09-10T14:30:58Z' }, minute)?.at, '2026-09-10T14:30:58Z', 'A timestamp inside the minute belongs to it');
  assert.equal(minuteReading({ ...reading, at: 'invalid' }, minute), null);
  assert.equal(minuteReading({ ...reading, light: null }, minute), null, 'A reading with no count is not a reading');
  assert.equal(minuteReading(null, minute), null);
  const station: Station = { id: 'CH:0001', lat: 47, lon: 8, detectors: [
    { id: 'CH:0001.01', lane: 'lane1', direction: 'positive', reading },
    { id: 'CH:0001.02', lane: 'lane1', direction: 'negative', reading: { ...reading, at: '2026-09-10T14:29:00Z' } },
  ] };
  const previous: Station = { ...station, detectors: [station.detectors[1]] };
  assert.equal(stationHasCount(station, minute), true);
  assert.equal(stationHasCount(previous, minute), false, 'Only the displayed minute counts as data');
  assert.equal(measuredMinute([previous]), minute - 60_000, 'The newest reported minute becomes the displayed minute');
  assert.equal(measuredMinute([{ ...previous, detectors: [{ ...station.detectors[0], reading: null }] }]), 0, 'No readings means no displayed minute');
  assert.equal(measuredMinute([]), 0);
});

test('status labels stay inside the displayed minute and name the source error', () => {
  const minute = Date.parse('2026-09-10T14:30:00Z');
  const reading: Reading = { at: '2026-09-10T14:30:00Z', light: 9, heavy: 0, lightSpeed: 70, heavySpeed: null };
  const detector = { id: 'CH:0001.01', lane: 'lane1', direction: 'positive', reading };
  const station: Station = { id: 'CH:0001', lat: 47, lon: 8, detectors: [detector] };
  assert.equal(readingStatus(null, minute), 'No reading for this minute');
  assert.equal(readingStatus({ ...reading, at: '2026-09-10T14:29:00Z' }, minute), 'No reading for this minute');
  assert.equal(readingStatus({ ...reading, error: 'VD_OFFLINE', light: null, heavy: null }, minute), 'Detector offline');
  assert.equal(readingStatus({ ...reading, error: 'SENSOR_ERROR', light: null, heavy: null }, minute), 'Sensor error');
  assert.equal(readingStatus({ ...reading, light: null }, minute), 'Partial count');
  assert.equal(stationStatus(station, minute), 'Partial count', 'A complete count that cannot be totalled is partial');
  assert.equal(stationStatus({ ...station, detectors: [{ ...detector, reading: { ...reading, light: null, heavy: null, error: 'VD_OFFLINE' } }] }, minute), 'Detector offline');
  assert.equal(stationStatus({ ...station, detectors: [
    { ...detector, reading: { ...reading, light: null, heavy: null, error: 'VD_OFFLINE' } },
    { ...detector, reading: null },
  ] }, minute), 'Mixed detector status');
});

test('live feed validation rejects shapes the map cannot draw', () => {
  const reading: Reading = { at: '2026-09-10T14:30:00Z', light: 12, heavy: 2, lightSpeed: 70, heavySpeed: 60 };
  const detector = { id: 'CH:0001.01', lane: 'lane1', direction: 'positive', reading };
  const feed: LiveFeed = { fetchedAt: '2026-09-10T14:31:20Z', publishedAt: '2026-09-10T14:31:18Z', intervalSeconds: 60, source: 'ASTRA / FEDRO',
    stations: [{ id: 'CH:0001', lat: 47, lon: 8, detectors: [detector] }] };
  const withReading = (value: unknown) => ({ ...feed, stations: [{ ...feed.stations[0], detectors: [{ ...detector, reading: value }] }] });
  assert.equal(isLiveFeed(feed), true);
  assert.equal(isLiveFeed(withReading({ ...reading, error: 'VD_OFFLINE' })), true);
  assert.equal(isLiveFeed(withReading(null)), true);
  for (const invalid of [null, {}, { ...feed, intervalSeconds: 300 }, { ...feed, source: 7 }, { ...feed, fetchedAt: 'invalid' },
    { ...feed, publishedAt: 'invalid' }, { ...feed, stations: {} }, { ...feed, stations: [{ ...feed.stations[0], lat: 91 }] },
    { ...feed, stations: [{ ...feed.stations[0], lon: 181 }] }, { ...feed, stations: [{ ...feed.stations[0], detectors: [{ id: 'a' }] }] },
    withReading({ ...reading, at: 'invalid' }), withReading({ light: -1 }), withReading({ light: 1.5 }), withReading({ heavy: '4' }),
    withReading({ lightSpeed: -3 }), withReading({ heavySpeed: '70' }), withReading({ error: 'constructor' }), withReading({ error: 'MADE_UP' })]) {
    assert.equal(isLiveFeed(invalid), false, `Reject ${JSON.stringify(invalid).slice(0, 70)}`);
  }
});

test('volume colours use the busiest complete detector without summing across sensors', () => {
  const minute = Date.parse('2026-09-10T14:30:00Z');
  const reading: Reading = { at: '2026-09-10T14:30:00Z', light: 12, heavy: 2, lightSpeed: null, heavySpeed: null };
  const station: Station = { id: 'test', lat: 47, lon: 8, detectors: [
    { id: 'a', lane: '', direction: '', reading },
    { id: 'b', lane: '', direction: '', reading: { ...reading, light: 20 } },
    { id: 'partial', lane: '', direction: '', reading: { ...reading, light: 40, heavy: null } },
  ] };
  assert.equal(stationVolume(station, minute), 22);
  assert.equal(stationVolume({ ...station, detectors: station.detectors.map(detector => ({ ...detector, reading: detector.reading && { ...detector.reading, at: '2026-09-10T14:29:00Z' } })) }, minute), null, 'Another minute contributes nothing');
  station.detectors = [{ ...station.detectors[0], reading: { ...reading, light: 0, heavy: 0 } }];
  assert.equal(stationVolume(station, minute), 0);
  station.detectors[0].reading!.heavy = null;
  assert.equal(stationVolume(station, minute), null);
  assert.deepEqual([0, 9, 10, 19, 20, 29, 30, 100, null].map(volumeColor),
    ['#2d8656', '#2d8656', '#b39a24', '#b39a24', '#e18a25', '#e18a25', '#c93d36', '#c93d36', '#a3a3a3']);
});

test('markers dim once per counted vehicle per minute and stay lit without a rate', () => {
  const midpoint = (litOpacity + 0.18) / 2;
  const dimsPerMinute = (volume: number) => {
    let dims = 0;
    let lit = false;
    for (let ms = 0; ms < 60_000; ms += 5) {
      const next = markerOpacity(volume, ms) > midpoint;
      if (next && !lit) dims++;
      lit = next;
    }
    return dims;
  };
  for (const volume of [1, 2, 5, 17, 60, 119, 120]) assert.equal(dimsPerMinute(volume), volume, `${volume} vehicles a minute must dim ${volume} times`);
  for (const [volume, sample] of [[121, 0], [300, 250], [4000, 333]]) {
    assert.equal(markerOpacity(volume, sample), markerOpacity(120, sample), 'Blinking must stop at two per second');
  }
  assert.equal(dimsPerMinute(121), 120);
  assert.equal(markerOpacity(5, 0), 0.18, 'A dimmed marker sits at rest, not invisible');
  assert.equal(markerOpacity(5, 6000), litOpacity, 'Half a period into the blink the marker is lit');
  assert.equal(markerOpacity(0, 1234), litOpacity, 'A measured zero has nothing to blink');
  assert.equal(markerOpacity(null, 1234), missingOpacity, 'A station without a complete count keeps its grey colour');
  assert.equal(markerOpacity(5, null), litOpacity, 'Missing elapsed time keeps every marker steady for reduced motion');
  for (let ms = 0; ms < 30_000; ms += 7) {
    const opacity = markerOpacity(37, ms);
    assert.ok(opacity >= 0.18 && opacity <= litOpacity, 'Blinking must stay between rest and lit');
  }
});
