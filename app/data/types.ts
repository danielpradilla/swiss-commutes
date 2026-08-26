export type Mode = 'car' | 'transit' | 'soft';
export type FlowDirection = 'inbound' | 'outbound';
export type Point = { code: string; name: string; lat: number; lon: number };
export type Corridor = {
  origin: Point;
  target: Point;
  commuters: number;
  mode: Mode;
  direction: FlowDirection;
  source: string;
};

export type CommuteData = {
  corridors: Corridor[];
  summary: { originCommunes: number; corridors: number } & Record<string, number>;
};
