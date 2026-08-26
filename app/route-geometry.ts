import type { Corridor } from './data/types';

export type RouteCoordinate = [latitude: number, longitude: number];
export type ScreenCoordinate = [x: number, y: number];

export function routeKey(citySlug: string, corridor: Corridor) {
  return `${citySlug}:${corridor.origin.code}>${corridor.target.code}:${corridor.mode}:${corridor.direction}`;
}

export function decodePolyline(encoded: string, precision = 5): RouteCoordinate[] {
  const scale = 10 ** precision;
  const points: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const next = () => {
    let value = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      value |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32 && index <= encoded.length);
    return value & 1 ? ~(value >> 1) : value >> 1;
  };

  while (index < encoded.length) {
    latitude += next();
    longitude += next();
    points.push([latitude / scale, longitude / scale]);
  }
  return points;
}

export function encodePolyline(points: RouteCoordinate[], precision = 5) {
  const scale = 10 ** precision;
  let latitude = 0;
  let longitude = 0;

  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    let output = '';
    while (value >= 32) {
      output += String.fromCharCode((32 | (value & 31)) + 63);
      value >>= 5;
    }
    return output + String.fromCharCode(value + 63);
  };

  return points.map(([nextLatitude, nextLongitude]) => {
    const roundedLatitude = Math.round(nextLatitude * scale);
    const roundedLongitude = Math.round(nextLongitude * scale);
    const output = encode(roundedLatitude - latitude) + encode(roundedLongitude - longitude);
    latitude = roundedLatitude;
    longitude = roundedLongitude;
    return output;
  }).join('');
}

export function pointAlongPolyline(points: ScreenCoordinate[], progress: number): ScreenCoordinate {
  if (points.length < 2) return points[0] ?? [0, 0];
  const lengths: number[] = [];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
    lengths.push(total);
  }
  const target = Math.max(0, Math.min(1, progress)) * total;
  const segment = lengths.findIndex((length) => length >= target);
  const index = segment < 0 ? lengths.length - 1 : segment;
  const previous = index === 0 ? 0 : lengths[index - 1];
  const share = lengths[index] === previous ? 0 : (target - previous) / (lengths[index] - previous);
  return [
    points[index][0] + (points[index + 1][0] - points[index][0]) * share,
    points[index][1] + (points[index + 1][1] - points[index][1]) * share,
  ];
}
