// Read-only audit of the shipped model. No routing requests and no application mutations.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cities } from '../app/cities.ts';
import { createJourneyModel, transportModes, transportLabels } from '../app/model.ts';
import { routeKey, decodePolyline, prepareRailRoutes } from '../app/route-geometry.ts';
import { routeGeometries } from '../app/data/route-geometries.ts';
import { prepareCarRoute, distanceKm, departureShare } from '../app/road-flow.ts';
import { activeLocations } from './generate-active-routes.mjs';
import { commuteModeShares } from '../app/data/create-city-data.ts';
import { prepareMapData } from '../app/map-data.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(root, process.argv.find(a => a.startsWith('--output='))?.slice(9) ?? 'audits/2026-09-06-priorities');
fs.mkdirSync(output, { recursive: true });
for (const file of ['fso-commune-matrix-original','ocstat-commuters.xlsx','fso-modes.xml','fso-mode-definitions.xml','fso-cross-border-totals.json','insee-swiss-aggregates.json']) {
  if (!fs.existsSync(path.join(output,'sources',file))) throw new Error(`Missing required audit input: sources/${file}. See the audit README; do not treat missing-source checks as passed.`);
}
const sum = (rows, field = 'commuters') => rows.reduce((n, row) => n + row[field], 0);
const flowGroup = c => c.direction === 'outbound' ? 'swissOutbound' : c.origin.code.startsWith('CH') ? 'swissInbound' : 'foreignInbound';
const percent = (n, d) => d ? 100 * n / d : null;
const checks = [], cityRows = [], modes = [], groups = [], routes = [], hourly = [], reconciliation = [], reciprocal = [], sourceComparisons = [];
function check(city, name, actual, expected, ok, severity = 'high') {
  checks.push({ city, check: name, actual, expected, status: ok ? 'pass' : 'fail', severity });
}
const manifest = [];
function track(file) {
  const bytes = fs.readFileSync(path.join(root, file));
  manifest.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  return bytes.toString();
}
const source = JSON.parse(execFileSync('python3', [path.join(root, 'scripts/audit-sources.py'), path.join(output, 'sources'), cities.map(c => c.centre.code.slice(2)).join(',')], { maxBuffer: 20 * 1024 * 1024 }));
if (!source.genevaVaudModes) throw new Error('Missing OCT 2022 PDF for independent Vaud mode reconciliation');
const vaudPoint = { code: 'CH5586' }, genevaPoint = { code: 'CH6621' };
for (const [direction, pair] of [['inbound', [vaudPoint, genevaPoint]], ['outbound', [genevaPoint, vaudPoint]]]) {
  const shares = commuteModeShares(...pair), counts = source.genevaVaudModes[direction];
  for (const mode of ['car', 'transit', 'unknown']) check('geneva', `OCT 2020 Vaud ${direction} ${mode} share`, shares[mode], counts[mode] / counts.total, Math.abs(shares[mode] - counts[mode] / counts.total) < 1e-10);
  check('geneva', `Vaud ${direction} other modes are not classified as active`, shares.soft, 0, shares.soft === 0);
}
check('all', 'Original 2020 matrix is present and has unique perspective/OD rows', source.matrix.duplicateKeys2020, 0,
  source.matrix.rowsByYear['2020'] > 0 && source.matrix.duplicateKeys2020 === 0);
for (const file of ['app/cities.ts', 'app/model.ts', 'app/data/create-city-data.ts', 'app/data/resident-mode-shares.json', 'app/data/commune-centres.json', 'app/road-flow.ts', 'app/route-geometry.ts', 'app/data/route-geometries.ts', 'app/components/commute-dashboard.tsx', 'app/[city]/page.tsx', ...fs.readdirSync(path.join(root, 'scripts')).filter(f => /\.(mjs|py)$/.test(f)).map(f => `scripts/${f}`)]) track(file);
// Guard the shared UI journey model and its departure distribution.
track('app/map-data.ts');
track('app/page.tsx');
for (const city of cities) {
  const cs = city.data.corridors, summary = city.data.summary, slug = city.slug;
  track(`app/data/${slug}.ts`);
  const car = JSON.parse(track(`app/data/${slug}-car-routes.json`));
  const rail = JSON.parse(track(`app/data/${slug}-rail-routes.json`));
  const active = JSON.parse(track(`app/data/${slug}-active-routes.json`));
  const transit = slug === 'geneva' ? JSON.parse(track(`app/data/${slug}-transit-routes.json`)) : { routes: {} };
  const activeComplete = Object.fromEntries(Object.entries(active.routes).filter(([k, p]) => p.toWork && p.toHome && !active.skipped[k]));
  const railPrepared = prepareRailRoutes(rail);
  const keys = new Set(cs.map(c => routeKey(slug, c)));
  check(slug, 'Unique corridor keys', cs.length - keys.size, 0, keys.size === cs.length);
  const invalid = cs.filter(c => !Number.isInteger(c.commuters) || c.commuters <= 0 || ![...transportModes, 'unknown'].includes(c.mode) || !['inbound', 'outbound'].includes(c.direction) || !c.source || [c.origin, c.target].some(p => !p.code || !p.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180));
  check(slug, 'Valid corridor values', invalid.length, 0, invalid.length === 0);
  check(slug, 'Corridor count agrees with summary', cs.length, summary.corridors, cs.length === summary.corridors);
  const internal = sum(cs.filter(c => c.origin.code === c.target.code));
  const roadJourneys = [];
  const { journeys, communeNodes } = prepareMapData(cs, slug, car.routes, rail, activeComplete, transit.routes);
  for (const c of cs) {
    const key = routeKey(slug, c), pair = c.mode === 'car' ? car.routes[key] : c.mode === 'soft' ? activeComplete[key] : transit.routes[key];
    const train = railPrepared.routes.get(key);
    const preview = c.mode === 'transit' && !train && routeGeometries[key];
    const geometry = pair?.toWork && pair?.toHome ? (c.mode === 'car' ? 'road' : c.mode === 'transit' ? 'timetable' : pair.costing) : train ? 'rail' : preview ? 'transit preview' : 'missing';
    let toWork, toHome, km = null, seconds = null, snap = null, geometryErrors = [];
    if (pair?.toWork && pair?.toHome) {
      try {
        toWork = prepareCarRoute(pair.toWork); toHome = prepareCarRoute(pair.toHome);
        const loc = pair.locations;
        for (const [r, targetLocations] of [[toWork, loc], [toHome, pair.returnLocations ?? [loc[2], loc[3], loc[0], loc[1]]]]) {
          if (r.points.length < 2 || r.minutes.length !== r.points.length || !(r.duration > 0) || r.points.some(p => p.some(v => !Number.isFinite(v))) || r.minutes.some((v, i) => !Number.isFinite(v) || (i > 0 && v < r.minutes[i - 1]))) geometryErrors.push('invalid timing/geometry');
          const endpointError = Math.max(distanceKm(r.points[0], targetLocations.slice(0, 2)), distanceKm(r.points.at(-1), targetLocations.slice(2)));
          snap = Math.max(snap ?? 0, endpointError);
        }
        km = toWork.points.slice(1).reduce((n, p, i) => n + distanceKm(toWork.points[i], p), 0);
        seconds = pair.toWork.seconds;
        if (snap > (c.mode === 'soft' ? 0.4 : 1)) geometryErrors.push('endpoint snap exceeds review threshold');
        if (c.mode === 'soft' && (km > 35 || seconds > 10800)) geometryErrors.push('active route exceeds limits');
      } catch (error) { geometryErrors.push(error.message); }
    } else if (train) {
      km = train.points.slice(1).reduce((n, p, i) => n + distanceKm(train.points[i], p), 0);
    }
    const directKm = distanceKm([c.origin.lat, c.origin.lon], [c.target.lat, c.target.lon]);
    const eligible = !!activeLocations(city, c, car.communePoints ?? {});
    const row = { city: slug, key, origin: c.origin.code, originName: c.origin.name, target: c.target.code, targetName: c.target.name, mode: c.mode, direction: c.direction, group: flowGroup(c), commuters: c.commuters, source: c.source, geometry, directKm, routeKm: km, seconds, snapKm: snap, activeEligible: eligible, geometryErrors: geometryErrors.join('; '), skippedReason: (c.mode === 'transit' ? transit.skipped?.[key] : active.skipped[key]) ?? '' };
    routes.push(row);
    if (geometry === 'missing') continue;
    if (c.mode === 'car' && toWork) { roadJourneys.push({ c, work: toWork.duration, home: toHome.duration }); continue; }

  }
  const localRows = routes.filter(r => r.city === slug);
  const expectedKeys = new Set(localRows.filter(r => r.geometry !== 'missing').map(r => r.key));
  const actualKeys = new Set(journeys.map(j => routeKey(slug, j.corridor)));
  check(slug, 'UI journeys match independently inspected route coverage', actualKeys.size, expectedKeys.size,
    actualKeys.size === expectedKeys.size && [...actualKeys].every(key => expectedKeys.has(key)));
  check(slug, 'Commune markers use the routed cohort', communeNodes.reduce((n, node) => n + Object.values(node.byMode).reduce((a, b) => a + b, 0), 0),
    sum(journeys.map(j => j.corridor)), communeNodes.reduce((n, node) => n + Object.values(node.byMode).reduce((a, b) => a + b, 0), 0) === sum(journeys.map(j => j.corridor)));
  for (const [name, cache] of [['car', car.routes], ['rail', rail.routes], ['active', active.routes], ['transit', transit.routes]]) {
    const orphans = Object.keys(cache).filter(k => !keys.has(k));
    check(slug, `${name} cache references current corridors`, orphans.length, 0, orphans.length === 0, 'medium');
  }
  if (transit.evidence) {
    const badEvidence = Object.entries(transit.routes).filter(([key, pair]) => ['toWork', 'toHome'].some(direction => {
      const evidence = transit.evidence[key]?.[direction], legs = evidence?.legs;
      return !Array.isArray(legs) || !legs.some(l => l.mode !== 'WALK' && l.tripId && l.routeId) ||
        !evidence.startTime.startsWith(transit.serviceDate) || !evidence.endTime.startsWith(transit.serviceDate) ||
        (Date.parse(evidence.endTime) - Date.parse(evidence.startTime)) / 1000 !== pair[direction].seconds;
    }));
    check(slug, 'Timetable routes have dated service evidence and matching durations', badEvidence.length, 0, badEvidence.length === 0);
    const extraEvidence = Object.keys(transit.evidence).filter(key => !transit.routes[key]);
    check(slug, 'Timetable evidence references accepted routes', extraEvidence.length, 0, extraEvidence.length === 0);
  }
  const errors = localRows.filter(r => r.geometryErrors);
  const invalidGeometry = errors.filter(r => r.geometryErrors !== 'endpoint snap exceeds review threshold');
  check(slug, 'Route geometry and travel times', invalidGeometry.length, 0, invalidGeometry.length === 0);
  check(slug, 'Route endpoint snap within review threshold', errors.length - invalidGeometry.length, 0, errors.length === invalidGeometry.length, 'medium');
  let railErrors = 0;
  for (const r of Object.values(rail.routes)) {
    if (!rail.stations[r.from] || !rail.stations[r.to]) { railErrors++; continue; }
    let prev;
    for (const edge of r.edges) {
      if (!rail.segments[Math.abs(edge)]) { railErrors++; continue; }
      const points = decodePolyline(rail.segments[Math.abs(edge)]), oriented = edge < 0 ? points.reverse() : points;
      if (prev && distanceKm(prev, oriented[0]) > 0.02) railErrors++;
      prev = oriented.at(-1);
    }
  }
  check(slug, 'Rail edge and station integrity', railErrors, 0, railErrors === 0);
  for (const direction of ['inbound', 'outbound']) for (const mode of [...transportModes, 'unknown']) {
    const rows = localRows.filter(r => r.direction === direction && r.mode === mode);
    const total = sum(rows), covered = sum(rows.filter(r => r.geometry !== 'missing'));
    const eligiblePeople = sum(rows.filter(r => r.activeEligible));
    const represented = sum(rows.filter(r => r.geometry !== 'missing').map(r => ({ commuters: r.representedPeople ?? r.commuters })));
    modes.push({ city: slug, mode, direction, people: total, covered, represented, coveragePct: percent(covered, total), pairs: rows.length, routedPairs: rows.filter(r => r.geometry !== 'missing').length, eligiblePeople, localCoveragePct: percent(covered, eligiblePeople), longDistancePeople: sum(rows.filter(r => r.directKm > 25)) });
    if (mode === 'car') check(slug, `Car coverage ${direction} at least 95% of mapped estimates`, percent(covered, total), 95, !total || covered / total >= 0.95);
  }
  const config = city.model, all = createJourneyModel(journeys), singles = transportModes.map(mode => createJourneyModel(journeys, [mode]));
  check(slug, 'Unspecified modes do not enter routed journeys', journeys.filter(j => j.corridor.mode === 'unknown').length, 0, journeys.every(j => j.corridor.mode !== 'unknown'));
  const maxAdditivity = Math.max(...all.populationSeries.map(p => Math.abs(singles.reduce((n, m) => n + m.populationChange(p.minute), 0) - p.value)));
  check(slug, 'Mode filters add to all-mode population within rounding', maxAdditivity, 2, maxAdditivity <= 2);
  const none = createJourneyModel(journeys, []);
  check(slug, 'No modes gives zero population change', Math.max(...none.populationSeries.map(p => Math.abs(p.value))), 0, none.populationSeries.every(p => p.value === 0));
  for (const g of config.populationGroups) {
    const rows = cs.filter(c => flowGroup(c) === g.flow), total = sum(rows);
    const expected = g.flow === 'foreignInbound' ? summary.borderWorkers2025 ?? summary.frenchCommuters2023 : g.flow === 'swissInbound' ? summary.swissInbound2020 ?? summary.vaudToGeneva2024 : summary.swissOutbound2020 ?? summary.genevaToVaud2024;
    const mappedExpected = g.flow === 'foreignInbound' ? expected : g.flow === 'swissInbound' ? summary.mappedSwissInbound2020 ?? summary.mappedVaudToGeneva2024 ?? expected : summary.mappedSwissOutbound2020 ?? summary.mappedGenevaToVaud2024 ?? expected;
    check(slug, `${g.flow} rows conserve mapped summary`, total, mappedExpected, total === mappedExpected);
    check(slug, `${g.flow} population scope matches summary`, Math.abs(g.people), expected, Math.abs(g.people) === expected);
    groups.push({ city: slug, group: g.flow, mappedPeople: total, summaryPeople: expected, modelPeople: Math.abs(g.people), omittedFromMap: expected - total, coveragePct: percent(total, expected), carPct: percent(sum(rows.filter(c => c.mode === 'car')), total), transitPct: percent(sum(rows.filter(c => c.mode === 'transit')), total), softPct: percent(sum(rows.filter(c => c.mode === 'soft')), total), unknownPct: percent(sum(rows.filter(c => c.mode === 'unknown')), total) });
  }
  const ownCode = city.centre.code.slice(2), pairs = source.matrix.pairs ?? {};
  if (slug !== 'geneva') {
    const original = source.modeTable[ownCode];
    check(slug, 'Original resident mode counts are available', !!original, true, !!original);
    if (original) {
      const text = fs.readFileSync(path.join(root, `app/data/${slug}.ts`), 'utf8');
      const shares = JSON.parse(text.match(/modeShares: (\{[^\n]+\})/)[1].replace(/,$/, ''));
      const total = original['OBS:pen_t'];
      for (const [mode, count] of [['car', original['OBS:pen_tim']], ['transit', original['OBS:pen_tp']], ['soft', total - original['OBS:pen_tim'] - original['OBS:pen_tp']]]) {
        sourceComparisons.push({ city: slug, source: 'FSO 2023 resident commuters', category: mode, originalPeople: count, appShare: shares[mode], originalShare: count / total });
        check(slug, `FSO 2023 ${mode} share copied accurately`, shares[mode], count / total, Math.abs(shares[mode] - count / total) < 1e-9);
      }
    }
    const border = source.borderWorkers?.[ownCode.padStart(4, '0')];
    check(slug, 'Original border-worker total is available', border !== undefined, true, border !== undefined);
    if (border !== undefined) {
      check(slug, 'FSO Q4 2025 border-worker total rounded correctly', summary.borderWorkers2025, Math.round(border), summary.borderWorkers2025 === Math.round(border));
      sourceComparisons.push({ city: slug, source: 'FSO Q4 2025 border workers', category: 'total', originalPeople: border, appPeople: summary.borderWorkers2025 });
    }
    // Independently transcribed from the preserved comparison PDF, Figure 22, page 20.
    const benchmark = { basel: [31,56,13], bern: [35,58,6], lucerne: [44,46,9], 'st-gallen': [56,42,2], winterthur: [49,46,5], zurich: [28,69,2] }[slug];
    if (benchmark) {
      const inbound = cs.filter(c => c.direction === 'inbound' && c.origin.code.startsWith('CH'));
      const roundingBound = new Set(inbound.map(c => c.origin.code)).size;
      for (const [i, mode] of transportModes.entries()) {
        const expected = sum(inbound) * benchmark[i] / benchmark.reduce((n,v) => n + v, 0);
        const actual = sum(inbound.filter(c => c.mode === mode));
        check(slug, `${mode} inbound uses domestic-worker benchmark within per-pair rounding`, actual, expected, Math.abs(actual - expected) < roundingBound);
      }
    }
  }
  if (slug !== 'geneva' && Object.keys(pairs).length) {
    for (const [perspective, direction, summaryField] of [['W', 'inbound', 'swissInbound2020'], ['R', 'outbound', 'swissOutbound2020']]) {
      const originalTotal = Object.entries(pairs).filter(([k]) => { const [p, res, work] = k.split(':'); return p === perspective && res !== work && (direction === 'inbound' ? work : res) === ownCode; }).reduce((n, [, v]) => n + v, 0);
      check(slug, `Original FSO 2020 ${direction} total`, summary[summaryField], originalTotal, summary[summaryField] === originalTotal);
      const byRemote = new Map();
      cs.filter(c => c.direction === direction && c.origin.code.startsWith('CH') && c.target.code.startsWith('CH')).forEach(c => { const code = (direction === 'inbound' ? c.origin : c.target).code.slice(2); byRemote.set(code, (byRemote.get(code) ?? 0) + c.commuters); });
      let mismatch = 0;
      for (const [remote, value] of byRemote) {
        const key = direction === 'inbound' ? `${perspective}:${remote}:${ownCode}` : `${perspective}:${ownCode}:${remote}`;
        const original = pairs[key];
        if (value !== original) { mismatch++; reconciliation.push({ city: slug, direction, remote, app: value, original: original ?? null, delta: original === undefined ? null : value - original }); }
      }
      check(slug, `Every mapped FSO ${direction} pair matches original`, mismatch, 0, mismatch === 0);
    }
  }
  const timeRows = [];
  const mappedModel = createJourneyModel(journeys, ['car']);
  for (let minute = 0; minute <= 1440; minute += 5) {
    const carNow = Math.round(roadJourneys.reduce((n, j) => n + j.c.commuters * (departureShare(minute) - departureShare(minute - j.work) + departureShare(minute, true) - departureShare(minute - j.home, true)), 0));
    const routePopulation = roadJourneys.reduce((n, j) => n + j.c.commuters * (j.c.direction === 'inbound' ? departureShare(minute - j.work) - departureShare(minute, true) : -departureShare(minute) + departureShare(minute - j.home, true)), 0);
    timeRows.push({ city: slug, minute, carNow, transitNow: singles[1].travelling(minute), activeNow: singles[2].travelling(minute), populationChange: all.populationChange(minute), vsDailyAverage: all.populationChange(minute) - all.dailyAverage, routeDerivedCarPopulation: Math.round(routePopulation), curveCarPopulationSameCoverage: mappedModel.populationChange(minute) });
  }
  hourly.push(...timeRows);
  const mismatches = timeRows.map(r => ({ minute: r.minute, delta: r.curveCarPopulationSameCoverage - r.routeDerivedCarPopulation }));
  const worst = mismatches.reduce((a, b) => Math.abs(a.delta) > Math.abs(b.delta) ? a : b);
  check(slug, 'Population follows the routed departure and arrival model', worst.delta, 0, worst.delta === 0);
  const phantomActive = journeys.filter(j => j.corridor.mode === 'soft' && !activeLocations(city, j.corridor, car.communePoints));
  check(slug, 'No nonlocal active journeys affect the chart', phantomActive.length, 0, phantomActive.length === 0);
  cityRows.push({ city: slug, name: city.name, rows: cs.length, odPairs: new Set(cs.map(c => `${c.origin.code}>${c.target.code}:${c.direction}`)).size, internalPeople: internal, mappedPeople: sum(cs), carPeople: sum(cs.filter(c => c.mode === 'car')), carNow0745: timeRows.find(r => r.minute === 465).carNow, carNow1200: timeRows.find(r => r.minute === 720).carNow, peakCarNow: Math.max(...timeRows.map(r => r.carNow)), peakPopulation: all.dailyPeak.value, dailyAverage: all.dailyAverage, populationCarDisagreement: worst.delta, disagreementMinute: worst.minute, carCacheDate: car.generatedAt, railCacheDate: rail.generatedAt, activeCacheDate: active.generatedAt, activeSkippedPairs: Object.keys(active.skipped).length });
}
// A single OD pair appears on both city pages; all-mode counts should be reconcilable.
for (const a of cities.filter(c => c.slug !== 'geneva')) for (const b of cities.filter(c => c.slug !== 'geneva' && c.slug !== a.slug)) {
  const outgoing = a.data.corridors.filter(c => c.direction === 'outbound' && c.target.code === b.centre.code);
  const incoming = b.data.corridors.filter(c => c.direction === 'inbound' && c.origin.code === a.centre.code);
  if (!outgoing.length || !incoming.length) continue;
  for (const mode of ['all', ...transportModes, 'unknown']) {
    const x = sum(outgoing.filter(c => mode === 'all' || c.mode === mode)), y = sum(incoming.filter(c => mode === 'all' || c.mode === mode));
    reciprocal.push({ origin: a.slug, target: b.slug, mode, originPage: x, targetPage: y, delta: y - x });
  }
}
const oc = source.ocstat.cells;
if (oc) {
  const geneva = cities.find(c => c.slug === 'geneva');
  check('geneva', 'OCSTAT Vaud inbound summary', geneva.data.summary.vaudToGeneva2024, +oc.E15, geneva.data.summary.vaudToGeneva2024 === +oc.E15);
  check('geneva', 'OCSTAT Vaud outbound summary', geneva.data.summary.genevaToVaud2024, +oc.B15, geneva.data.summary.genevaToVaud2024 === +oc.B15);
  check('geneva', 'Consistent Vaud-only outbound population', -geneva.model.populationGroups.find(g => g.flow === 'swissOutbound').people, +oc.B15, -geneva.model.populationGroups.find(g => g.flow === 'swissOutbound').people === +oc.B15);
  check('geneva', 'Display name is Geneva', geneva.displayName, 'Geneva', geneva.displayName === 'Geneva');
}
for (const pair of reciprocal) check(`${pair.origin} → ${pair.target}`, `Same OD ${pair.mode} allocation on both city pages`, pair.originPage, pair.targetPage, pair.originPage === pair.targetPage);
check('all', 'Motorcycle category is disclosed', transportLabels.car, 'Car / motorcycle', transportLabels.car === 'Car / motorcycle');
const inseePath = path.join(output, 'sources/insee-swiss-aggregates.json');
let french = null;
if (fs.existsSync(inseePath)) {
  const original = JSON.parse(fs.readFileSync(inseePath));
  // INSEE's SUC destination codes cover the 45 Geneva canton communes; retain that explicit filter.
  const rows = original.rows.filter(r => /^FR(01|74)/.test(r.origin) && r.destination.startsWith('SUC'));
  const byMode = Object.fromEntries(['1','2','3','4','5','6'].map(trans => [trans, sum(rows.filter(r => r.trans === trans), 'people')]));
  const normalise = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s*\([A-Z]{2}\)$/, '').replace(/[^A-Z]/g, '');
  const destinationNames = Object.fromEntries(original.destinations.map(d => [d.code, normalise(d.name)]));
  const byOriginMode = {};
  for (const r of rows) {
    if (r.trans === '1') continue;
    const mode = r.trans === '6' ? 'transit' : ['4','5'].includes(r.trans) ? 'car' : 'soft';
    const key = `${r.origin}:${destinationNames[r.destination]}:${mode}`;
    byOriginMode[key] = (byOriginMode[key] ?? 0) + r.people;
  }
  const cs = cities.find(c => c.slug === 'geneva').data.corridors.filter(c => c.origin.code.startsWith('FR'));
  const mismatches = cs.filter(c => c.commuters !== Math.round(byOriginMode[`${c.origin.code}:${normalise(c.target.name)}:${c.mode}`] ?? 0));
  const appKeys = new Set(cs.map(c => `${c.origin.code}:${normalise(c.target.name)}:${c.mode}`));
  const omitted = Object.entries(byOriginMode).filter(([k, v]) => Math.round(v) > 0 && !appKeys.has(k));
  check('geneva', 'INSEE French origin-mode totals reproduce after rounding', mismatches.length, 0, !mismatches.length);
  check('geneva', 'INSEE positive rounded origin-mode rows are complete', omitted.length, 0, !omitted.length);
  check('geneva', 'INSEE no-journey category is explicitly excluded', cities.find(c => c.slug === 'geneva').data.summary.excludedNoJourney2023, byMode['1'], Math.abs(cities.find(c => c.slug === 'geneva').data.summary.excludedNoJourney2023 - byMode['1']) < 1e-6);
  check('geneva', 'French workplace communes are retained', new Set(cs.map(c => c.target.code)).size, 45, new Set(cs.map(c => c.target.code)).size === 45);
  const rawSum = Object.values(byOriginMode).reduce((n, v) => n + v, 0);
  french = { filter: 'COMMUNE in departments 01/74; DCFLT starts SUC; exclude TRANS=1; sum IPONDI; round once per origin, workplace commune and app category', rawSum, roundedSum: Object.values(byOriginMode).reduce((n, v) => n + Math.round(v), 0), byOriginalMode: byMode, comparedRows: cs.length, mismatches: mismatches.length, omitted, archiveSha256: original.sha256, rowsRead: original.rowsRead };
}
const result = { generatedAt: new Date().toISOString(), cityRows, groups, modes, routes, hourly, checks, reconciliation, reciprocal, sourceComparisons, french, manifest, originalSources: source };
fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(result, null, 2) + '\n');
for (const [name, rows] of Object.entries({ cities: cityRows, groups, coverage: modes, corridors: routes, timeseries: hourly, checks, reconciliation, reciprocal, sourceComparisons })) {
  const cols = [...new Set(rows.flatMap(Object.keys))];
  const cell = x => '"' + String(x ?? '').replaceAll('"', '""') + '"';
  fs.writeFileSync(path.join(output, `${name}.csv`), [cols.map(cell).join(','), ...rows.map(r => cols.map(k => cell(r[k])).join(','))].join('\n') + '\n');
}
console.log(JSON.stringify({ cities: cities.length, corridors: routes.length, checks: checks.length, failures: checks.filter(c => c.status === 'fail'), output }, null, 2));
if (process.argv.includes('--strict') && checks.some(c => c.status === 'fail')) process.exitCode = 1;
