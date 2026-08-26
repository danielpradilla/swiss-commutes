import type { CommuteData, Corridor, Mode, Point } from './types.ts';

export type RawFlow = readonly [code: string, name: string, lat: number, lon: number, commuters: number];

type CityDataInput = {
  centre: Point;
  modeShares: Record<Mode, number>;
  domesticInbound: readonly RawFlow[];
  domesticOutbound: readonly RawFlow[];
  foreignInbound: readonly RawFlow[];
  summary: Record<string, number>;
};

function splitModes(commuters: number, shares: Record<Mode, number>) {
  const modes: Mode[] = ['car', 'transit', 'soft'];
  const exact = modes.map((mode) => commuters * shares[mode]);
  const counts = exact.map(Math.floor);
  let remainder = commuters - counts.reduce((sum, count) => sum + count, 0);
  exact
    .map((value, index) => ({ index, fraction: value - counts[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remainder > 0) {
        counts[index] += 1;
        remainder -= 1;
      }
    });
  return modes.map((mode, index) => [mode, counts[index]] as const).filter(([, count]) => count > 0);
}

export function createCityData(input: CityDataInput): CommuteData {
  const corridors: Corridor[] = [];

  const addFlows = (
    flows: readonly RawFlow[],
    direction: 'inbound' | 'outbound',
    source: string,
  ) => {
    for (const [code, name, lat, lon, commuters] of flows) {
      const remote: Point = { code, name, lat, lon };
      for (const [mode, count] of splitModes(commuters, input.modeShares)) {
        corridors.push({
          origin: direction === 'inbound' ? remote : input.centre,
          target: direction === 'inbound' ? input.centre : remote,
          commuters: count,
          mode,
          direction,
          source,
        });
      }
    }
  };

  addFlows(input.domesticInbound, 'inbound', 'FSO commune matrix 2020');
  addFlows(input.domesticOutbound, 'outbound', 'FSO commune matrix 2020');
  addFlows(input.foreignInbound, 'inbound', 'FSO Q4 2025 / spatial allocation');

  const remoteCommunes = new Set(corridors.map((corridor) =>
    corridor.direction === 'inbound' ? corridor.origin.code : corridor.target.code));

  return {
    corridors,
    summary: {
      ...input.summary,
      originCommunes: remoteCommunes.size,
      corridors: corridors.length,
    },
  };
}
