import { corridors, dataSummary } from './data/geneva.ts';
import { corridors as baselCorridors, dataSummary as baselSummary } from './data/basel.ts';
import { corridors as luganoCorridors, dataSummary as luganoSummary } from './data/lugano.ts';
import { corridors as schaffhausenCorridors, dataSummary as schaffhausenSummary } from './data/schaffhausen.ts';
import { corridors as chauxCorridors, dataSummary as chauxSummary } from './data/la-chaux-de-fonds.ts';
import { corridors as zurichCorridors, dataSummary as zurichSummary } from './data/zurich.ts';
import { corridors as lausanneCorridors, dataSummary as lausanneSummary } from './data/lausanne.ts';
import { corridors as bernCorridors, dataSummary as bernSummary } from './data/bern.ts';
import { corridors as winterthurCorridors, dataSummary as winterthurSummary } from './data/winterthur.ts';
import { corridors as lucerneCorridors, dataSummary as lucerneSummary } from './data/lucerne.ts';
import { corridors as stGallenCorridors, dataSummary as stGallenSummary } from './data/st-gallen.ts';
import { corridors as bielCorridors, dataSummary as bielSummary } from './data/biel-bienne.ts';
import type { CommuteData, Point } from './data/types.ts';
import type { DailyModelConfig } from './model.ts';

export type CitySource = { label: string; name: string; description: string; href: string };

export type CityConfig = {
  slug: string;
  name: string;
  displayName: string;
  neighbours: string;
  centre: Point;
  fitBounds: [[number, number], [number, number]];
  maxBounds: [[number, number], [number, number]];
  cityRadiusLongitude: number;
  dataYears: string;
  showInternationalShare?: boolean;
  data?: CommuteData;
  model?: DailyModelConfig;
  sources?: CitySource[];
  methodNote?: string;
};

const sharedSources: CitySource[] = [
  {
    label: 'Default basemap',
    name: 'Stadia Outdoors',
    description: 'The map shown behind the commuter dots when the page opens.',
    href: 'https://docs.stadiamaps.com/map-styles/outdoors/',
  },
  {
    label: 'Swiss locations',
    name: 'swissBOUNDARIES3D',
    description: 'Commune boundaries and centre points for the Swiss side of the map.',
    href: 'https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d',
  },
  {
    label: 'Other basemaps',
    name: 'Map style menu',
    description: 'Stadia Toner, swisstopo grey and Carto Positron are available in the selector.',
    href: 'https://docs.geo.admin.ch/visualize-data/xyz.html',
  },
];

const currentCitySources: CitySource[] = [
  {
    label: 'International count',
    name: 'FSO, Q4 2025',
    description: 'Cross-border workers counted by their Swiss commune of work.',
    href: 'https://www.pxweb-admin-a.bfs.admin.ch/pxweb/en/px-x-0302010000_101/-/px-x-0302010000_101.px/',
  },
  {
    label: 'Swiss flows',
    name: 'FSO commune matrix',
    description: 'Home-to-work pairs inside Switzerland. 2020 is still the latest commune release.',
    href: 'https://opendata.swiss/en/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020',
  },
  {
    label: 'Transport split',
    name: 'Swiss Cities 2026',
    description: 'Each city’s 2023 split between car, public transport, walking and cycling.',
    href: 'https://www.bfs.admin.ch/asset/en/DF_SSV_MOB_COM',
  },
];

const cityListSource: CitySource = {
  label: 'City list',
  name: 'FSO City Statistics 2026',
  description: 'The ten largest Swiss cities used for the main set.',
  href: 'https://www.bfs.admin.ch/asset/en/DF_SSV_MOB_COM',
};

const apiGeoSource: CitySource = {
  label: 'French communes',
  name: 'API Géo',
  description: 'Official French commune names, populations and centre points.',
  href: 'https://geo.api.gouv.fr/decoupage-administratif/communes',
};

const osmSource: CitySource = {
  label: 'Foreign communes',
  name: 'OpenStreetMap',
  description: 'Names and centre points for communes outside Switzerland.',
  href: 'https://www.openstreetmap.org/copyright',
};

function standardModel(data: CommuteData, minuteShift = 0): DailyModelConfig {
  const summary = data.summary;
  const international = Number(summary.borderWorkers2025);
  const swissInbound = Number(summary.swissInbound2020);
  const swissOutbound = Number(summary.swissOutbound2020);
  const mappedJourneys = Number(summary.mappedSwissInbound2020) +
    Number(summary.mappedSwissOutbound2020) + international;
  const morningPeak = Math.round(mappedJourneys * 0.45);
  return {
    populationGroups: [
      { people: international, arrival: 440 + minuteShift, departure: 1030 + minuteShift, arrivalSpread: 42, departureSpread: 52 },
      { people: swissInbound, arrival: 455 + minuteShift, departure: 1035 + minuteShift, arrivalSpread: 48, departureSpread: 56 },
      { people: -swissOutbound, arrival: 445 + minuteShift, departure: 1020 + minuteShift, arrivalSpread: 44, departureSpread: 54 },
    ],
    transitPeaks: [
      { people: morningPeak, centre: 465 + minuteShift, spread: 76 },
      { people: Math.round(morningPeak * 0.9), centre: 1035 + minuteShift, spread: 88 },
    ],
    borderGroups: international ? [
      { people: international, morning: 450 + minuteShift, evening: 1035 + minuteShift, morningSpread: 66, eveningSpread: 76 },
    ] : [],
    home: { departure: 450 + minuteShift, return: 1035 + minuteShift, departureSpread: 66, returnSpread: 76 },
  };
}

function standardMethod(city: string, countries: string) {
  return `Swiss commune pairs are observed in 2020. The international total is from Q4 2025, but the FSO workplace table does not say where those commuters live abroad. Their dots are distributed among nearby ${countries} communes using town size and distance. Modes follow ${city}’s 2023 split.`;
}

const geneva: CityConfig = {
  slug: 'geneva',
  name: 'Geneva',
  displayName: 'Geneva',
  neighbours: 'France and Vaud',
  centre: { code: 'CH6621', name: 'Genève', lat: 46.2044, lon: 6.1432 },
  fitBounds: [[45.72, 4.72], [46.7, 7.12]],
  maxBounds: [[45.4, 4.45], [47.2, 7.55]],
  cityRadiusLongitude: 0.12,
  dataYears: '2023–2024',
  showInternationalShare: true,
  data: { corridors, summary: dataSummary },
  model: {
    populationGroups: [
      { people: 119_003, arrival: 435, departure: 1040, arrivalSpread: 42, departureSpread: 48 },
      { people: 23_398, arrival: 410, departure: 1010, arrivalSpread: 38, departureSpread: 44 },
      { people: -8_703, arrival: 340, departure: 980, arrivalSpread: 34, departureSpread: 48 },
    ],
    transitPeaks: [
      { people: 50_000, centre: 465, spread: 74 },
      { people: 46_000, centre: 1035, spread: 88 },
    ],
    borderGroups: [
      { people: 119_003, morning: 450, evening: 1035, morningSpread: 66, eveningSpread: 76 },
    ],
    home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
  },
  sources: [
    {
      label: 'French communes',
      name: 'INSEE RP2023',
      description: 'French home-to-work records, including the usual mode of travel.',
      href: 'https://www.insee.fr/fr/statistiques/9004795',
    },
    {
      label: 'Swiss communes',
      name: 'OFS commune matrix',
      description: 'Swiss home-to-work pairs by commune. 2020 is still the latest release.',
      href: 'https://opendata.swiss/fr/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020',
    },
    {
      label: 'Current Swiss totals',
      name: 'OCSTAT 2024',
      description: '2024 totals used to bring the Geneva–Vaud flows up to date.',
      href: 'https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx',
    },
    ...sharedSources.slice(0, 2),
    {
      label: 'French locations',
      name: 'API Géo',
      description: 'Official names and centre points for communes in Ain and Haute-Savoie.',
      href: 'https://geo.api.gouv.fr/decoupage-administratif/communes',
    },
    {
      label: 'Inspiration',
      name: 'Habibi Code / Reddit',
      description: 'The Geneva commuter animation that started this project.',
      href: 'https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/',
    },
    sharedSources[2],
  ],
  methodNote: 'French flows come straight from RP2023. Swiss commune shares come from the 2020 matrix, then the Geneva–Vaud totals are updated to 2024.',
};

const existingCities: CityConfig[] = [
  geneva,
  {
    slug: 'basel',
    name: 'Basel',
    displayName: 'Basel',
    neighbours: 'France, Germany and Basel-Landschaft',
    centre: { code: 'CH2701', name: 'Basel', lat: 47.5596, lon: 7.5886 },
    fitBounds: [[47.25, 6.9], [48.05, 8.25]],
    maxBounds: [[46.9, 6.5], [48.4, 8.7]],
    cityRadiusLongitude: 0.1,
    dataYears: '2020–2025',
    showInternationalShare: true,
    data: { corridors: baselCorridors, summary: baselSummary },
    model: {
      populationGroups: [
        { people: 35_367, arrival: 440, departure: 1030, arrivalSpread: 42, departureSpread: 52 },
        { people: 69_635, arrival: 455, departure: 1035, arrivalSpread: 48, departureSpread: 56 },
        { people: -24_985, arrival: 445, departure: 1020, arrivalSpread: 44, departureSpread: 54 },
      ],
      transitPeaks: [{ people: 55_000, centre: 465, spread: 76 }, { people: 49_000, centre: 1035, spread: 88 }],
      borderGroups: [{ people: 35_367, morning: 450, evening: 1035, morningSpread: 66, eveningSpread: 76 }],
      home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
    },
    sources: [...currentCitySources, apiGeoSource, osmSource, ...sharedSources],
    methodNote: 'Swiss commune pairs are observed in 2020. The foreign total is from Q4 2025, but the FSO table does not publish the home commune abroad. Those workers are spread across nearby French and German communes using population and distance. Modes follow Basel’s 2023 split.',
  },
  {
    slug: 'lugano',
    name: 'Lugano',
    displayName: 'Lugano',
    neighbours: 'Italy and neighbouring Ticino',
    centre: { code: 'CH5192', name: 'Lugano', lat: 46.0037, lon: 8.9511 },
    fitBounds: [[45.55, 8.1], [46.55, 9.6]],
    maxBounds: [[45.2, 7.7], [46.9, 10]],
    cityRadiusLongitude: 0.1,
    dataYears: '2020–2025',
    showInternationalShare: true,
    data: { corridors: luganoCorridors, summary: luganoSummary },
    model: {
      populationGroups: [
        { people: 15_663, arrival: 445, departure: 1025, arrivalSpread: 42, departureSpread: 52 },
        { people: 18_248, arrival: 460, departure: 1035, arrivalSpread: 48, departureSpread: 56 },
        { people: -7_197, arrival: 450, departure: 1020, arrivalSpread: 44, departureSpread: 54 },
      ],
      transitPeaks: [{ people: 17_300, centre: 465, spread: 76 }, { people: 15_600, centre: 1035, spread: 88 }],
      borderGroups: [{ people: 15_663, morning: 450, evening: 1035, morningSpread: 66, eveningSpread: 76 }],
      home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
    },
    sources: [...currentCitySources, osmSource, ...sharedSources],
    methodNote: 'Swiss commune pairs are observed in 2020. The foreign total is from Q4 2025, but the FSO table does not publish the home commune abroad. Those workers are spread across nearby Italian communes using population and distance. Modes follow Lugano’s 2023 split.',
  },
  {
    slug: 'schaffhausen',
    name: 'Schaffhausen',
    displayName: 'Schaffhausen',
    neighbours: 'Germany, Zürich and Thurgau',
    centre: { code: 'CH2939', name: 'Schaffhausen', lat: 47.6959, lon: 8.638 },
    fitBounds: [[47.4, 7.8], [48.1, 9.1]],
    maxBounds: [[47.1, 7.4], [48.4, 9.5]],
    cityRadiusLongitude: 0.08,
    dataYears: '2020–2025',
    showInternationalShare: true,
    data: { corridors: schaffhausenCorridors, summary: schaffhausenSummary },
    model: {
      populationGroups: [
        { people: 3_218, arrival: 440, departure: 1025, arrivalSpread: 40, departureSpread: 50 },
        { people: 12_322, arrival: 455, departure: 1035, arrivalSpread: 46, departureSpread: 54 },
        { people: -7_764, arrival: 445, departure: 1020, arrivalSpread: 42, departureSpread: 52 },
      ],
      transitPeaks: [{ people: 9_800, centre: 465, spread: 74 }, { people: 8_900, centre: 1035, spread: 86 }],
      borderGroups: [{ people: 3_218, morning: 450, evening: 1035, morningSpread: 66, eveningSpread: 76 }],
      home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
    },
    sources: [...currentCitySources, osmSource, ...sharedSources],
    methodNote: 'Swiss commune pairs are observed in 2020. The foreign total is from Q4 2025, but the FSO table does not publish the home commune abroad. Those workers are spread across nearby German communes using population and distance. Modes follow Schaffhausen’s 2023 split.',
  },
  {
    slug: 'la-chaux-de-fonds',
    name: 'La Chaux-de-Fonds',
    displayName: 'La Chaux-de-Fonds',
    neighbours: 'France and the Jura Arc',
    centre: { code: 'CH6421', name: 'La Chaux-de-Fonds', lat: 47.1035, lon: 6.8328 },
    fitBounds: [[46.7, 5.9], [47.5, 7.5]],
    maxBounds: [[46.4, 5.5], [47.8, 7.9]],
    cityRadiusLongitude: 0.08,
    dataYears: '2020–2025',
    showInternationalShare: true,
    data: { corridors: chauxCorridors, summary: chauxSummary },
    model: {
      populationGroups: [
        { people: 5_580, arrival: 435, departure: 1015, arrivalSpread: 40, departureSpread: 50 },
        { people: 7_469, arrival: 450, departure: 1025, arrivalSpread: 46, departureSpread: 54 },
        { people: -5_158, arrival: 440, departure: 1010, arrivalSpread: 42, departureSpread: 52 },
      ],
      transitPeaks: [{ people: 7_700, centre: 455, spread: 72 }, { people: 6_900, centre: 1025, spread: 84 }],
      borderGroups: [{ people: 5_580, morning: 445, evening: 1025, morningSpread: 64, eveningSpread: 74 }],
      home: { departure: 445, return: 1025, departureSpread: 64, returnSpread: 74 },
    },
    sources: [...currentCitySources, apiGeoSource, ...sharedSources],
    methodNote: 'Swiss commune pairs are observed in 2020. The foreign total is from Q4 2025, but the FSO table does not publish the home commune abroad. Those workers are spread across nearby French communes using population and distance. Modes follow La Chaux-de-Fonds’ 2023 split.',
  },
];

const zurichData: CommuteData = { corridors: zurichCorridors, summary: zurichSummary };
const lausanneData: CommuteData = { corridors: lausanneCorridors, summary: lausanneSummary };
const bernData: CommuteData = { corridors: bernCorridors, summary: bernSummary };
const winterthurData: CommuteData = { corridors: winterthurCorridors, summary: winterthurSummary };
const lucerneData: CommuteData = { corridors: lucerneCorridors, summary: lucerneSummary };
const stGallenData: CommuteData = { corridors: stGallenCorridors, summary: stGallenSummary };
const bielData: CommuteData = { corridors: bielCorridors, summary: bielSummary };

const topCityAdditions: CityConfig[] = [
  {
    slug: 'zurich',
    name: 'Zürich',
    displayName: 'Zürich',
    neighbours: 'Aargau, Zug, Schaffhausen and eastern Switzerland',
    centre: { code: 'CH261', name: 'Zürich', lat: 47.3769, lon: 8.5417 },
    fitBounds: [[46.82, 7.7], [47.95, 9.35]],
    maxBounds: [[46.45, 7.25], [48.25, 9.85]],
    cityRadiusLongitude: 0.11,
    dataYears: '2020–2025',
    data: zurichData,
    model: standardModel(zurichData),
    sources: [...currentCitySources, osmSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('Zürich', 'German'),
  },
  {
    slug: 'lausanne',
    name: 'Lausanne',
    displayName: 'Lausanne',
    neighbours: 'Vaud, Fribourg and France',
    centre: { code: 'CH5586', name: 'Lausanne', lat: 46.5197, lon: 6.6323 },
    fitBounds: [[46.05, 5.65], [47.05, 7.25]],
    maxBounds: [[45.7, 5.2], [47.4, 7.7]],
    cityRadiusLongitude: 0.09,
    dataYears: '2020–2025',
    data: lausanneData,
    model: standardModel(lausanneData),
    sources: [...currentCitySources, apiGeoSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('Lausanne', 'French'),
  },
  {
    slug: 'bern',
    name: 'Bern',
    displayName: 'Bern',
    neighbours: 'the Bern region and neighbouring cantons',
    centre: { code: 'CH351', name: 'Bern', lat: 46.948, lon: 7.4474 },
    fitBounds: [[46.45, 6.35], [47.5, 8.25]],
    maxBounds: [[46.05, 5.9], [47.85, 8.7]],
    cityRadiusLongitude: 0.1,
    dataYears: '2020–2025',
    data: bernData,
    model: standardModel(bernData),
    sources: [...currentCitySources, apiGeoSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('Bern', 'French'),
  },
  {
    slug: 'winterthur',
    name: 'Winterthur',
    displayName: 'Winterthur',
    neighbours: 'Zürich, Thurgau, Schaffhausen and Germany',
    centre: { code: 'CH230', name: 'Winterthur', lat: 47.4988, lon: 8.7241 },
    fitBounds: [[47.1, 7.95], [48.05, 9.45]],
    maxBounds: [[46.8, 7.55], [48.35, 9.85]],
    cityRadiusLongitude: 0.09,
    dataYears: '2020–2025',
    data: winterthurData,
    model: standardModel(winterthurData),
    sources: [...currentCitySources, osmSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('Winterthur', 'German'),
  },
  {
    slug: 'lucerne',
    name: 'Lucerne',
    displayName: 'Lucerne',
    neighbours: 'Central Switzerland and neighbouring cantons',
    centre: { code: 'CH1061', name: 'Luzern', lat: 47.0502, lon: 8.3093 },
    fitBounds: [[46.4, 7.45], [47.65, 9.2]],
    maxBounds: [[46, 7], [48, 9.65]],
    cityRadiusLongitude: 0.09,
    dataYears: '2020–2025',
    data: lucerneData,
    model: standardModel(lucerneData),
    sources: [...currentCitySources, osmSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('Lucerne', 'German, Austrian and Liechtenstein'),
  },
  {
    slug: 'st-gallen',
    name: 'St. Gallen',
    displayName: 'St. Gallen',
    neighbours: 'eastern Switzerland, Austria, Germany and Liechtenstein',
    centre: { code: 'CH3203', name: 'St. Gallen', lat: 47.4245, lon: 9.3767 },
    fitBounds: [[46.75, 8.4], [48.05, 10.25]],
    maxBounds: [[46.4, 8], [48.4, 10.65]],
    cityRadiusLongitude: 0.09,
    dataYears: '2020–2025',
    data: stGallenData,
    model: standardModel(stGallenData),
    sources: [...currentCitySources, osmSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('St. Gallen', 'Austrian, German and Liechtenstein'),
  },
  {
    slug: 'biel-bienne',
    name: 'Biel/Bienne',
    displayName: 'Biel/Bienne',
    neighbours: 'Bern, Jura, Neuchâtel and France',
    centre: { code: 'CH371', name: 'Biel/Bienne', lat: 47.1368, lon: 7.2468 },
    fitBounds: [[46.55, 5.9], [47.6, 8.2]],
    maxBounds: [[46.2, 5.45], [47.95, 8.65]],
    cityRadiusLongitude: 0.09,
    dataYears: '2020–2025',
    data: bielData,
    model: standardModel(bielData, -5),
    sources: [...currentCitySources, apiGeoSource, cityListSource, ...sharedSources],
    methodNote: standardMethod('Biel/Bienne', 'French'),
  },
];

const cityOrder = [
  'zurich',
  'geneva',
  'basel',
  'lausanne',
  'bern',
  'winterthur',
  'lucerne',
  'st-gallen',
  'lugano',
  'biel-bienne',
  'schaffhausen',
  'la-chaux-de-fonds',
];

const unorderedCities = [...existingCities, ...topCityAdditions].map((city) => ({
  ...city,
  sources: city.sources
    ? [...city.sources.filter((source) => source.href !== cityListSource.href), cityListSource]
    : [cityListSource],
}));
const unorderedCityBySlug = Object.fromEntries(unorderedCities.map((city) => [city.slug, city])) as Record<string, CityConfig>;
export const cities = cityOrder.map((slug) => unorderedCityBySlug[slug]);

export const cityBySlug = Object.fromEntries(cities.map((city) => [city.slug, city]));
