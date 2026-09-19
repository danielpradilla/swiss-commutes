export type TrainStop = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  scheduledAt: string;
  estimatedAt: string;
  delayMinutes: number;
  event: 'arrival' | 'departure';
};

export type TrainLastStop = Pick<TrainStop, 'id' | 'name' | 'lat' | 'lon'> & { departedAt: string };

export type Train = {
  tripId: string;
  trainNumber: string;
  line: string;
  lastStation: TrainLastStop | null;
  nextStation: TrainStop;
  cancelled: boolean;
};

export type TrainFeed = {
  fetchedAt: string;
  publishedAt: string;
  feedVersion: string;
  trains: Train[];
};

export type RailPoint = [number, number];
type RailEdge = [RailPoint, RailPoint];
export type RailIndex = Map<string, RailEdge[]>;
const RAIL_CELL = .05;
const RAIL_SNAP = .18;

const validDate = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const validPoint = (value: { lat?: unknown; lon?: unknown } | null | undefined) =>
  !!value && Number.isFinite(value.lat) && Number.isFinite(value.lon) && value.lat !== 0 && value.lon !== 0;

export function buildRailIndex(lines: RailPoint[][]): RailIndex {
  const index: RailIndex = new Map();
  for (const line of lines) for (let point = 1; point < line.length; point++) {
    const edge: RailEdge = [line[point - 1], line[point]];
    const minLat = Math.floor(Math.min(edge[0][0], edge[1][0]) / RAIL_CELL);
    const maxLat = Math.floor(Math.max(edge[0][0], edge[1][0]) / RAIL_CELL);
    const minLon = Math.floor(Math.min(edge[0][1], edge[1][1]) / RAIL_CELL);
    const maxLon = Math.floor(Math.max(edge[0][1], edge[1][1]) / RAIL_CELL);
    for (let lat = minLat; lat <= maxLat; lat++) for (let lon = minLon; lon <= maxLon; lon++) {
      const key = `${lat}:${lon}`;
      const bucket = index.get(key);
      if (bucket) bucket.push(edge); else index.set(key, [edge]);
    }
  }
  return index;
}

function nearestRailPoint(point: RailPoint, index: RailIndex): RailPoint | null {
  const longitudeScale = Math.cos(point[0] * Math.PI / 180);
  let nearest: RailPoint | null = null;
  let shortest = RAIL_SNAP ** 2;
  const latCell = Math.floor(point[0] / RAIL_CELL), lonCell = Math.floor(point[1] / RAIL_CELL);
  const radius = Math.ceil(RAIL_SNAP / RAIL_CELL);
  for (let lat = latCell - radius; lat <= latCell + radius; lat++) for (let lon = lonCell - radius; lon <= lonCell + radius; lon++) {
    for (const [a, b] of index.get(`${lat}:${lon}`) ?? []) {
    const x = (point[1] - a[1]) * longitudeScale, y = point[0] - a[0];
    const dx = (b[1] - a[1]) * longitudeScale, dy = b[0] - a[0];
    const length = dx * dx + dy * dy;
    const share = length ? Math.max(0, Math.min(1, (x * dx + y * dy) / length)) : 0;
    const candidate: RailPoint = [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share];
    const distance = (point[0] - candidate[0]) ** 2 + ((point[1] - candidate[1]) * longitudeScale) ** 2;
    if (distance < shortest) { shortest = distance; nearest = candidate; }
    }
  }
  return nearest;
}

export function trainPosition(train: Train, now: number, rail: RailIndex | null = null): RailPoint {
  const next: [number, number] = [train.nextStation.lat, train.nextStation.lon];
  if (!train.lastStation) return next;
  const start = Date.parse(train.lastStation.departedAt);
  const end = Date.parse(train.nextStation.estimatedAt);
  const progress = end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 1;
  const last: RailPoint = [train.lastStation.lat, train.lastStation.lon];
  if (!rail?.size) return progress < .5 ? last : next;
  const estimate: RailPoint = [last[0] + (next[0] - last[0]) * progress, last[1] + (next[1] - last[1]) * progress];
  return nearestRailPoint(estimate, rail) ?? (progress < .5 ? last : next);
}

export function trainColor(delay: number, cancelled = false) {
  if (cancelled) return '#6d6d6d';
  if (delay <= 1) return '#0f766e';
  if (delay <= 5) return '#b7791f';
  return '#c2413f';
}

export function trainMatches(train: Train, query: string) {
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
  const needle = normalize(query.trim());
  const row = normalize(`${train.line} ${train.trainNumber} ${train.nextStation.name}`);
  return !needle || needle.split(/\s+/).every(term => row.includes(term));
}

export function isTrainFeed(value: unknown): value is TrainFeed {
  const feed = value as TrainFeed | null;
  return !!feed && validDate(feed.fetchedAt) && validDate(feed.publishedAt) && typeof feed.feedVersion === 'string' &&
    Array.isArray(feed.trains) && feed.trains.every(train => train && typeof train.tripId === 'string' &&
      typeof train.trainNumber === 'string' && typeof train.line === 'string' && typeof train.cancelled === 'boolean' &&
      (train.lastStation === null || (validPoint(train.lastStation) && validDate(train.lastStation.departedAt) &&
        typeof train.lastStation.id === 'string' && typeof train.lastStation.name === 'string')) &&
      train.nextStation && typeof train.nextStation.id === 'string' && typeof train.nextStation.name === 'string' &&
      validPoint(train.nextStation) &&
      validDate(train.nextStation.scheduledAt) && validDate(train.nextStation.estimatedAt) &&
      Number.isFinite(train.nextStation.delayMinutes) && ['arrival', 'departure'].includes(train.nextStation.event));
}
