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
  borderGroups: Array<{
    people: number;
    morning: number;
    evening: number;
    morningSpread: number;
    eveningSpread: number;
  }>;
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

  const borderCrossings = (minute: number) => Math.round(config.borderGroups.reduce(
    (total, group) => total + group.people * sigmoid(minute, group.morning, group.morningSpread) +
      group.people * sigmoid(minute, group.evening, group.eveningSpread),
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
    borderCrossings,
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

export function commuterMixAt(corridors: import('./data/types.ts').Corridor[], minute: number) {
  let domestic = 0;
  let international = 0;
  for (const corridor of corridors) {
    const remote = corridor.direction === 'inbound' ? corridor.origin : corridor.target;
    const city = corridor.direction === 'inbound' ? corridor.target : corridor.origin;
    const meanLatitude = (remote.lat + city.lat) / 2 * Math.PI / 180;
    const distance = Math.hypot(
      (remote.lat - city.lat) * 111,
      (remote.lon - city.lon) * 111 * Math.cos(meanLatitude),
    );
    const isInternational = !remote.code.startsWith('CH');
    const reach = Math.min(42, distance * 0.16) + (isInternational ? 10 : 0);
    const spread = 48 + Math.min(44, distance * 0.28) + (isInternational ? 8 : 0);
    const intensity = gaussian(minute, 465 - reach, spread) + gaussian(minute, 1035 + reach, spread + 10);
    if (isInternational) international += corridor.commuters * intensity;
    else domestic += corridor.commuters * intensity;
  }
  const roundedDomestic = Math.round(domestic);
  const roundedInternational = Math.round(international);
  const total = roundedDomestic + roundedInternational;
  return {
    domestic: roundedDomestic,
    international: roundedInternational,
    total,
    internationalShare: total >= 50 ? roundedInternational / total : null,
  };
}

export function formatTime(minute: number) {
  const value = Math.max(0, Math.min(MINUTES_PER_DAY, Math.floor(minute)));
  if (value === MINUTES_PER_DAY) return '24:00';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
