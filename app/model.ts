export const MINUTES_PER_DAY = 1440;

export type DailyModelConfig = {
  populationGroups: Array<{
    people: number;
    arrival: number;
    departure: number;
    arrivalSpread: number;
    departureSpread: number;
  }>;
  transitPeaks: Array<{ people: number; centre: number; spread: number }>;
  home: { departure: number; return: number; departureSpread: number; returnSpread: number };
};

const sigmoid = (minute: number, centre: number, spread: number) =>
  1 / (1 + Math.exp(-(minute - centre) / spread));

const presence = (
  minute: number,
  arrival: number,
  departure: number,
  arrivalSpread: number,
  departureSpread: number,
) => sigmoid(minute, arrival, arrivalSpread) - sigmoid(minute, departure, departureSpread);

const gaussian = (minute: number, centre: number, spread: number) =>
  Math.exp(-0.5 * ((minute - centre) / spread) ** 2);

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

  const commutersInTransit = (minute: number) => Math.round(config.transitPeaks.reduce(
    (total, peak) => total + peak.people * gaussian(minute, peak.centre, peak.spread),
    0,
  ));

  const commutersAtHomeShare = (minute: number) => Math.max(0, Math.min(
    1,
    1 - sigmoid(minute, config.home.departure, config.home.departureSpread) +
      sigmoid(minute, config.home.return, config.home.returnSpread),
  ));

  const populationSeries = Array.from({ length: 145 }, (_, index) => ({
    minute: index * 10,
    value: populationChange(index * 10),
  }));

  const dailyPeak = populationSeries.reduce((peak, point) =>
    point.value > peak.value ? point : peak,
  );

  return {
    commutersAtHomeShare,
    commutersInTransit,
    dailyPeak,
    populationChange,
    populationSeries,
  };
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
) {
  const inboundProgress = (minute - inbound) / duration;
  if (inboundProgress >= 0 && inboundProgress <= 1) {
    return { direction: morningDirection, progress: inboundProgress, reverse: false };
  }
  const outboundProgress = (minute - outbound) / duration;
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
