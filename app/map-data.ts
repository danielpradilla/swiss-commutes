import type { Corridor, Mode, Point } from './data/types.ts';
import { routeGeometries } from './data/route-geometries.ts';
import { departureMinute, finishPreparation, prepareCarRoute, prepareRoadFlowSteps, type CarRouteCache, type ActiveRouteCache, type SharedCoordinates } from './road-flow.ts';
import { decodePolyline, prepareRailRoutes, routeKey, type RailRouteCache } from './route-geometry.ts';
import type { CommuteJourney } from './model.ts';

const ROUTED_GEOMETRY_ENABLED = true;
const COMMUTERS_PER_DOT = ROUTED_GEOMETRY_ENABLED ? 200 : 900;
export const CAR_COMMUTERS_PER_DOT = 50;
type CommuneNode = { point: Point; byMode: Record<Mode, number> };
export const carPointName = (point: Point, citySlug: string) => citySlug === 'geneva' && point.code === 'CH22' ? 'Vaud (A1 gateway)' : point.name;

const hash = (value: number) => {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export function prepareMapData(...args: Parameters<typeof prepareMapDataSteps>) {
  return finishPreparation(prepareMapDataSteps(...args));
}

export async function prepareMapDataAsync(signal: AbortSignal, ...args: Parameters<typeof prepareMapDataSteps>) {
  // ponytail: yield between routes; split individual routes only if one exceeds the frame budget.
  const steps = prepareMapDataSteps(...args);
  let deadline = performance.now() + 12;
  while (true) {
    signal.throwIfAborted();
    const step = steps.next();
    if (step.done) return step.value;
    if (performance.now() >= deadline) {
      await new Promise(resolve => setTimeout(resolve, 0));
      deadline = performance.now() + 12;
    }
  }
}

export type MapSummary = {
  communeNodes: CommuneNode[];
  journeyTimes: [corridorIndex: number, duration: number, returnDuration: number][];
  hasRoadRoutes: boolean;
};

function* prepareMapDataSteps(corridors: Corridor[], citySlug: string, carRoutes?: CarRouteCache, railRoutes?: RailRouteCache, activeRoutes?: ActiveRouteCache, transitRoutes?: CarRouteCache) {
  const roadFlow = carRoutes ? yield* prepareRoadFlowSteps(corridors, carRoutes, citySlug) : null;
  const rail = prepareRailRoutes(railRoutes);
  yield;
  const active = new Map<string, { toWork: ReturnType<typeof prepareCarRoute>; toHome: ReturnType<typeof prepareCarRoute>; costing: 'pedestrian' | 'bicycle' }>();
  for (const [key, pair] of Object.entries(activeRoutes ?? {})) {
    active.set(key, { toWork: prepareCarRoute(pair.toWork), toHome: prepareCarRoute(pair.toHome), costing: pair.costing });
    yield;
  }
  const transitPoints: SharedCoordinates = new Map();
  const transit = new Map<string, { toWork: ReturnType<typeof prepareCarRoute>; toHome: ReturnType<typeof prepareCarRoute> }>();
  for (const [key, pair] of Object.entries(transitRoutes ?? {})) {
    transit.set(key, { toWork: prepareCarRoute(pair.toWork, transitPoints), toHome: prepareCarRoute(pair.toHome, transitPoints) });
    yield;
  }
  const routes = corridors.map((corridor) => {
    if (roadFlow && corridor.mode === 'car') return undefined;
    if (activeRoutes && corridor.mode === 'soft') return undefined;
    if (transit.has(routeKey(citySlug, corridor))) return undefined;
    const train = rail.routes.get(routeKey(citySlug, corridor));
    if (train) return train.points;
    const encoded = ROUTED_GEOMETRY_ENABLED ? routeGeometries[routeKey(citySlug, corridor)] : undefined;
    return encoded ? decodePolyline(encoded) : undefined;
  });

  const journeys: CommuteJourney[] = [];
  const dots = corridors.flatMap((corridor, corridorIndex) => {
    const route = routes[corridorIndex];
    const train = rail.routes.get(routeKey(citySlug, corridor));
    const car = roadFlow?.pairs.get(corridor);
    const walkBike = active.get(routeKey(citySlug, corridor));
    const scheduled = transit.get(routeKey(citySlug, corridor));
    const timed = car ?? walkBike ?? scheduled;
    if (ROUTED_GEOMETRY_ENABLED && !route && !timed) return [];
    // Timetabled journeys include transfers; rail-only fallback uses estimated travel time.
    const duration = timed?.toWork.duration ?? 16 + Math.hypot(corridor.origin.lat - corridor.target.lat, corridor.origin.lon - corridor.target.lon) * 115;
    const returnDuration = timed?.toHome.duration ?? duration;
    journeys.push({ corridor, duration, returnDuration });
    const peoplePerDot = corridor.mode === 'car' ? CAR_COMMUTERS_PER_DOT : COMMUTERS_PER_DOT;
    const count = Math.ceil(corridor.commuters / peoplePerDot);
    return Array.from({
      length: count,
    }, (_, index) => {
      const seed = corridorIndex * 101 + index + 1;
      return {
        corridor,
        route,
        train,
        car,
        walkBike,
        scheduled,
        weight: corridor.commuters / count,
        bend: (hash(seed * 5) - 0.5) * 0.18,
        inbound: departureMinute((index + hash(seed)) / count),
        outbound: departureMinute((index + hash(seed * 3)) / count, true),
        duration,
        returnDuration,
      };
    });
  });

  const communeNodes = Array.from(journeys.map(({ corridor }) => corridor).reduce((nodes, corridor) => {
    const remote = corridor.direction === 'inbound' ? corridor.origin : corridor.target;
    const car = roadFlow?.pairs.get(corridor);
    const endpoint = corridor.direction === 'inbound' ? car?.toWork.points[0] : car?.toWork.points.at(-1);
    const node = nodes.get(remote.code) ?? {
      point: remote,
      byMode: { car: 0, transit: 0, soft: 0, unknown: 0 },
    };
    node.byMode[corridor.mode] += corridor.commuters;
    if (endpoint) node.point = { ...remote, name: carPointName(remote, citySlug), lat: endpoint[0], lon: endpoint[1] };
    nodes.set(remote.code, node);
    return nodes;
  }, new Map<string, CommuneNode>()).values());

  return { communeNodes, dots, roadFlow, journeys };
}
