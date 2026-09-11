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
export type LiveFeed = { fetchedAt: string; publishedAt: string; maxAgeSeconds: number; intervalSeconds: number; source: string; stations: Station[] };
export type ReplayFrame = { at: string; readings: Record<string, [number | null, number | null, number | null, number | null]>; collected?: boolean; errors?: Record<string, SourceError> };
export type ReplayFeed = { generatedAt: string; collectedAt: string | null; intervalSeconds: number; stations: Station[]; frames: ReplayFrame[] };

export function isReplayFeed(value: unknown): value is ReplayFeed {
  const data = value as ReplayFeed | null;
  if (!data || data.intervalSeconds !== 60 || !Array.isArray(data.stations) || !Array.isArray(data.frames) || data.frames.length !== 30 ||
      !Number.isFinite(Date.parse(data.generatedAt)) || (data.collectedAt !== null && !Number.isFinite(Date.parse(data.collectedAt)))) return false;
  if (!data.stations.every(station => station && typeof station.id === 'string' && Number.isFinite(station.lat) && Math.abs(station.lat) <= 90 &&
      Number.isFinite(station.lon) && Math.abs(station.lon) <= 180 && Array.isArray(station.detectors) &&
      station.detectors.every(detector => detector && typeof detector.id === 'string'))) return false;
  const start = Math.floor(Date.parse(data.generatedAt) / 60_000) * 60_000 - 30 * 60_000;
  return data.frames.every((frame, index) => frame && Date.parse(frame.at) === start + index * 60_000 && frame.readings &&
    (frame.collected === undefined || typeof frame.collected === 'boolean') &&
    (frame.errors === undefined || (frame.errors && typeof frame.errors === 'object' && !Array.isArray(frame.errors) &&
      Object.values(frame.errors).every(error => typeof error === 'string' && Object.hasOwn(sourceErrors, error)))) &&
    typeof frame.readings === 'object' && !Array.isArray(frame.readings) && Object.values(frame.readings).every(values =>
      Array.isArray(values) && values.length === 4 && values.every((number, i) => number === null ||
        (Number.isFinite(number) && number >= 0 && (i >= 2 || Number.isInteger(number))))));
}

export function replayStations(feed: ReplayFeed, index: number): Station[] {
  const frame = feed.frames[index];
  return feed.stations.map(station => ({ ...station, detectors: station.detectors.map(detector => {
    const values = frame?.readings[detector.id];
    const error = frame?.errors?.[detector.id];
    return { ...detector, reading: values || error ? { at: frame.at, light: values?.[0] ?? null, heavy: values?.[1] ?? null,
      lightSpeed: values?.[2] ?? null, heavySpeed: values?.[3] ?? null, error } : null };
  }) }));
}

export function availableFrameIndices(feed: ReplayFeed, detectorIds: ReadonlySet<string>): number[] {
  const ids = [...detectorIds];
  return feed.frames.flatMap((frame, index) => ids.some(id => {
    const counts = frame.readings[id];
    return counts && counts[0] !== null && counts[1] !== null;
  }) ? [index] : []);
}

export function frameCollected(frame: ReplayFrame): boolean {
  return frame.collected ?? (Object.keys(frame.readings).length > 0 || Object.keys(frame.errors ?? {}).length > 0);
}

export function detectorStatus(detector: Detector, frame: ReplayFrame): string {
  if (!frameCollected(frame)) return 'Minute not collected';
  const error = frame.errors?.[detector.id];
  if (error) return sourceErrors[error];
  return currentReading(detector.reading, Date.parse(frame.at), 0) ? 'Partial count' : 'No source reading';
}

export function stationStatus(station: Station, frame: ReplayFrame): string {
  if (stationIsCurrent(station, Date.parse(frame.at), 0)) return 'Partial count';
  const statuses = new Set(station.detectors.map(detector => detectorStatus(detector, frame)));
  return statuses.size === 1 ? [...statuses][0] : 'Mixed source errors';
}

export function currentReading(reading: Reading | null, now: number, maxAgeSeconds: number): Reading | null {
  if (!reading) return null;
  const age = now - Date.parse(reading.at);
  return Number.isFinite(age) && age >= -30_000 && age <= maxAgeSeconds * 1000 &&
    (reading.light !== null || reading.heavy !== null) ? reading : null;
}

export function stationIsCurrent(station: Station, now: number, maxAgeSeconds: number): boolean {
  return station.detectors.some(({ reading }) => currentReading(reading, now, maxAgeSeconds));
}

export function stationVolume(station: Station, now: number, maxAgeSeconds: number): number | null {
  let volume: number | null = null;
  for (const detector of station.detectors) {
    const reading = currentReading(detector.reading, now, maxAgeSeconds);
    if (!reading || reading.light === null || reading.heavy === null) continue;
    if (![reading.light, reading.heavy].every(value => Number.isInteger(value) && value >= 0)) continue;
    volume = Math.max(volume ?? 0, reading.light + reading.heavy);
  }
  return volume;
}

export function volumeColor(volume: number | null): string {
  return volume === null ? '#a3a3a3' : volume >= 30 ? '#c93d36' : volume >= 20 ? '#e18a25' : volume >= 10 ? '#b39a24' : '#2d8656';
}
