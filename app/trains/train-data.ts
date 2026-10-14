import { decodePolyline } from '../route-geometry.ts';

export type TransitView = 'trains' | 'public-transport';
export type VehicleMode = 'rail' | 'tram' | 'bus';
export type TransitPoint = [number, number];
export type Vehicle = {
  id: string;
  mode: VehicleMode;
  line: string;
  number: string;
  delayMinutes: number | null;
  cancelled: boolean;
  realtime: boolean;
  geometry: TransitPoint[];
  distances: number[];
  intervals: [number, number, number | null][];
};
export type TransitFeed = {
  fetchedAt: string;
  city: string;
  coverage: [number, number, number, number];
  vehicles: Vehicle[];
};
export type TripStop = {
  name: string;
  coordinate: [number, number] | null;
  arrivalAt: string | null;
  departureAt: string | null;
  scheduledArrivalAt: string | null;
  scheduledDepartureAt: string | null;
  cancelled: boolean;
  platform: string;
};
export type Trip = {
  fetchedAt: string;
  vehicleId: string;
  destination: string;
  operator: string;
  lines: [number, number][][];
  stops: TripStop[];
};

export function vehiclesForView(vehicles: Vehicle[], view: TransitView): Vehicle[] {
  return view === 'trains' ? vehicles.filter(vehicle => vehicle.mode === 'rail') : vehicles;
}

export function vehicleRadius(mode: VehicleMode, zoom: number): number {
  return (mode === 'rail' ? 7 : mode === 'tram' ? 5 : 3) + (zoom >= 14 ? 2 : 0);
}

const networkRouteFlags: Record<VehicleMode, readonly string[]> = {
  rail: ['train_route'],
  tram: ['tram_route', 'light_rail_route', 'subway_route'],
  bus: ['bus_route', 'trolleybus_route'],
};
const allNetworkModes: readonly VehicleMode[] = ['rail', 'tram', 'bus'];

export function networkModes(properties: Record<string, unknown>, enabled: readonly VehicleMode[] = allNetworkModes): VehicleMode[] {
  return enabled.filter(mode => networkRouteFlags[mode].some(flag => {
    const value = properties[flag];
    return value === 1 || (typeof value === 'string' && value.trim() !== '' && value.trim() !== '0');
  }));
}

export function parseTrackContext(value: unknown): TransitPoint[][] {
  const raw = object(value);
  text(raw.source);
  if (typeof raw.networkYear !== 'number' || !Number.isInteger(raw.networkYear)) throw new Error('Invalid track year');
  return Object.values(object(raw.segments)).map(value => {
    const encoded = text(value);
    // The shared decoder assumes complete coordinate pairs; validate its encoded boundary here.
    if (!/^(?:[_-~]{0,6}[?-^])*$/.test(encoded)) throw new Error('Invalid track encoding');
    let components = 0;
    for (const character of encoded) if (character.charCodeAt(0) < 95) components++;
    if (components % 2) throw new Error('Incomplete track coordinate');
    const line = decodePolyline(encoded);
    if (line.some(([lat, lon]) => !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)) {
      throw new Error('Invalid track coordinate');
    }
    return line;
  }).filter(line => line.length > 1);
}

const RADIUS = 6378137;
const DEGREES = 180 / Math.PI;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid transit object');
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid transit text');
  return value;
}

function optionalText(value: unknown): string {
  return value == null ? '' : text(value);
}

function identifier(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const result = text(value);
  if (!result) throw new Error('Missing transit identifier');
  return result;
}

function date(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(result) || !Number.isFinite(Date.parse(result))) {
    throw new Error('Invalid transit date');
  }
  const year = Number(result.slice(0, 4));
  const month = Number(result.slice(5, 7));
  const day = Number(result.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > days[month - 1] || Number(result.slice(11, 13)) > 23) throw new Error('Invalid transit date');
  return result;
}

function optionalDate(value: unknown): string | null {
  return value == null ? null : date(value);
}

function point(value: unknown): TransitPoint {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(item => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error('Invalid transit coordinate');
  }
  return [value[0], value[1]];
}

function points(value: unknown, minimum: number): TransitPoint[] {
  if (!Array.isArray(value) || value.length < minimum) throw new Error('Invalid transit geometry');
  return value.map(point);
}

function latLng(x: number, y: number): [number, number] {
  return [Math.atan(Math.sinh(y / RADIUS)) * DEGREES, x / RADIUS * DEGREES];
}

export function mercatorToLatLng(coordinate: TransitPoint): [number, number] {
  return latLng(coordinate[0], coordinate[1]);
}

function cancelled(value: Record<string, unknown>): boolean {
  if (value.cancelled != null && typeof value.cancelled !== 'boolean') throw new Error('Invalid cancellation flag');
  if (value.state != null && typeof value.state !== 'string') throw new Error('Invalid transit state');
  return value.cancelled === true || (typeof value.state === 'string' && /^cancelled$/i.test(value.state));
}

export function parseTransitFeed(value: unknown): TransitFeed {
  const raw = object(value);
  const fetchedAt = date(raw.fetchedAt);
  const city = identifier(raw.city);
  if (!Array.isArray(raw.coverage) || raw.coverage.length !== 4 || !raw.coverage.every(item => typeof item === 'number' && Number.isFinite(item))) {
    throw new Error('Invalid transit coverage');
  }
  const coverage: TransitFeed['coverage'] = [raw.coverage[0], raw.coverage[1], raw.coverage[2], raw.coverage[3]];
  if (coverage[0] >= coverage[2] || coverage[1] >= coverage[3] || !Array.isArray(raw.features)) throw new Error('Invalid transit feed');
  const vehicles: Vehicle[] = [];
  for (const value of raw.features) {
    const feature = object(value);
    if (feature.type !== 'Feature') throw new Error('Invalid transit feature');
    const properties = object(feature.properties);
    const mode = text(properties.type);
    if (!['rail', 'tram', 'subway', 'bus'].includes(mode)) continue;
    const rawGeometry = object(feature.geometry);
    const geometry = rawGeometry.type === 'Point' ? [point(rawGeometry.coordinates)] :
      rawGeometry.type === 'LineString' ? points(rawGeometry.coordinates, 2) : null;
    if (!geometry) throw new Error('Invalid vehicle geometry');
    const distances = [0];
    for (let i = 1; i < geometry.length; i++) {
      const distance = distances[i - 1] + Math.hypot(geometry[i][0] - geometry[i - 1][0], geometry[i][1] - geometry[i - 1][1]);
      if (!Number.isFinite(distance)) throw new Error('Invalid vehicle distance');
      distances.push(distance);
    }
    if (typeof properties.has_realtime_journey !== 'boolean' || !Array.isArray(properties.time_intervals)) throw new Error('Invalid vehicle updates');
    const intervals: Vehicle['intervals'] = [];
    for (const interval of properties.time_intervals) {
      if (!Array.isArray(interval) || interval.length !== 3 || typeof interval[0] !== 'number' || !Number.isFinite(interval[0]) ||
        typeof interval[1] !== 'number' || !Number.isFinite(interval[1]) || interval[1] < 0 || interval[1] > 1 ||
        (interval[2] !== null && (typeof interval[2] !== 'number' || !Number.isFinite(interval[2]))) ||
        (intervals.length > 0 && interval[0] < intervals[intervals.length - 1][0])) throw new Error('Invalid vehicle interval');
      intervals.push([interval[0], interval[1], interval[2]]);
    }
    if (properties.delay != null && (typeof properties.delay !== 'number' || !Number.isFinite(properties.delay))) throw new Error('Invalid vehicle delay');
    const line = properties.line == null ? '' : optionalText(object(properties.line).name);
    vehicles.push({
      id: identifier(properties.train_id), mode: mode === 'subway' ? 'tram' : mode as VehicleMode,
      line, number: properties.train_number == null ? '' : identifier(properties.train_number),
      delayMinutes: properties.has_realtime_journey && typeof properties.delay === 'number' ? properties.delay / 60000 : null,
      realtime: properties.has_realtime_journey, cancelled: cancelled(properties), geometry, distances, intervals,
    });
  }
  return { fetchedAt, city, coverage, vehicles };
}

export function vehiclePosition(vehicle: Vehicle, now: number): [number, number] {
  if (!Number.isFinite(now)) throw new Error('Invalid animation time');
  const { geometry, distances, intervals } = vehicle;
  let fraction = 0;
  if (intervals.length && now > intervals[intervals.length - 1][0]) fraction = 1;
  else if (intervals.length && now >= intervals[0][0]) {
    let low = 0;
    let high = intervals.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (intervals[middle][0] <= now) low = middle + 1;
      else high = middle;
    }
    const before = intervals[low - 1];
    const after = intervals[low];
    fraction = after ? before[1] + (after[1] - before[1]) * (now - before[0]) / (after[0] - before[0]) : before[1];
  }
  const target = fraction * distances[distances.length - 1];
  if (target <= 0 || geometry.length === 1) return mercatorToLatLng(geometry[0]);
  let low = 1;
  let high = distances.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (distances[middle] < target) low = middle + 1;
    else high = middle;
  }
  const start = geometry[low - 1];
  const end = geometry[low];
  const span = distances[low] - distances[low - 1];
  const along = span ? (target - distances[low - 1]) / span : 0;
  return latLng(start[0] + (end[0] - start[0]) * along, start[1] + (end[1] - start[1]) * along);
}

export function vehicleColor(delayMinutes: number | null, isCancelled = false): string {
  if (isCancelled || delayMinutes === null) return '#6d6d6d';
  if (delayMinutes <= 1) return '#0f766e';
  if (delayMinutes <= 5) return '#b7791f';
  return '#c2413f';
}

export function vehicleLabel(vehicle: Vehicle): string {
  const mode = vehicle.mode === 'rail' ? 'Train' : vehicle.mode === 'tram' ? 'Tram' : 'Bus';
  return [mode, vehicle.line, vehicle.number && vehicle.number !== vehicle.line ? vehicle.number : ''].filter(Boolean).join(' ');
}

export function vehicleMatches(vehicle: Vehicle, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();
  const needle = normalize(query.trim());
  const row = normalize(vehicleLabel(vehicle));
  return !needle || needle.split(/\s+/).every(term => row.includes(term));
}

function routeLines(value: unknown, lines: Trip['lines']): void {
  const geometry = object(value);
  switch (geometry.type) {
    case 'GeometryCollection':
      if (!Array.isArray(geometry.geometries)) throw new Error('Invalid route collection');
      for (const item of geometry.geometries) routeLines(item, lines);
      break;
    case 'MultiLineString':
      if (!Array.isArray(geometry.coordinates)) throw new Error('Invalid route lines');
      for (const line of geometry.coordinates) lines.push(points(line, 2).map(mercatorToLatLng));
      break;
    case 'LineString':
      lines.push(points(geometry.coordinates, 2).map(mercatorToLatLng));
      break;
    case 'Point':
      point(geometry.coordinates);
      break;
    case 'MultiPoint':
      points(geometry.coordinates, 0);
      break;
    default:
      throw new Error('Invalid route geometry');
  }
}

export function parseTrip(value: unknown): Trip {
  const raw = object(value);
  const fetchedAt = date(raw.fetchedAt);
  const vehicleId = identifier(raw.vehicleId);
  const route = object(raw.route);
  if (route.type !== 'FeatureCollection' || !Array.isArray(route.features) || !Array.isArray(raw.calls)) throw new Error('Invalid trip');
  const lines: Trip['lines'] = [];
  for (const value of route.features) {
    const feature = object(value);
    if (feature.type !== 'Feature') throw new Error('Invalid route feature');
    routeLines(feature.geometry, lines);
  }
  const stops: TripStop[] = [];
  let destination = '';
  let operator = '';
  for (const value of raw.calls) {
    const journey = object(value);
    if (!Array.isArray(journey.stations)) throw new Error('Invalid trip stations');
    const journeyDestination = optionalText(journey.destination);
    if (journeyDestination) destination = journeyDestination;
    const journeyOperator = optionalText(journey.operator);
    if (!operator && journeyOperator) operator = journeyOperator;
    for (const value of journey.stations) {
      const station = object(value);
      stops.push({
        name: text(station.stationName), coordinate: station.coordinate == null ? null : mercatorToLatLng(point(station.coordinate)),
        arrivalAt: optionalDate(station.arrivalTime), departureAt: optionalDate(station.departureTime),
        scheduledArrivalAt: optionalDate(station.aimedArrivalTime), scheduledDepartureAt: optionalDate(station.aimedDepartureTime),
        cancelled: cancelled(station), platform: station.platform == null ? '' : identifier(station.platform),
      });
    }
  }
  return { fetchedAt, vehicleId, destination, operator, lines, stops };
}
