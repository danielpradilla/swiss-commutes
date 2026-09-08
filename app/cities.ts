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
import { corridors as chiassoCorridors, dataSummary as chiassoSummary } from './data/chiasso.ts';
import { corridors as mendrisioCorridors, dataSummary as mendrisioSummary } from './data/mendrisio.ts';
import { corridors as zugCorridors, dataSummary as zugSummary } from './data/zug.ts';
import { corridors as neuchatelCorridors, dataSummary as neuchatelSummary } from './data/neuchatel.ts';
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
    name: 'Stadia Alidade Smooth',
    description: 'The map behind the commuter dots.',
    href: 'https://docs.stadiamaps.com/map-styles/alidade-smooth/',
  },
  {
    label: 'Swiss locations',
    name: 'swissBOUNDARIES3D',
    description: 'Commune boundaries and centre points for the Swiss side of the map.',
    href: 'https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d',
  },
  {
    label: 'Routes',
    name: 'Valhalla / OpenStreetMap',
    description: 'Car, cycling and walking routes, with journey times for car trips.',
    href: 'https://valhalla.github.io/valhalla/',
  },
  {
    label: 'Swiss towns and villages',
    name: 'swisstopo place names',
    description: 'Town and village centres used as endpoints for car journeys.',
    href: 'https://docs.geo.admin.ch/access-data/search.html',
  },
  {
    label: 'Swiss rail network',
    name: 'ARE · NPVM 2023',
    description: 'Rail geometry from the federal transport model. Its passenger totals are not used here.',
    href: 'https://zenodo.org/records/18486217',
  },
  {
    label: 'Rail stations',
    name: 'DiDok · SBB / SKI',
    description: 'Official station locations used to connect Swiss commuter communes to the rail network.',
    href: 'https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/',
  },
  {
    label: 'Public transport',
    name: 'Transitous',
    description: 'A small set of additional public-transport routes based on operator timetables.',
    href: 'https://transitous.org/sources/',
  },
];

const currentCitySources: CitySource[] = [
  {
    label: 'Inbound and outbound modes',
    name: 'Städtevergleich Mobilität 2021',
    description: 'Domestic commuter shares for six cities, pooled 2019–2021. Workplace inbound shares take precedence over home-city outbound shares.',
    href: 'https://www.stadt-zuerich.ch/content/dam/web/de/aktuell/publikationen/2023/staedtevergleich-mobilitaet-2021/staedtevergleich-mobilitaet-2021.pdf',
  },
  {
    label: 'Cross-border workers',
    name: 'FSO, Q4 2025',
    description: 'Counts of cross-border workers by Swiss workplace commune.',
    href: 'https://www.pxweb-admin-a.bfs.admin.ch/pxweb/en/px-x-0302010000_101/-/px-x-0302010000_101.px/',
  },
  {
    label: 'Swiss flows',
    name: 'FSO commune matrix',
    description: 'Commuter counts between Swiss communes, from 2020.',
    href: 'https://opendata.swiss/en/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020',
  },
  {
    label: 'Transport split',
    name: 'Swiss Cities 2026',
    description: '2023 resident commuter shares used to estimate modes by home commune. These are not measured modes for individual journeys.',
    href: 'https://www.bfs.admin.ch/asset/en/DF_SSV_MOB_COM',
  },
];

const cityListSource: CitySource = {
  label: 'City list',
  name: 'FSO City Statistics 2026',
  description: 'Population figures for the ten largest cities. Additional cities were chosen for their commuter flows.',
  href: 'https://www.bfs.admin.ch/asset/de/DF_SSV_POP_BIL',
};

const apiGeoSource: CitySource = {
  label: 'French communes',
  name: 'API Géo',
  description: 'Official French commune names, populations and town-hall locations.',
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
  const crossBorderWorkers = Number(summary.borderWorkers2025);
  const swissInbound = Number(summary.swissInbound2020);
  const swissOutbound = Number(summary.swissOutbound2020);
  return {
    populationGroups: [
      { flow: 'foreignInbound', people: crossBorderWorkers, arrival: 440 + minuteShift, departure: 1030 + minuteShift, arrivalSpread: 42, departureSpread: 52 },
      { flow: 'swissInbound', people: swissInbound, arrival: 455 + minuteShift, departure: 1035 + minuteShift, arrivalSpread: 48, departureSpread: 56 },
      { flow: 'swissOutbound', people: -swissOutbound, arrival: 445 + minuteShift, departure: 1020 + minuteShift, arrivalSpread: 44, departureSpread: 54 },
    ],
    home: { departure: 450 + minuteShift, return: 1035 + minuteShift, departureSpread: 66, returnSpread: 76 },
  };
}

function standardMethod(city: string, countries: string) {
  return `Swiss commune pairs come from the 2020 matrix. Mode estimates use domestic inbound shares for six cities (2019–2021), then home-city outbound shares where available. Vaud–Geneva pairs use the 2020 inter-cantonal commuter survey, with other modes left unclassified. Other pairs use the home commune’s 2023 resident mix, or a small-city proxy. Foreign origins in ${countries} are allocated from the Q4 2025 workplace total; their transport mix uses ${city}’s resident shares as a proxy. None of these splits measures the mode of a particular commune pair.`;
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
  dataYears: '2020–2024',
  data: { corridors, summary: dataSummary },
  model: {
    populationGroups: [
      { flow: 'foreignInbound', people: dataSummary.frenchCommuters2023, arrival: 435, departure: 1040, arrivalSpread: 42, departureSpread: 48 },
      { flow: 'swissInbound', people: 23_398, arrival: 410, departure: 1010, arrivalSpread: 38, departureSpread: 44 },
      { flow: 'swissOutbound', people: -dataSummary.genevaToVaud2024, arrival: 340, departure: 980, arrivalSpread: 34, departureSpread: 48 },
    ],
    home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
  },
  sources: [
    {
      label: 'French communes',
      name: 'INSEE RP2023',
      description: 'Where commuters live and work, and how they usually travel.',
      href: 'https://www.insee.fr/fr/statistiques/9004795',
    },
    {
      label: 'Swiss communes',
      name: 'OFS commune matrix',
      description: 'Commuter counts between Swiss communes, from 2020.',
      href: 'https://opendata.swiss/fr/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020',
    },
    {
      label: 'Current Swiss totals',
      name: 'OCSTAT 2024',
      description: '2024 commuter totals for trips between Geneva and Vaud.',
      href: 'https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx',
    },
    {
      label: 'Vaud commuting modes',
      name: 'OCT / Relevé structurel 2020',
      description: 'Train, car and other modes for commuters between Vaud and Geneva, published in 2022 (page 40). Other modes remain unclassified.',
      href: 'https://www.ge.ch/document/22897/telecharger',
    },
    {
      label: 'Scheduled public-transport journeys',
      name: 'SKI / Swiss timetable 2026',
      description: 'Morning and return itineraries for 8 September 2026, including cross-border buses, trains and transfers. Journeys are calculated locally with MOTIS; they do not identify each worker’s actual service.',
      href: 'https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020',
    },
    ...sharedSources,
    {
      label: 'French locations',
      name: 'API Géo',
      description: 'Official commune names, town-hall locations and centre points in Ain and Haute-Savoie.',
      href: 'https://geo.api.gouv.fr/decoupage-administratif/communes',
    },
    {
      label: 'Inspiration',
      name: 'Habibi Code / Reddit',
      description: 'The Geneva commuter animation that started this project.',
      href: 'https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/',
    },
  ],
  methodNote: 'The data covers all communes in the canton. French records from Ain and Haute-Savoie retain their reported workplace commune and transport mode; people reporting no journey are excluded. Swiss commune pairs cover Vaud in both directions, scaled to 2024 totals. Their train and car shares come from the 2020 survey of commuters between Vaud and Geneva, published by OCT in 2022. The survey’s other category stays unclassified and is excluded from the three mode filters. The survey year coincides with the pandemic. These historical aggregate shares do not establish each person’s mode. Other-canton and unknown locations remain outside the routes.',
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
    data: { corridors: baselCorridors, summary: baselSummary },
    model: {
      populationGroups: [
        { flow: 'foreignInbound', people: 35_367, arrival: 440, departure: 1030, arrivalSpread: 42, departureSpread: 52 },
        { flow: 'swissInbound', people: 69_635, arrival: 455, departure: 1035, arrivalSpread: 48, departureSpread: 56 },
        { flow: 'swissOutbound', people: -24_985, arrival: 445, departure: 1020, arrivalSpread: 44, departureSpread: 54 },
      ],
      home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
    },
    sources: [...currentCitySources, apiGeoSource, osmSource, ...sharedSources],
    methodNote: standardMethod('Basel', 'France and Germany'),
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
    data: { corridors: luganoCorridors, summary: luganoSummary },
    model: {
      populationGroups: [
        { flow: 'foreignInbound', people: 15_663, arrival: 445, departure: 1025, arrivalSpread: 42, departureSpread: 52 },
        { flow: 'swissInbound', people: 18_248, arrival: 460, departure: 1035, arrivalSpread: 48, departureSpread: 56 },
        { flow: 'swissOutbound', people: -7_197, arrival: 450, departure: 1020, arrivalSpread: 44, departureSpread: 54 },
      ],
      home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
    },
    sources: [...currentCitySources, osmSource, ...sharedSources],
    methodNote: standardMethod('Lugano', 'Italy'),
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
    data: { corridors: schaffhausenCorridors, summary: schaffhausenSummary },
    model: {
      populationGroups: [
        { flow: 'foreignInbound', people: 3_218, arrival: 440, departure: 1025, arrivalSpread: 40, departureSpread: 50 },
        { flow: 'swissInbound', people: 12_322, arrival: 455, departure: 1035, arrivalSpread: 46, departureSpread: 54 },
        { flow: 'swissOutbound', people: -7_764, arrival: 445, departure: 1020, arrivalSpread: 42, departureSpread: 52 },
      ],
      home: { departure: 450, return: 1035, departureSpread: 66, returnSpread: 76 },
    },
    sources: [...currentCitySources, osmSource, ...sharedSources],
    methodNote: standardMethod('Schaffhausen', 'Germany'),
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
    data: { corridors: chauxCorridors, summary: chauxSummary },
    model: {
      populationGroups: [
        { flow: 'foreignInbound', people: 5_580, arrival: 435, departure: 1015, arrivalSpread: 40, departureSpread: 50 },
        { flow: 'swissInbound', people: 7_469, arrival: 450, departure: 1025, arrivalSpread: 46, departureSpread: 54 },
        { flow: 'swissOutbound', people: -5_158, arrival: 440, departure: 1010, arrivalSpread: 42, departureSpread: 52 },
      ],
      home: { departure: 445, return: 1025, departureSpread: 64, returnSpread: 74 },
    },
    sources: [...currentCitySources, apiGeoSource, ...sharedSources],
    methodNote: standardMethod('La Chaux-de-Fonds', 'France'),
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
  ...[
    { slug: 'chiasso', name: 'Chiasso', code: '5250', lat: 45.8353, lon: 9.03,
      neighbours: 'Italy and southern Ticino', corridors: chiassoCorridors, summary: chiassoSummary,
      bounds: [[45.55, 8.4], [46.5, 9.55]], countries: 'Italy' },
    { slug: 'mendrisio', name: 'Mendrisio', code: '5254', lat: 45.8702, lon: 8.9868,
      neighbours: 'Italy and southern Ticino', corridors: mendrisioCorridors, summary: mendrisioSummary,
      bounds: [[45.55, 8.4], [46.5, 9.55]], countries: 'Italy' },
    { slug: 'zug', name: 'Zug', code: '1711', lat: 47.1662, lon: 8.5155,
      neighbours: 'Zürich, Lucerne, Schwyz and Aargau', corridors: zugCorridors, summary: zugSummary,
      bounds: [[46.6, 7.55], [47.85, 9.5]], countries: 'Germany' },
    { slug: 'neuchatel', name: 'Neuchâtel', code: '6458', lat: 46.992, lon: 6.9311,
      neighbours: 'the Jura Arc, Bern, Fribourg and France', corridors: neuchatelCorridors, summary: neuchatelSummary,
      bounds: [[46.45, 5.85], [47.55, 7.9]], countries: 'France' },
  ].map((entry): CityConfig => {
    const data = { corridors: entry.corridors, summary: entry.summary };
    return {
      slug: entry.slug, name: entry.name, displayName: entry.name, neighbours: entry.neighbours,
      centre: { code: `CH${entry.code}`, name: entry.name, lat: entry.lat, lon: entry.lon },
      fitBounds: entry.bounds as CityConfig['fitBounds'], maxBounds: [[45.2, 4.5], [48.5, 10.7]],
      cityRadiusLongitude: 0.08, dataYears: '2020–2025', data, model: standardModel(data),
      sources: [...currentCitySources, ...(entry.countries === 'France' ? [apiGeoSource] : [osmSource]), ...sharedSources],
      methodNote: standardMethod(entry.name, entry.countries) +
        (entry.slug === 'neuchatel' ? ' Neuchâtel includes Corcelles-Cormondrèche, Peseux and Valangin, merged in 2021. Journeys between them are internal.' : '') +
        (['chiasso', 'mendrisio'].includes(entry.slug) ? ' Italian origins reuse Lugano’s existing regional allocation, scaled to this municipality’s worker total.' : ''),
    };
  }),
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
    methodNote: standardMethod('Zürich', 'Germany'),
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
    methodNote: standardMethod('Lausanne', 'France'),
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
    methodNote: standardMethod('Bern', 'France'),
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
    methodNote: standardMethod('Winterthur', 'Germany'),
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
    methodNote: standardMethod('Lucerne', 'Germany, Austria and Liechtenstein'),
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
    methodNote: standardMethod('St. Gallen', 'Austria, Germany and Liechtenstein'),
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
    methodNote: standardMethod('Biel/Bienne', 'France'),
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
  'chiasso',
  'mendrisio',
  'zug',
  'neuchatel',
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
