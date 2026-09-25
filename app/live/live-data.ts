export type LiveCity = { slug: string; displayName: string; centre: { lat: number; lon: number } };
export const sourceErrors = {
  EMPTY_RESPONSE: 'Source offline', PRV_OFFLINE: 'Source offline', AGG_OFFLINE: 'Source offline',
  VD_OFFLINE: 'Detector offline', VD_ERROR: 'Detector error', SENSOR_ERROR: 'Sensor error',
  SENSOR_WWD: 'Wrong-direction flag', INVALID: 'No usable count',
};
export type SourceError = keyof typeof sourceErrors;
export type Reading = { at: string; light: number | null; heavy: number | null; lightSpeed: number | null; heavySpeed: number | null; error?: SourceError | null };
export type Detector = { id: string; lane: string; direction: string; reading: Reading | null };
export type Station = { id: string; name?: string; road?: string; lat: number; lon: number; detectors: Detector[] };
export type LiveFeed = { fetchedAt: string; publishedAt: string; intervalSeconds: number; source: string; stations: Station[] };

function isReading(value: unknown): value is Reading {
  const reading = value as Reading | null;
  if (!reading || typeof reading !== 'object' || !Number.isFinite(Date.parse(reading.at))) return false;
  for (const count of [reading.light, reading.heavy]) {
    if (count !== null && !(typeof count === 'number' && Number.isInteger(count) && count >= 0)) return false;
  }
  for (const speed of [reading.lightSpeed, reading.heavySpeed]) {
    if (speed !== null && !(typeof speed === 'number' && Number.isFinite(speed) && speed >= 0)) return false;
  }
  return reading.error === undefined || reading.error === null ||
    (typeof reading.error === 'string' && Object.hasOwn(sourceErrors, reading.error));
}

export function isLiveFeed(value: unknown): value is LiveFeed {
  const feed = value as LiveFeed | null;
  return !!feed && typeof feed === 'object' && feed.intervalSeconds === 60 && typeof feed.source === 'string' &&
    Number.isFinite(Date.parse(feed.fetchedAt)) && Number.isFinite(Date.parse(feed.publishedAt)) && Array.isArray(feed.stations) &&
    feed.stations.every(station => !!station && typeof station.id === 'string' && Number.isFinite(station.lat) && Math.abs(station.lat) <= 90 &&
      Number.isFinite(station.lon) && Math.abs(station.lon) <= 180 && Array.isArray(station.detectors) &&
      station.detectors.every(detector => !!detector && typeof detector.id === 'string' &&
        (detector.reading === null || isReading(detector.reading))));
}

// The map shows one measured minute: the newest minute reported anywhere in the feed, or 0 without readings.
export function measuredMinute(stations: Station[]): number {
  let minute = 0;
  for (const station of stations) for (const detector of station.detectors) {
    const at = detector.reading ? Date.parse(detector.reading.at) : NaN;
    if (Number.isFinite(at)) minute = Math.max(minute, Math.floor(at / 60_000) * 60_000);
  }
  return minute;
}

// A reading counts for the displayed minute only when the source reports that same minute.
export function minuteReading(reading: Reading | null, minute: number): Reading | null {
  if (!reading || !Number.isFinite(Date.parse(reading.at))) return null;
  return Math.floor(Date.parse(reading.at) / 60_000) * 60_000 === minute && (reading.light !== null || reading.heavy !== null) ? reading : null;
}

export function stationHasCount(station: Station, minute: number): boolean {
  return station.detectors.some(({ reading }) => minuteReading(reading, minute) !== null);
}

export function stationVolume(station: Station, minute: number): number | null {
  let volume: number | null = null;
  for (const detector of station.detectors) {
    const reading = minuteReading(detector.reading, minute);
    if (!reading || reading.light === null || reading.heavy === null) continue;
    volume = Math.max(volume ?? 0, reading.light + reading.heavy);
  }
  return volume;
}

export function readingStatus(reading: Reading | null, minute: number): string {
  if (!reading || !Number.isFinite(Date.parse(reading.at))) return 'No reading for this minute';
  if (Math.floor(Date.parse(reading.at) / 60_000) * 60_000 !== minute) return 'No reading for this minute';
  return reading.error ? sourceErrors[reading.error] : 'Partial count';
}

export function stationStatus(station: Station, minute: number): string {
  if (stationHasCount(station, minute)) return 'Partial count';
  const statuses = new Set(station.detectors.map(detector => readingStatus(detector.reading, minute)));
  return statuses.size === 1 ? [...statuses][0] : 'Mixed detector status';
}

// A station at rest, at its brightest, and without a complete count for the displayed minute.
export const restOpacity = 0.18;
export const litOpacity = 0.95;
export const missingOpacity = 0.55;
// Blinking stops at two per second: WCAG 2.3.1 allows at most three general flashes per second.
export const maxBlinksPerMinute = 120;

// Markers dim once per counted vehicle per minute: five vehicles per minute means five dims per minute.
// A null elapsed time keeps every marker steady, which is what reduced-motion visitors get.
export function markerOpacity(volume: number | null, elapsedMs: number | null): number {
  if (volume === null) return missingOpacity;
  if (elapsedMs === null || volume === 0) return litOpacity;
  const period = 60_000 / Math.min(volume, maxBlinksPerMinute);
  const phase = (elapsedMs % period) / period;
  const edge = 0.1; // Share of a period spent fading between dim and lit.
  const fromEdge = Math.min(phase, 1 - phase);
  const lit = Math.min(1, Math.max(0, (fromEdge - edge / 2) / (edge / 2)));
  return restOpacity + (litOpacity - restOpacity) * lit;
}

export function volumeColor(volume: number | null): string {
  return volume === null ? '#a3a3a3' : volume >= 30 ? '#c93d36' : volume >= 20 ? '#e18a25' : volume >= 10 ? '#b39a24' : '#2d8656';
}
