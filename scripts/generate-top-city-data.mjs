import fs from 'node:fs';
import path from 'node:path';

// Inputs:
// - FSO 2020 commune matrix: https://dam-api.bfs.admin.ch/hub/api/dam/assets/27885394/master
// - swissBOUNDARIES3D 2020-10 commune centres: https://ogd.swisstopo.admin.ch/ch.swisstopo.swissboundaries3d
// - FSO Q4 2025 cross-border worker totals: https://www.pxweb-admin-a.bfs.admin.ch/pxweb/en/px-x-0302010000_101/-/px-x-0302010000_101.px/
// - FSO Swiss Cities 2026 mode split: https://www.bfs.admin.ch/asset/en/DF_SSV_MOB_COM

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.split('=', 2)));
const commutePath = args['--commutes'];
const centrePath = args['--centres'];
const outputDirectory = args['--out'];

if (!commutePath || !centrePath || !outputDirectory) {
  throw new Error('Usage: node scripts/generate-top-city-data.mjs --commutes=FILE --centres=FILE --out=DIR');
}

const foreignPlaces = {
  annemasse: ['FR74012', 'Annemasse', 46.195, 6.237, 38_000],
  badSaeckingen: ['DE08337096', 'Bad Säckingen', 47.553, 7.947, 18_000],
  besancon: ['FR25056', 'Besançon', 47.238, 6.024, 120_000],
  bregenz: ['AT80207', 'Bregenz', 47.503, 9.747, 30_000],
  delle: ['FR90033', 'Delle', 47.507, 6.999, 5_700],
  divonne: ['FR01143', 'Divonne-les-Bains', 46.356, 6.143, 11_000],
  dornbirn: ['AT80301', 'Dornbirn', 47.414, 9.744, 51_000],
  evian: ['FR74119', 'Évian-les-Bains', 46.401, 6.59, 9_200],
  feldkirch: ['AT80404', 'Feldkirch', 47.238, 9.598, 35_000],
  gex: ['FR01173', 'Gex', 46.334, 6.058, 13_000],
  hohenems: ['AT80302', 'Hohenems', 47.366, 9.687, 17_000],
  hohentengen: ['DE08337053', 'Hohentengen am Hochrhein', 47.57, 8.433, 4_100],
  jestetten: ['DE08337060', 'Jestetten', 47.65, 8.574, 5_500],
  klettgau: ['DE08337106', 'Klettgau', 47.658, 8.423, 7_700],
  konstanz: ['DE08335043', 'Konstanz', 47.677, 9.174, 86_000],
  lindau: ['DE09776116', 'Lindau', 47.546, 9.684, 25_000],
  lottstetten: ['DE08337070', 'Lottstetten', 47.627, 8.57, 2_400],
  maiche: ['FR25356', 'Maîche', 47.251, 6.802, 4_300],
  montbeliard: ['FR25388', 'Montbéliard', 47.51, 6.799, 26_000],
  morteau: ['FR25411', 'Morteau', 47.057, 6.607, 7_000],
  pontarlier: ['FR25462', 'Pontarlier', 46.904, 6.355, 18_000],
  publieur: ['FR74218', 'Publier', 46.387, 6.543, 7_700],
  radolfzell: ['DE08335063', 'Radolfzell am Bodensee', 47.737, 8.97, 32_000],
  schaan: ['LI7005', 'Schaan', 47.166, 9.51, 6_100],
  singen: ['DE08335075', 'Singen', 47.76, 8.84, 50_000],
  thonon: ['FR74281', 'Thonon-les-Bains', 46.371, 6.479, 37_000],
  vaduz: ['LI7001', 'Vaduz', 47.141, 9.521, 5_800],
  villers: ['FR25622', 'Villers-le-Lac', 47.063, 6.67, 5_200],
  waldshut: ['DE08337126', 'Waldshut-Tiengen', 47.623, 8.217, 43_000],
};

const cities = [
  {
    slug: 'zurich', file: 'zurich.ts', code: '261', name: 'Zürich', centre: [47.3769, 8.5417],
    bounds: [[46.82, 7.7], [47.95, 9.35]], borderWorkers: 4_278,
    modes: { car: 31_443, transit: 118_591, soft: 41_645 },
    foreign: ['waldshut', 'jestetten', 'lottstetten', 'klettgau', 'hohentengen', 'badSaeckingen', 'singen', 'konstanz'],
  },
  {
    slug: 'lausanne', file: 'lausanne.ts', code: '5586', name: 'Lausanne', centre: [46.5197, 6.6323],
    bounds: [[46.05, 5.65], [47.05, 7.25]], borderWorkers: 8_782,
    modes: { car: 13_776, transit: 31_029, soft: 12_870 },
    foreign: ['thonon', 'evian', 'publieur', 'annemasse', 'divonne', 'gex', 'pontarlier', 'morteau'],
  },
  {
    slug: 'bern', file: 'bern.ts', code: '351', name: 'Bern', centre: [46.948, 7.4474],
    bounds: [[46.45, 6.35], [47.5, 8.25]], borderWorkers: 593,
    modes: { car: 9_805, transit: 32_553, soft: 18_711 },
    foreign: ['pontarlier', 'morteau', 'villers', 'maiche', 'besancon', 'delle'],
  },
  {
    slug: 'winterthur', file: 'winterthur.ts', code: '230', name: 'Winterthur', centre: [47.4988, 8.7241],
    bounds: [[47.1, 7.95], [48.05, 9.45]], borderWorkers: 1_148,
    modes: { car: 15_165, transit: 23_116, soft: 10_928 },
    foreign: ['jestetten', 'lottstetten', 'singen', 'konstanz', 'radolfzell', 'waldshut', 'hohentengen', 'klettgau'],
  },
  {
    slug: 'lucerne', file: 'lucerne.ts', code: '1061', name: 'Luzern', centre: [47.0502, 8.3093],
    bounds: [[46.4, 7.45], [47.65, 9.2]], borderWorkers: 235,
    modes: { car: 10_603, transit: 16_159, soft: 10_465 },
    foreign: ['waldshut', 'badSaeckingen', 'konstanz', 'bregenz', 'vaduz', 'schaan'],
  },
  {
    slug: 'st-gallen', file: 'st-gallen.ts', code: '3203', name: 'St. Gallen', centre: [47.4245, 9.3767],
    bounds: [[46.75, 8.4], [48.05, 10.25]], borderWorkers: 1_668,
    modes: { car: 13_336, transit: 13_354, soft: 7_478 },
    foreign: ['bregenz', 'dornbirn', 'feldkirch', 'hohenems', 'vaduz', 'schaan', 'lindau', 'konstanz'],
  },
  {
    slug: 'biel-bienne', file: 'biel-bienne.ts', code: '371', name: 'Biel/Bienne', centre: [47.1368, 7.2468],
    bounds: [[46.55, 5.9], [47.6, 8.2]], borderWorkers: 558,
    modes: { car: 7_560, transit: 9_590, soft: 6_031 },
    foreign: ['morteau', 'pontarlier', 'villers', 'maiche', 'montbeliard', 'delle', 'besancon'],
  },
];

function lv95ToWgs84(east, north) {
  const y = (east - 2_600_000) / 1_000_000;
  const x = (north - 1_200_000) / 1_000_000;
  const lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x ** 2 - 0.0436 * y ** 3;
  const lat = 16.9023892 + 3.238272 * x - 0.270978 * y ** 2 - 0.002528 * x ** 2 - 0.0447 * y ** 2 * x - 0.014 * x ** 3;
  return [Number((lat * 100 / 36).toFixed(5)), Number((lon * 100 / 36).toFixed(5))];
}

const centres = new Map(fs.readFileSync(centrePath, 'utf8').trim().split(/\r?\n/).map((line) => {
  const [code, name, east, north] = line.split('\t');
  const [lat, lon] = lv95ToWgs84(Number(east), Number(north));
  return [code, { code: `CH${code}`, name, lat, lon }];
}));

const cityState = Object.fromEntries(cities.map((city) => [city.code, {
  inbound: [], outbound: [], swissInbound2020: 0, swissOutbound2020: 0,
}]));

const within = ({ lat, lon }, [[south, west], [north, east]]) =>
  lat >= south && lat <= north && lon >= west && lon <= east;

for (const line of fs.readFileSync(commutePath, 'utf8').split(/\r?\n/).slice(1)) {
  if (!line) continue;
  const [perspective, year, , residence, , work, rawValue] = line.replaceAll('"', '').split(',');
  if (year !== '2020') continue;
  const value = Number(rawValue);
  const inboundCity = perspective === 'W' ? cities.find((city) => city.code === work) : undefined;
  if (inboundCity && residence !== work) {
    const state = cityState[inboundCity.code];
    state.swissInbound2020 += value;
    const place = centres.get(residence);
    if (place && within(place, inboundCity.bounds)) state.inbound.push([place.code, place.name, place.lat, place.lon, value]);
  }
  const outboundCity = perspective === 'R' ? cities.find((city) => city.code === residence) : undefined;
  if (outboundCity && work !== residence) {
    const state = cityState[outboundCity.code];
    state.swissOutbound2020 += value;
    const place = centres.get(work);
    if (place && within(place, outboundCity.bounds)) state.outbound.push([place.code, place.name, place.lat, place.lon, value]);
  }
}

const distanceKm = ([latA, lonA], [, , latB, lonB]) => {
  const lat = (latA + latB) / 2 * Math.PI / 180;
  return Math.hypot((latA - latB) * 111, (lonA - lonB) * 111 * Math.cos(lat));
};

function allocateForeign(city) {
  const places = city.foreign.map((key) => foreignPlaces[key]);
  const weights = places.map((place) => place[4] / (distanceKm(city.centre, place) + 25) ** 1.65);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const exact = weights.map((weight) => city.borderWorkers * weight / totalWeight);
  const counts = exact.map(Math.floor);
  let remainder = city.borderWorkers - counts.reduce((sum, count) => sum + count, 0);
  exact.map((value, index) => ({ index, fraction: value - counts[index] }))
    .sort((a, b) => b.fraction - a.fraction)
    .forEach(({ index }) => {
      if (remainder > 0) {
        counts[index] += 1;
        remainder -= 1;
      }
    });
  return places.map(([code, name, lat, lon], index) => [code, name, lat, lon, counts[index]]);
}

function lines(name, values) {
  return `const ${name} = [\n${values.map((value) => `  ${JSON.stringify(value)},`).join('\n')}\n] as const satisfies readonly RawFlow[];`;
}

fs.mkdirSync(outputDirectory, { recursive: true });
const report = [];
for (const city of cities) {
  const state = cityState[city.code];
  state.inbound.sort((a, b) => a[1].localeCompare(b[1], 'en'));
  state.outbound.sort((a, b) => a[1].localeCompare(b[1], 'en'));
  const foreign = allocateForeign(city);
  const modeTotal = Object.values(city.modes).reduce((sum, value) => sum + value, 0);
  const modeShares = Object.fromEntries(Object.entries(city.modes).map(([mode, value]) => [mode, value / modeTotal]));
  const mappedSwissInbound2020 = state.inbound.reduce((sum, flow) => sum + flow[4], 0);
  const mappedSwissOutbound2020 = state.outbound.reduce((sum, flow) => sum + flow[4], 0);
  const summary = {
    swissInbound2020: state.swissInbound2020,
    swissOutbound2020: state.swissOutbound2020,
    borderWorkers2025: city.borderWorkers,
    mappedSwissInbound2020,
    mappedSwissOutbound2020,
    modeYear: 2023,
  };
  const moduleSource = `// Generated from FSO commute counts and swisstopo/OSM commune centres.\n\n` +
    `import { createCityData, type RawFlow } from './create-city-data.ts';\n\n` +
    `${lines('domesticInbound', state.inbound)}\n\n${lines('domesticOutbound', state.outbound)}\n\n` +
    `${lines('foreignInbound', foreign)}\n\n` +
    `export const { corridors, summary: dataSummary } = createCityData({\n` +
    `  centre: ${JSON.stringify({ code: `CH${city.code}`, name: city.name, lat: city.centre[0], lon: city.centre[1] })},\n` +
    `  modeShares: ${JSON.stringify(modeShares)},\n  domesticInbound,\n  domesticOutbound,\n  foreignInbound,\n` +
    `  summary: ${JSON.stringify(summary)},\n});\n`;
  fs.writeFileSync(path.join(outputDirectory, city.file), moduleSource);
  report.push({ city: city.name, inboundRows: state.inbound.length, outboundRows: state.outbound.length, foreignRows: foreign.length, ...summary });
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
