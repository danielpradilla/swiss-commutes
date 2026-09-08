import type { CommuteData, Corridor, Mode, Point, TransportMode } from './types.ts';
import residentModes from './resident-mode-shares.json' with { type: 'json' };

export type RawFlow = readonly [code: string, name: string, lat: number, lon: number, commuters: number];
type ModeShares = Record<TransportMode, number> & { unknown?: number };

type CityDataInput = {
  centre: Point;
  modeShares: ModeShares;
  domesticInbound: readonly RawFlow[];
  domesticOutbound: readonly RawFlow[];
  foreignInbound: readonly RawFlow[];
  summary: Record<string, number>;
};

export function splitModes(commuters: number, shares: ModeShares) {
  if (!Number.isInteger(commuters) || commuters < 0 || Object.values(shares).some((s) => !Number.isFinite(s) || s < 0) ||
    Math.abs(Object.values(shares).reduce((a, b) => a + b, 0) - 1) > 1e-8) throw new Error('Invalid commuter count or mode shares');
  const modes: Mode[] = ['car', 'transit', 'soft', 'unknown'];
  const exact = modes.map((mode) => commuters * (shares[mode] ?? 0));
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

export const neuchatelFormerCodes = ['CH6407', 'CH6412', 'CH6485'];

export function aggregateFlows(flows: readonly RawFlow[]) {
  const rows = new Map<string, RawFlow>();
  for (const original of flows) {
    const row: RawFlow = neuchatelFormerCodes.includes(original[0]) || original[0] === 'CH6458'
      ? ['CH6458', 'Neuchâtel', 46.992, 6.9311, original[4]] : original;
    const previous = rows.get(row[0]);
    rows.set(row[0], [row[0], row[1], row[2], row[3], row[4] + (previous?.[4] ?? 0)]);
  }
  return [...rows.values()];
}

export function residentModeShares(origin: Point) {
  const profiles = residentModes as Record<string, { pen_t: number; pen_tim: number; pen_tp: number }>;
  // Resident shares are a prior, not observed OD modes. Small-city residents proxy missing Swiss communes.
  const profile = profiles[origin.code.slice(2)] ?? profiles['size-1'];
  return { car: profile.pen_tim / profile.pen_t, transit: profile.pen_tp / profile.pen_t,
    soft: (profile.pen_t - profile.pen_tim - profile.pen_tp) / profile.pen_t };
}

// Städtevergleich Mobilität 2021, figures 22–23 (pages 20–21), FSO pooled 2019–2021.
// Domestic workers only; [motorised, public transport, walking/cycling]. Published whole percentages are normalised.
export const directionalModes: Record<string, { inbound: number[]; outbound: number[] }> = {
  CH2701: { inbound: [31, 56, 13], outbound: [31, 56, 13] },
  CH351: { inbound: [35, 58, 6], outbound: [30, 60, 10] },
  CH1061: { inbound: [44, 46, 9], outbound: [45, 48, 7] },
  CH3203: { inbound: [56, 42, 2], outbound: [57, 40, 3] },
  CH230: { inbound: [49, 46, 5], outbound: [36, 61, 2] },
  CH261: { inbound: [28, 69, 2], outbound: [31, 65, 4] },
};

export function commuteModeShares(origin: Point, target: Point) {
  // OCT, Les transports genevois en chiffres (2022), p. 40, Relevé structurel 2020.
  // Vaud-only train/car/other counts, combining Nyon and the other Vaud districts.
  // "Other" does not identify bikes, walking, motorcycles or buses: keep it unclassified.
  const geneva = (p: Point) => /^CH66\d{2}$/.test(p.code);
  const vaud = (p: Point) => /^CH5[4-9]\d{2}$/.test(p.code);
  const vaudCounts = vaud(origin) && geneva(target) ? [9389, 13437, 858]
    : geneva(origin) && vaud(target) ? [2561, 4419, 521] : undefined;
  if (vaudCounts) {
    const total = vaudCounts.reduce((a, b) => a + b, 0);
    return { car: vaudCounts[0] / total, transit: vaudCounts[1] / total, soft: 0, unknown: vaudCounts[2] / total };
  }
  // One OD rule on every page: workplace inbound evidence, then home outbound evidence, then a labelled resident prior.
  const values = directionalModes[target.code]?.inbound ?? directionalModes[origin.code]?.outbound;
  if (!values) return residentModeShares(origin);
  const total = values.reduce((a, b) => a + b, 0);
  return { car: values[0] / total, transit: values[1] / total, soft: values[2] / total };
}

export function createCityData(input: CityDataInput): CommuteData {
  const corridors: Corridor[] = [];

  const addFlows = (
    flows: readonly RawFlow[],
    direction: 'inbound' | 'outbound',
    source: string,
  ) => {
    for (const [code, name, lat, lon, commuters] of aggregateFlows(flows)) {
      const remote: Point = { code, name, lat, lon };
      const origin = direction === 'inbound' ? remote : input.centre;
      const target = direction === 'inbound' ? input.centre : remote;
      const shares = origin.code.startsWith('CH') ? commuteModeShares(origin, target) : input.modeShares;
      for (const [mode, count] of splitModes(commuters, shares)) {
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
