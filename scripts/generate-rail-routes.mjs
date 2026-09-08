import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { cities } from '../app/cities.ts';
import { distanceKm } from '../app/road-flow.ts';
import { encodePolyline, routeKey } from '../app/route-geometry.ts';

const source = 'https://zenodo.org/records/18486217';
const stationSource = 'https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/';
const hubs = {
  geneva: 8501008, zurich: 8503000, basel: 8500010, lausanne: 8501120,
  bern: 8507000, winterthur: 8506000, lucerne: 8505000, 'st-gallen': 8506302,
  lugano: 8505300, 'biel-bienne': 8504300, schaffhausen: 8503424, 'la-chaux-de-fonds': 8504314,
  chiasso: 8505307, mendrisio: 8505305, zug: 8502204, neuchatel: 8504221,
};

// swisstopo's navigation approximation (a few metres), sufficient for this map.
// https://www.swisstopo.admin.ch/dam/en/sd-web/KLRCX9XIdXDu/ch1903wgs84-EN.pdf
/** @returns {[number, number]} */
export function toWgs84(easting, northing) {
  const y = (easting - 2600000) / 1000000;
  const x = (northing - 1200000) / 1000000;
  return [
    (16.9023892 + 3.238272 * x - 0.270978 * y ** 2 - 0.002528 * x ** 2 - 0.0447 * y ** 2 * x - 0.014 * x ** 3) * 100 / 36,
    (2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x ** 2 - 0.0436 * y ** 3) * 100 / 36,
  ];
}

export function readLine(bytes) {
  const b = Buffer.from(bytes);
  if (b.toString('ascii', 0, 2) !== 'GP' || b[2] !== 0 || b[3] & 0x30) throw new Error('Unsupported GeoPackage geometry');
  const headerOrder = b[3] & 1 ? 'LE' : 'BE';
  if (b[`readInt32${headerOrder}`](4) !== 2056) throw new Error('Expected LV95 coordinates');
  const envelope = [0, 32, 48, 48, 64][(b[3] >> 1) & 7];
  if (envelope === undefined) throw new Error('Invalid GeoPackage envelope');
  const offset = 8 + envelope;
  const order = b[offset] === 1 ? 'LE' : b[offset] === 0 ? 'BE' : undefined;
  if (!order || b[`readUInt32${order}`](offset + 1) !== 2) throw new Error('Expected 2D LineString');
  const count = b[`readUInt32${order}`](offset + 5);
  if (count < 2 || offset + 9 + count * 16 !== b.length) throw new Error('Invalid LineString length');
  return Array.from({ length: count }, (_, i) => {
    const point = toWgs84(b[`readDouble${order}`](offset + 9 + i * 16), b[`readDouble${order}`](offset + 17 + i * 16));
    if (!point.every(Number.isFinite) || point[0] < 45 || point[0] > 48 || point[1] < 5 || point[1] > 11) throw new Error('Invalid Swiss rail coordinate');
    return point;
  });
}

export function shortestPaths(graph, start) {
  const starts = Array.isArray(start) ? start : [start];
  const costs = new Map(starts.map((node) => [node, 0]));
  const previous = new Map();
  const queue = starts.map((node) => [0, node]);
  while (queue.length) {
    // ponytail: ~3,000 network nodes, once per city; use a heap if the source network grows substantially.
    queue.sort((a, b) => b[0] - a[0]);
    const [cost, node] = queue.pop();
    if (cost !== costs.get(node)) continue;
    for (const edge of graph.get(node) ?? []) {
      const next = cost + edge.km;
      if (next >= (costs.get(edge.to) ?? Infinity)) continue;
      costs.set(edge.to, next);
      previous.set(edge.to, { node, edge: edge.id });
      queue.push([next, edge.to]);
    }
  }
  return { costs, previous };
}

async function generate(gpkg, stationFile) {
  const db = new DatabaseSync(gpkg, { readOnly: true });
  const table = 'Belastungswerte_Schiene_Schweiz_NPVM_2023';
  const nodes = new Map();
  const graph = new Map();
  const segments = new Map();
  for (const row of db.prepare(`SELECT NO, FROMNODENO, TONODENO, geom FROM ${table} ORDER BY fid`).iterate()) {
    if (segments.has(row.NO)) continue; // Both load directions describe the same physical segment.
    const points = readLine(row.geom);
    const from = row.FROMNODENO;
    const to = row.TONODENO;
    for (const [id, point] of [[from, points[0]], [to, points.at(-1)]]) {
      if (nodes.has(id) && distanceKm(nodes.get(id), point) > 0.01) throw new Error(`Discontinuous network node ${id}`);
      nodes.set(id, point);
    }
    const km = points.slice(1).reduce((sum, point, i) => sum + distanceKm(points[i], point), 0);
    if (!(km > 0)) throw new Error('Empty rail segment');
    segments.set(row.NO, encodePolyline(points));
    for (const [a, b, id] of [[from, to, row.NO], [to, from, -row.NO]]) {
      if (!graph.has(a)) graph.set(a, []);
      graph.get(a).push({ to: b, id, km });
    }
  }
  db.close();
  const components = new Map();
  const componentSizes = new Map();
  for (const start of nodes.keys()) {
    if (components.has(start)) continue;
    const members = new Set([start]);
    for (const node of members) for (const edge of graph.get(node) ?? []) members.add(edge.to);
    for (const node of members) components.set(node, start);
    componentSizes.set(start, members.size);
  }
  const today = new Date().toISOString().slice(0, 10);
  const records = JSON.parse(await readFile(stationFile, 'utf8'));
  if (!Array.isArray(records)) throw new Error('Expected SBB station export array');
  const stations = records.filter((s) => s.validfrom <= today && s.validto >= today && s.meansoftransport?.split(/[|,]/).includes('TRAIN') && s.geopos).map((s) => {
    const point = [s.geopos.lat, s.geopos.lon];
    if (!point.every(Number.isFinite)) throw new Error('Invalid station coordinate');
    const candidates = [...nodes].map(([id, p]) => ({ id, km: distanceKm(p, point) }))
      .filter((node) => node.km <= 0.5).sort((a, b) => a.km - b.km);
    return { id: s.number, name: s.designationofficial, commune: `CH${s.fsonumber}`, point, candidates };
  }).filter((s) => s.candidates.length && !/Autoverlad/i.test(s.name));

  for (const city of cities) {
    const hub = stations.find((s) => s.id === hubs[city.slug]);
    if (!hub) throw new Error(`Missing city station: ${city.slug}`);
    // Independent railways can terminate in the same city without sharing tracks (e.g. SZU).
    // Keep the main station, then one real city terminus for each additional connected network.
    const cityHubs = new Map();
    const centre = [city.centre.lat, city.centre.lon];
    // At shared station complexes, preserve the main railway rather than a closer tram node.
    const mainNode = [...hub.candidates].sort((a, b) => componentSizes.get(components.get(b.id)) - componentSizes.get(components.get(a.id)) || a.km - b.km)[0].id;
    for (const station of stations.filter((s) => s.commune === hub.commune)
      .sort((a, b) => Number(b.id === hub.id) - Number(a.id === hub.id) || distanceKm(a.point, centre) - distanceKm(b.point, centre))) {
      const node = station.id === hub.id ? mainNode : station.candidates[0].id;
      const component = components.get(node);
      if (!cityHubs.has(component)) cityHubs.set(component, { ...station, node });
    }
    const { costs, previous } = shortestPaths(graph, [...cityHubs.values()].map((s) => s.node));
    const connectedStations = stations.map((s) => ({ ...s, node: s.candidates.find((n) => costs.has(n.id))?.id }))
      .filter((s) => s.node !== undefined);
    const cache = { source, stationSource, networkYear: 2023, generatedAt: new Date().toISOString(), routes: {}, segments: {}, stations: {} };
    const skipped = {};
    const workplaceTrees = new Map();
    const car = JSON.parse(await readFile(new URL(`../app/data/${city.slug}-car-routes.json`, import.meta.url), 'utf8'));
    for (const c of city.data.corridors.filter((c) => c.mode === 'transit' && c.origin.code.startsWith('CH') && c.target.code.startsWith('CH'))) {
      const remote = c.direction === 'inbound' ? c.origin : c.target;
      const skip = (reason) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
      // Vaud is a canton aggregate here, not a known workplace commune or station.
      if (city.slug === 'geneva' && remote.code === 'CH22') { skip('canton destination'); continue; }
      const point = car.communePoints?.[remote.code] ?? [remote.lat, remote.lon];
      // Only use a station in the actual commune, near its settlement. Do not invent bus access legs.
      const workplace = c.direction === 'inbound' ? c.target : c.origin;
      let routeCosts = costs, routePrevious = previous, routeStations = connectedStations, routeHubs = cityHubs;
      if (workplace.code !== hub.commune) {
        if (!workplaceTrees.has(workplace.code)) {
          const location = car.communePoints?.[workplace.code] ?? [workplace.lat, workplace.lon];
          const stop = stations.filter((s) => s.commune === workplace.code && distanceKm(s.point, location) <= 5)
            .sort((a, b) => distanceKm(a.point, location) - distanceKm(b.point, location))[0];
          if (stop) {
            const node = [...stop.candidates].sort((a, b) => componentSizes.get(components.get(b.id)) - componentSizes.get(components.get(a.id)) || a.km - b.km)[0].id;
            const tree = shortestPaths(graph, node);
            workplaceTrees.set(workplace.code, { ...tree, hubs: new Map([[components.get(node), { ...stop, node }]]),
              stations: stations.map((s) => ({ ...s, node: s.candidates.find((n) => tree.costs.has(n.id))?.id })).filter((s) => s.node !== undefined) });
          } else workplaceTrees.set(workplace.code, null);
        }
        const tree = workplaceTrees.get(workplace.code);
        if (!tree) { skip('no rail station in workplace commune'); continue; }
        routeCosts = tree.costs; routePrevious = tree.previous; routeStations = tree.stations; routeHubs = tree.hubs;
      }
      const station = routeStations.filter((s) => s.commune === remote.code && distanceKm(s.point, point) <= 5)
        .sort((a, b) => Number(Object.values(hubs).includes(b.id)) - Number(Object.values(hubs).includes(a.id)) ||
          distanceKm(a.point, point) - distanceKm(b.point, point))[0];
      if (!station) { skip('no connected rail station in commune'); continue; }
      const destination = routeHubs.get(components.get(station.node));
      if (!routePrevious.has(station.node)) { skip('no connected rail path'); continue; }
      if (routeCosts.get(station.node) > Math.max(10, distanceKm(station.point, destination.point) * 3)) { skip('excessive detour'); continue; }
      const edges = [];
      for (let node = station.node; node !== destination.node;) {
        const step = routePrevious.get(node);
        edges.push(-step.edge);
        node = step.node;
      }
      if (c.direction === 'outbound') edges.reverse().forEach((id, i) => { edges[i] = -id; });
      cache.routes[routeKey(city.slug, c)] = { edges, from: c.direction === 'inbound' ? station.id : destination.id, to: c.direction === 'inbound' ? destination.id : station.id };
      edges.forEach((id) => { cache.segments[Math.abs(id)] = segments.get(Math.abs(id)); });
      for (const s of [station, destination]) cache.stations[s.id] = { name: s.name, point: s.point };
    }
    if (!Object.keys(cache.routes).length) throw new Error(`No rail routes for ${city.slug}`);
    const output = new URL(`../app/data/${city.slug}-rail-routes.json`, import.meta.url);
    const temporary = new URL(`${output.href}.tmp`);
    await writeFile(temporary, `${JSON.stringify(cache)}\n`);
    await rename(temporary, output);
    console.log(`${city.slug}: ${Object.keys(cache.routes).length} routes, ${Object.keys(cache.segments).length} shared segments; skipped ${JSON.stringify(skipped)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4) throw new Error('Usage: npm run routes:rail -- /path/to/rail.gpkg /path/to/stations.json');
  await generate(process.argv[2], process.argv[3]);
}
