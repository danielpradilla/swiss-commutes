export const MINUTES_PER_DAY = 1440;
export const FRENCH_COMMUTERS_2023 = 119_003;
export const VAUD_TO_GENEVA_2024 = 23_398;
export const GENEVA_RESIDENTS_AWAY_2024 = 8_703;

const sigmoid = (minute: number, centre: number, spread: number) =>
  1 / (1 + Math.exp(-(minute - centre) / spread));

const presence = (
  minute: number,
  arrival: number,
  departure: number,
  arrivalSpread: number,
  departureSpread: number,
) => sigmoid(minute, arrival, arrivalSpread) - sigmoid(minute, departure, departureSpread);

export function populationChange(minute: number) {
  const france = FRENCH_COMMUTERS_2023 * presence(minute, 435, 1040, 42, 48);
  const vaud = VAUD_TO_GENEVA_2024 * presence(minute, 410, 1010, 38, 44);
  const genevaResidentsAway = GENEVA_RESIDENTS_AWAY_2024 * presence(minute, 340, 980, 34, 48);
  return Math.round(france + vaud - genevaResidentsAway);
}

const gaussian = (minute: number, centre: number, spread: number) =>
  Math.exp(-0.5 * ((minute - centre) / spread) ** 2);

export function commutersInTransit(minute: number) {
  return Math.round(50_000 * gaussian(minute, 465, 74) + 46_000 * gaussian(minute, 1035, 88));
}

export function borderCrossings(minute: number) {
  return Math.round(
    FRENCH_COMMUTERS_2023 * sigmoid(minute, 450, 66) +
    FRENCH_COMMUTERS_2023 * sigmoid(minute, 1035, 76),
  );
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
  const value = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minute)));
  if (value === MINUTES_PER_DAY) return '24:00';
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

export const populationSeries = Array.from({ length: 145 }, (_, index) => ({
  minute: index * 10,
  value: populationChange(index * 10),
}));

export const dailyPeak = populationSeries.reduce((peak, point) =>
  point.value > peak.value ? point : peak,
);
