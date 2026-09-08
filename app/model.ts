import type { Corridor, Mode, TransportMode } from './data/types.ts';
import { departureShare } from './road-flow.ts';

export const MINUTES_PER_DAY = 1440;
export const transportModes: TransportMode[] = ['car', 'transit', 'soft'];
export const transportLabels: Record<Mode, string> = { car: 'Car / motorcycle', transit: 'Public transport', soft: 'Walk / bike (estimate)', unknown: 'Other / unspecified mode' };
type FlowGroup = 'foreignInbound' | 'swissInbound' | 'swissOutbound';

export type DailyModelConfig = {
  populationGroups: Array<{
    flow: FlowGroup;
    people: number;
    arrival: number;
    departure: number;
    arrivalSpread: number;
    departureSpread: number;
  }>;
  home: { departure: number; return: number; departureSpread: number; returnSpread: number };
};

export function selectModelModes(config: DailyModelConfig, corridors: Corridor[], modes: Mode[]) {
  if (transportModes.every((mode) => modes.includes(mode)) && !corridors.some(c => c.mode === 'unknown')) return config;
  const totals = { foreignInbound: 0, swissInbound: 0, swissOutbound: 0 };
  const selected = { ...totals };
  for (const c of corridors) {
    const flow = c.direction === 'outbound' ? 'swissOutbound'
      : c.origin.code.startsWith('CH') ? 'swissInbound' : 'foreignInbound';
    totals[flow] += c.commuters;
    if (modes.includes(c.mode)) selected[flow] += c.commuters;
  }
  // Preserve each published population total; mode shares are estimates from that group's mapped corridors.
  return {
    ...config,
    populationGroups: config.populationGroups.map((g) => ({
      ...g, people: g.people * (totals[g.flow] ? selected[g.flow] / totals[g.flow] : 0),
    })),
  };
}

const sigmoid = (minute: number, centre: number, spread: number) =>
  1 / (1 + Math.exp(-(minute - centre) / spread));

const presence = (
  minute: number,
  arrival: number,
  departure: number,
  arrivalSpread: number,
  departureSpread: number,
) => sigmoid(minute, arrival, arrivalSpread) - sigmoid(minute, departure, departureSpread);

export function createDailyModel(config: DailyModelConfig) {
  const populationChange = (minute: number) => Math.round(config.populationGroups.reduce(
    (total, group) => total + group.people * presence(
      minute,
      group.arrival,
      group.departure,
      group.arrivalSpread,
      group.departureSpread,
    ),
    0,
  ));

  const commutersAtHomeShare = (minute: number) => Math.max(0, Math.min(
    1,
    1 - sigmoid(minute, config.home.departure, config.home.departureSpread) +
      sigmoid(minute, config.home.return, config.home.returnSpread),
  ));

  return sampleModel(populationChange, commutersAtHomeShare);
}

function sampleModel(populationChange: (minute: number) => number, commutersAtHomeShare: (minute: number) => number) {
  const populationSeries = Array.from({ length: 145 }, (_, index) => ({
    minute: index * 10,
    value: populationChange(index * 10),
  }));

  const dailyAverage = Math.round(populationSeries.slice(0, -1).reduce(
    (total, point) => total + point.value,
    0,
  ) / (populationSeries.length - 1));

  const dailyPeak = populationSeries.reduce((peak, point) =>
    point.value > peak.value ? point : peak,
  );

  return {
    commutersAtHomeShare,
    dailyAverage,
    dailyPeak,
    populationChange,
    populationSeries,
  };
}

export type CommuteJourney = { corridor: Corridor; duration: number; returnDuration: number };

export function createJourneyModel(journeys: CommuteJourney[], modes: Mode[] = transportModes) {
  const selected = journeys.filter((j) => modes.includes(j.corridor.mode));
  const total = selected.reduce((n, j) => n + j.corridor.commuters, 0);
  const populationChange = (minute: number) => Math.round(selected.reduce((n, j) => n + j.corridor.commuters *
    (j.corridor.direction === 'inbound'
      ? departureShare(minute - j.duration) - departureShare(minute, true)
      : -departureShare(minute) + departureShare(minute - j.returnDuration, true)), 0));
  const commutersAtHomeShare = (minute: number) => total ? selected.reduce((n, j) => n + j.corridor.commuters *
    (1 - departureShare(minute) + departureShare(minute - j.returnDuration, true)), 0) / total : 1;
  const travelling = (minute: number) => Math.round(selected.reduce((n, j) => n + j.corridor.commuters *
    (departureShare(minute) - departureShare(minute - j.duration) +
      departureShare(minute, true) - departureShare(minute - j.returnDuration, true)), 0));
  return { ...sampleModel(populationChange, commutersAtHomeShare), travelling };
}

export function arrivalBlip(progress: number) {
  return Math.max(0, Math.min(1, (progress - 0.8) / 0.2));
}

export function flowAt(
  minute: number,
  inbound: number,
  outbound: number,
  duration: number,
  morningDirection: 'inbound' | 'outbound' = 'inbound',
  returnDuration = duration,
) {
  const inboundProgress = (minute - inbound) / duration;
  if (inboundProgress >= 0 && inboundProgress <= 1) {
    return { direction: morningDirection, progress: inboundProgress, reverse: false };
  }
  const outboundProgress = (minute - outbound) / returnDuration;
  if (outboundProgress >= 0 && outboundProgress <= 1) {
    return {
      direction: morningDirection === 'inbound' ? 'outbound' as const : 'inbound' as const,
      progress: outboundProgress,
      reverse: true,
    };
  }
  return null;
}

export function formatTime(minute: number) {
  const value = Math.max(0, Math.min(MINUTES_PER_DAY, Math.floor(minute)));
  if (value === MINUTES_PER_DAY) return '24:00';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
