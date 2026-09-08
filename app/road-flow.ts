import type { Corridor, FlowDirection } from './data/types.ts';
import { decodePolyline, routeKey, type RouteCoordinate } from './route-geometry.ts';

export type CarRoute = {
  shape: string;
  seconds: number;
  steps: Array<[endIndex: number, seconds: number, road: string]>;
};
export type CarRoutePair = { locations: number[]; returnLocations?: number[]; toWork: CarRoute; toHome: CarRoute };
export type CarRouteCache = Record<string, CarRoutePair>;
export type ActiveRouteCache = Record<string, CarRoutePair & { costing: 'pedestrian' | 'bicycle' }>;
type PackedCarRoute = Omit<CarRoute, 'shape'> & { shape: number[] };
export type PackedCarRouteCache = { shapes: string[]; routes: Record<string, Omit<CarRoutePair, 'toWork' | 'toHome'> & { toWork: PackedCarRoute; toHome: PackedCarRoute }> };

// Share repeated manoeuvre geometry at export time; retain the exact original polylines and timings.
export function packCarRoutes(cache: CarRouteCache): PackedCarRouteCache {
  const shapes: string[] = [], ids = new Map<string, number>();
  const pack = (route: CarRoute): PackedCarRoute => {
    const offsets = [0];
    let index = 0, start = 0;
    while (index < route.shape.length) {
      for (let coordinate = 0; coordinate < 2; coordinate++) while (route.shape.charCodeAt(index++) >= 95) { /* polyline varint */ }
      offsets.push(index);
    }
    const shape = route.steps.map(([end]) => {
      const until = offsets[end + 1];
      if (until === undefined || until < start) throw new Error('Invalid route step boundary');
      const part = route.shape.slice(start, until);
      start = until;
      if (!ids.has(part)) { ids.set(part, shapes.length); shapes.push(part); }
      return ids.get(part)!;
    });
    if (start !== route.shape.length) throw new Error('Route steps do not cover its geometry');
    return { ...route, shape };
  };
  const routes = Object.fromEntries(Object.entries(cache).map(([key, pair]) => [key, { ...pair, toWork: pack(pair.toWork), toHome: pack(pair.toHome) }]));
  return { shapes, routes };
}

export function unpackCarRoutes(cache: PackedCarRouteCache): CarRouteCache {
  const unpack = (route: PackedCarRoute): CarRoute => ({ ...route, shape: route.shape.map((id) => {
    if (cache.shapes[id] === undefined) throw new Error('Missing shared road geometry');
    return cache.shapes[id];
  }).join('') });
  return Object.fromEntries(Object.entries(cache.routes).map(([key, pair]) => [key, { ...pair, toWork: unpack(pair.toWork), toHome: unpack(pair.toHome) }]));
}

export function selectCarCorridors(corridors: Corridor[], coverage = 0.95) {
  return (['inbound', 'outbound'] as const).flatMap((direction) => {
    const sorted = corridors.filter((c) => c.mode === 'car' && c.direction === direction)
      .sort((a, b) => b.commuters - a.commuters);
    const target = sorted.reduce((sum, c) => sum + c.commuters, 0) * coverage;
    let covered = 0;
    return sorted.filter((c) => {
      if (covered >= target) return false;
      covered += c.commuters;
      return true;
    });
  });
}

// A bounded, symmetric departure wave; its inverse also schedules the particles.
export function departureShare(minute: number, returning = false) {
  const start = returning ? 900 : 300;
  const x = Math.max(0, Math.min(1, (minute - start) / 300));
  return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) ** 2;
}

export function departureMinute(share: number, returning = false) {
  const x = share < 0.5 ? Math.sqrt(share / 2) : 1 - Math.sqrt((1 - share) / 2);
  return (returning ? 900 : 300) + 300 * x;
}

export function distanceKm(a: RouteCoordinate, b: RouteCoordinate) {
  return Math.hypot((a[0] - b[0]) * 111.2,
    (a[1] - b[1]) * 111.2 * Math.cos((a[0] + b[0]) * Math.PI / 360));
}

export type SharedCoordinates = Map<number, Map<number, RouteCoordinate>>;

export function prepareCarRoute(route: CarRoute, coordinates?: SharedCoordinates) {
  const points = decodePolyline(route.shape, 6).map((point) => {
    if (!coordinates) return point;
    // Numeric keys share identical vertices without formatting millions of strings.
    let latitude = coordinates.get(point[0]);
    if (!latitude) { latitude = new Map(); coordinates.set(point[0], latitude); }
    const shared = latitude.get(point[1]);
    if (shared) return shared;
    latitude.set(point[1], point);
    return point;
  });
  const minutes = [0];
  let begin = 0;
  let elapsed = 0;
  for (const [end, seconds] of route.steps) {
    const lengths: number[] = [];
    let length = 0;
    for (let i = begin + 1; i <= end; i += 1) {
      length += distanceKm(points[i - 1], points[i]);
      lengths.push(length);
    }
    for (let i = begin + 1; i <= end; i += 1) {
      minutes[i] = (elapsed + seconds * (length ? lengths[i - begin - 1] / length : 1)) / 60;
    }
    elapsed += seconds;
    begin = end;
  }
  const duration = route.seconds / 60;
  const scale = duration / (minutes.at(-1) || duration);
  return { points, minutes: minutes.map((value) => value * scale), duration };
}

export type PreparedCarRoute = ReturnType<typeof prepareCarRoute>;
export type RoadJourney = {
  corridor: Corridor;
  route: PreparedCarRoute;
  returning: boolean;
  direction: FlowDirection;
};

export function prepareRoadFlow(corridors: Corridor[], cache: CarRouteCache, citySlug: string) {
  return finishPreparation(prepareRoadFlowSteps(corridors, cache, citySlug));
}

// The export and data audit run synchronously; the browser yields between routes.
export function finishPreparation<T>(steps: Generator<void, T>) {
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

export function* prepareRoadFlowSteps(corridors: Corridor[], cache: CarRouteCache, citySlug: string) {
  const coordinates: SharedCoordinates = new Map();
  const pairs = new Map<Corridor, { toWork: PreparedCarRoute; toHome: PreparedCarRoute }>();
  const journeys: RoadJourney[] = [];
  const total = { inbound: 0, outbound: 0 };
  const covered = { inbound: 0, outbound: 0 };
  for (const corridor of corridors) {
    if (corridor.mode !== 'car') continue;
    total[corridor.direction] += corridor.commuters;
    const pair = cache[routeKey(citySlug, corridor)];
    if (!pair?.toWork || !pair?.toHome) continue;
    const toWork = prepareCarRoute(pair.toWork, coordinates);
    const toHome = prepareCarRoute(pair.toHome, coordinates);
    pairs.set(corridor, { toWork, toHome });
    covered[corridor.direction] += corridor.commuters;
    journeys.push(
      { corridor, route: toWork, returning: false, direction: corridor.direction },
      { corridor, route: toHome, returning: true, direction: corridor.direction === 'inbound' ? 'outbound' : 'inbound' },
    );
    yield;
  }
  return { pairs, journeys, total, covered };
}

export function carsInTransit(journeys: RoadJourney[], minute: number) {
  return Math.round(journeys.reduce((sum, journey) => sum + journey.corridor.commuters * (
    departureShare(minute, journey.returning) -
    departureShare(minute - journey.route.duration, journey.returning)
  ), 0));
}

export function carPosition(route: PreparedCarRoute, elapsed: number) {
  const time = Math.max(0, Math.min(route.duration, elapsed));
  let low = 1;
  let high = route.minutes.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (route.minutes[mid] < time) low = mid + 1;
    else high = mid;
  }
  const before = route.minutes[low - 1];
  const span = route.minutes[low] - before;
  const share = span ? (time - before) / span : 0;
  const a = route.points[low - 1];
  const b = route.points[low];
  return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share] as RouteCoordinate;
}
