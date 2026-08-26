import { corridors, dataSummary } from './data/geneva.ts';
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
  data?: CommuteData;
  model?: DailyModelConfig;
  sources?: CitySource[];
  methodNote?: string;
};

const sharedSources: CitySource[] = [
  {
    label: 'Basemap',
    name: 'swisstopo grey map',
    description: 'Official national-map tiles, visually softened so commuter flows remain legible.',
    href: 'https://docs.geo.admin.ch/visualize-data/xyz.html',
  },
  {
    label: 'Swiss locations',
    name: 'swissBOUNDARIES3D',
    description: 'Official commune boundaries used to locate Swiss origins and workplaces.',
    href: 'https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d',
  },
  {
    label: 'Optional basemaps',
    name: 'Stadia Maps styles',
    description: 'Authenticated raster tiles used by the map-style selector.',
    href: 'https://docs.stadiamaps.com/map-styles/',
  },
];

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
      description: 'Weighted residence-to-work records by commune, destination commune and main transport mode.',
      href: 'https://www.insee.fr/fr/statistiques/9004795',
    },
    {
      label: 'Swiss communes',
      name: 'OFS commune matrix',
      description: 'The latest published Swiss origin–destination matrix at commune grain: 2020.',
      href: 'https://opendata.swiss/fr/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020',
    },
    {
      label: 'Current Swiss totals',
      name: 'OCSTAT 2024',
      description: 'Official incoming and outgoing commuter totals for Geneva, Vaud and its districts.',
      href: 'https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx',
    },
    ...sharedSources.slice(0, 2),
    {
      label: 'French locations',
      name: 'API Géo',
      description: 'Official commune codes, names and representative centres for Ain and Haute-Savoie.',
      href: 'https://geo.api.gouv.fr/decoupage-administratif/communes',
    },
    {
      label: 'Inspiration',
      name: 'Habibi Code / Reddit',
      description: 'The original Geneva commuter animation that inspired this independent interpretation.',
      href: 'https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/',
    },
    sharedSources[2],
  ],
  methodNote: 'French flows use RP2023 directly. Swiss commune shares use the latest available matrix (2020) and cross-canton totals are scaled to OCSTAT 2024.',
};

export const cities: CityConfig[] = [
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
    dataYears: 'data in preparation',
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
    dataYears: 'data in preparation',
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
    dataYears: 'data in preparation',
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
    dataYears: 'data in preparation',
  },
];

export const cityBySlug = Object.fromEntries(cities.map((city) => [city.slug, city]));
