import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.resolve(root, process.argv[2] ?? 'audits/2026-09-06');
const a = JSON.parse(fs.readFileSync(path.join(dir, 'audit.json')));
const n = value => Math.round(value).toLocaleString('en-CH');
const pct = value => `${value.toFixed(1)}%`;
const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);
const names = Object.fromEntries(a.cityRows.map(c => [c.city, c.name]));
const z = a.cityRows.find(c => c.city === 'zurich');
const failures = a.checks.filter(c => c.status === 'fail');
const coverage = a.cityRows.flatMap(c => ['car', 'transit', 'soft'].map(mode => {
  const rows = a.modes.filter(r => r.city === c.city && r.mode === mode);
  const people = sum(rows, 'people'), covered = sum(rows, 'covered');
  return { city: c.name, slug: c.city, mode: {car: 'Car category', transit: 'Public transport', soft: 'Walk / bike category'}[mode], people, covered, missing: people - covered, coverage: covered / people, eligiblePeople: sum(rows, 'eligiblePeople') };
}));
const genevaPt = coverage.find(r => r.slug === 'geneva' && r.mode === 'Public transport');
const activeLong = a.routes.filter(r => r.mode === 'soft' && r.directKm > 25);
const comparisonUrl = 'https://www.stadt-zuerich.ch/content/dam/web/de/aktuell/publikationen/2023/staedtevergleich-mobilitaet-2021/staedtevergleich-mobilitaet-2021.pdf';
// Transcribed from Figure 22, printed page 20. Main mode of domestic inbound workers,
// pooled 2019–2021. MIV includes motorcycles. Rounded published percentages need not total 100.
const benchmarks = [['basel',31,56,13],['bern',35,58,6],['lucerne',44,46,9],['st-gallen',56,42,2],['winterthur',49,46,5],['zurich',28,69,2]].map(([city, motor, pt, active]) => {
  const g = a.groups.find(g => g.city === city && g.group === 'swissInbound');
  const resident = a.sourceComparisons.find(r => r.city === city && r.category === 'car' && r.appShare !== undefined);
  return { city: names[city], slug: city, appliedMivShare: resident.appShare, inboundMivShare: motor / 100, inboundPtShare: pt / 100, inboundActiveShare: active / 100, mappedInbound: g.mappedPeople, gapPoints: motor - resident.appShare * 100, source: comparisonUrl, period: '2019–2021', page: 20 };
});
const benchmarkRows = benchmarks.flatMap(b => [
  {...b, basis: 'Resident · 2023', share: b.appliedMivShare},
  {...b, basis: 'Incoming · 2019–21', share: b.inboundMivShare},
]);
const findings = [];
function finding(id, severity, kind, scope, title, evidence, impact, action, location, confidence = 'High') {
  findings.push({ id, severity, kind, confidence, scope, title, evidence, impact, action, location });
}
finding('F01','High','Confirmed scope error','11 cities','Resident transport shares are applied to incoming workers',
  'The FSO concept is “Pendler (Weg- und Binnenpendler)”: outgoing and within-commune commuters. All 33 copied mode shares match the source, but createCityData applies them to all three flow groups. Zürich applies 16.4% MIV to incoming workers.',
  'Mode counts can be substantially biased even when their sum is correct.',
  'Use direction-appropriate shares or observed OD-by-mode data. Keep resident-only shares attached to their proper population; show uncertainty for inferred pairs.',
  'app/data/create-city-data.ts; sources/fso-mode-definitions.xml; sourceComparisons.csv');
finding('F02','High','Confirmed inconsistency','14 shared directed city pairs','One journey gets different mode counts on different city pages',
  'All 14 shared all-mode totals agree. All 14 car allocations disagree. Winterthur → Zürich: 3,430 on Winterthur’s page; 1,826 on Zürich’s page.',
  'Changing the selected city changes the inferred mode of the same commuters.',
  'Allocate mode once for each origin–destination pair. Add a cross-city consistency gate, allowing a documented small rounding tolerance.',
  'reciprocal.csv; app/data/create-city-data.ts');
finding('F03','High','Confirmed category error','All 12 cities','The Car label includes motorcycles',
  `FSO pen_tim is motorised private transport. Geneva reproduces TRANS 4 + 5; this includes ${n(a.french.byOriginalMode['4'])} weighted motorcycle commuters before rounding.`,
  'The page cannot claim a car-only or vehicle count.',
  'Label the current category “Car / motorcycle”, or acquire car-only data. Keep people distinct from vehicles and document vehicle occupancy if conversion is added.',
  'sources/fso-mode-definitions.xml; sources/insee-swiss-aggregates.json; app/model.ts');
finding('F04','High','Confirmed category error','Geneva','No-transport records are animated as walking or cycling',
  `All 714 French origin-mode rows reproduce exactly when soft = TRANS 1 + 2 + 3. TRANS 1 contributes ${a.french.byOriginalMode['1'].toFixed(2)} weighted people, or about ${n(a.french.byOriginalMode['1'])}.`,
  'People reporting no journey inflate the active-travel animation and commuting population.',
  'Exclude TRANS 1 from travel, keep walking and cycling separate in the import, and recalculate affected totals.',
  'scripts/audit-insee.py; audit.json:french; INSEE TRANS codebook');
finding('F05','High','Unverified category inference','11 cities','Walk / bike is a residual rather than a separately downloaded count',
  'The FSO table supplies total, public transport and MIV. The project assigns total − public transport − MIV entirely to soft. No separate active category or exclusion rules were preserved.',
  'A residual may include unclassified modes; it is not evidence of bicycle counts. A distance rule then chooses walking under 3 km and cycling beyond it.',
  'Verify the residual’s definition or import explicit active-mode counts. Preserve unknown modes instead of silently assigning them.',
  'sources/fso-modes.xml; scripts/generate-top-city-data.mjs; scripts/generate-active-routes.mjs','Medium');
finding('F06','High','Confirmed scope inconsistency','Geneva','The population model mixes Vaud-only arrivals with all departures',
  'OCSTAT 2024: Vaud inbound 23,398; all-canton inbound 25,628; Vaud outbound 6,881; all outbound 8,703. The model uses 23,398 and −8,703. The missing inbound group is 2,230; the extra outbound group is 1,822.',
  'Its daytime population change is about 2,230 below an all-canton construction with the same timing. The outgoing group also includes foreign or unknown workplaces, so “swissOutbound” is inaccurate.',
  'Choose a consistent canton scope, add the other-canton arrivals, and distinguish Vaud, other Swiss, foreign and unknown outgoing groups.',
  'app/cities.ts; sources/ocstat-commuters.xlsx:2024!B15:F22');
finding('F07','High','Confirmed geographic mismatch','Geneva versus other cities','Geneva uses canton flows while other pages use city communes',
  'Geneva aggregates French workers in 45 SUC workplace communes into CH25 “Geneva workplaces”, and uses canton-level OCSTAT totals. Other city endpoints are individual communes. The INSEE file retains the real workplace communes.',
  'City-to-city totals are not directly comparable; routing canton-wide workers to central Geneva overstates particular central approaches.',
  'Name the region explicitly and route French commuters to their known workplace commune. Do not compare the Geneva canton total with municipal totals as equivalent units.',
  'app/data/geneva.ts; sources/insee-swiss-aggregates.json; sources/ocstat-commuters.xlsx');
finding('F08','High','Coverage limitation','All cities','Displayed transport modes have unequal coverage',
  `Car routes cover at least 95% of mapped estimates in both directions. Geneva public transport covers ${n(genevaPt.covered)} of ${n(genevaPt.people)} (${pct(genevaPt.coverage*100)}), including both directions. Bus, foreign and transfer-dependent journeys are often missing.`,
  'Dot counts and “travelling now” comparisons make modes with poor routing coverage look artificially small. Population uses broader totals.',
  'Show covered / total per mode near the counter, add bus and cross-border itinerary coverage, and compare on a common denominator.',
  'coverage.csv; corridors.csv; app/components/commute-dashboard.tsx');
finding('F09','High','Unsupported model allocation','All cities','Long-distance active estimates survive even when their routes are excluded',
  `${n(sum(activeLong,'commuters'))} walk/bike estimates across ${n(activeLong.length)} city-page corridors have endpoints more than 25 km apart. This is a page-row total, not unique national commuters. Examples include Lausanne → Genève and Luzern → Zürich.`,
  'A uniform active share is implausible for many long journeys; hiding their geometry leaves them in the chart.',
  'Use distance- and origin-specific mode evidence. Keep excluded estimates visible as uncertainty; do not reclassify them as cars without evidence.',
  'corridors.csv: mode=soft and directKm>25; app/model.ts');
finding('F10','High','Independent model assumptions','All cities','The population curve is not derived from animated arrivals',
  `On the same routed car cohort, Zürich’s sigmoid population curve differs from departure/travel-time accounting by up to ${n(Math.abs(z.populationCarDisagreement))} people at minute ${z.disagreementMinute}. This compares journey-end presence, not measured city-boundary crossings.`,
  'People can be shown in transit while the independently timed curve already counts them at their destination. The curve and map cannot validate each other.',
  'Use one departure/arrival event model for animation, in-transit totals and population, with a documented city-boundary rule.',
  'timeseries.csv; app/model.ts; app/road-flow.ts');
finding('F11','High','Model scope limitation','All cities','A worker headcount is treated as a daily traffic schedule',
  `The model schedules the full cohort each day. It has no attendance, remote-work, weekend, holiday or shift-work adjustment. Zürich has ${n(z.carNow0745)} car-category people at 07:45 and ${n(z.carNow1200)} at noon in this schedule.`,
  'These are synthetic moments, not traffic observations. Internal trips, deliveries, shopping and through traffic are outside scope.',
  'Call it an illustrative working-day commute model. Calibrate attendance and departure profiles before adding real-time or traffic claims.',
  'app/model.ts; app/road-flow.ts; app/components/commute-dashboard.tsx');
finding('F12','Medium','Documented modelling limitation','All cities','Rail geometry is not evidence of train passengers or a valid itinerary',
  'The importer selects a nearby station within the same commune, then a shortest rail-distance path. No timetable, transfer, service frequency, train capacity or route-specific passenger count validates the inferred PT allocation. Timing uses a coordinate-distance heuristic.',
  'PT commuters may actually use buses or other stations; the map cannot assert that they travel on the displayed train route.',
  'Keep possible routes distinct from observed passenger counts; use timetable itineraries if route validity and travel time are needed.',
  'scripts/generate-rail-routes.mjs; app/components/commute-dashboard.tsx:prepareMapData');
finding('F13','Medium','Documented modelling limitation','11 cities','Foreign origins are allocated from workplace totals',
  'All 11 Q4 2025 workplace totals match the FSO after rounding. Their foreign home communes are nevertheless modelled allocations using selected nearby places and population/distance weights.',
  'A correct workplace total does not establish the places or routes people come from. Cross-border modal shares also inherit the resident mismatch.',
  'Tag these origins as allocated; replace them with observed cross-border OD data where available and retain uncertainty elsewhere.',
  'scripts/generate-top-city-data.mjs:allocateForeign; app/data/*; sources/fso-cross-border-totals.json');
finding('F14','Medium','Coverage and vintage limitation','All cities','Fresh route files do not make old commuter estimates current',
  'Swiss OD data are 2020, resident mode shares 2023, border totals Q4 2025, rail geometry 2023 and station/cache files 2026. Geographic cropping excludes some commuters before the 95% car-route target is applied.',
  'The map, chart and source totals use different denominators and vintages. There is no historical route snapshot to quantify a before/after regression.',
  'Publish separate data and geometry vintages, retain dated input hashes, and show full-source → mapped → routed coverage.',
  'groups.csv; coverage.csv; audit.json:manifest; README.md');
const snap = a.routes.find(r => r.geometryErrors);
if (snap) finding('F15','Medium','Review flag','Zürich','One road endpoint snaps far from its requested location',
  `${snap.originName} → Zürich: ${n(snap.commuters)} estimated people; maximum endpoint displacement ${snap.snapKm.toFixed(2)} km, against this audit’s 1 km car review threshold.`,
  'A commune centroid or settlement match may put the journey on an unsuitable approach; this does not explain the city-wide low count.',
  'Inspect that endpoint and choose a supported inhabited location. Keep the threshold as a review flag, not a claim of wrong traffic counts.',
  snap.key, 'Medium');
finding('F16','Medium','Lineage and precision limitation','All cities','Uncertainty and parts of the original transformations are missing',
  'FSO and OCSTAT publish uncertainty; the display rounds estimates to individual people. The checked-in city-data generator covers seven cities; the original Geneva and four earlier-city ingestion pipelines are absent. Raw source hashes and mode definitions were not carried into route caches.',
  'The existing 26 tests all pass while these definition errors remain. Regeneration and uncertainty propagation cannot be fully audited from the prior repository alone.',
  'Keep the fetched source snapshots, exact filters and cohort definitions; restore missing ingestion scripts and propagate survey uncertainty. Gate future changes with this audit.',
  'scripts/generate-top-city-data.mjs; test/model.test.ts; audit.json:originalSources');

const tables = [], charts = [], blocks = [];
const datasets = { coverage, benchmark: benchmarkRows, cities: a.cityRows.map(c => ({...c, city: c.name})), groups: a.groups.map(g => ({...g, city: names[g.city]})), checks: a.checks, failures, findings,
  reciprocal: a.reciprocal.filter(r => r.mode === 'car').sort((a,b) => Math.abs(b.delta)-Math.abs(a.delta)),
  missing: a.routes.filter(r => r.geometry === 'missing').sort((a,b) => b.commuters-a.commuters).slice(0,60),
  frenchModes: Object.entries(a.french.byOriginalMode).map(([code, people]) => ({code, sourceMode: {'1':'No transport','2':'Walking','3':'Bicycle / e-bike','4':'Motorcycle','5':'Car / van / truck','6':'Public transport'}[code], people, appMode: code==='6'?'Public transport':['4','5'].includes(code)?'Car':'Walk / bike'})),
  temporal: a.hourly.filter(r => r.city === 'zurich' && r.minute % 10 === 0).flatMap(r => [
    {...r, basis: 'Population curve', people: r.curveCarPopulationSameCoverage},
    {...r, basis: 'Journey timing', people: r.routeDerivedCarPopulation},
  ]),
};
function md(id, title, body, sourceId) { blocks.push({id,type:'markdown',body:`${id==='title'?'#':'##'} ${title}${body?'\n\n'+body:''}`, ...(sourceId?{sourceId}:{})}); }
function table(id,title,dataset,columns,sortField,direction='desc',sourceId='audit') {
  tables.push({id,title,dataset,sourceId,defaultSort:{field:sortField,direction},density:'dense',layout:'full',columns:columns.map(([field,label,format])=>({field,label,...(format?{format}:{type:'text'})}))});
  blocks.push({id:`${id}-block`,type:'table',tableId:id,layout:'full'});
}
function chart(id,title,dataset,type,x,y,color,label,format='number',sourceId='audit') {
  charts.push({id,title,dataset,type,sourceId,encodings:{x:{field:x,type:x==='minute'?'quantitative':'nominal',label:x==='minute'?'Minute of model day':'City'},y:{field:y,type:'quantitative',label,format},color:{field:color,type:'nominal',label:'Basis'}},valueFormat:format,...(type==='bar'?{options:{orientation:'vertical',grouping:'grouped'}}:{})});
  blocks.push({id:`${id}-block`,type:'chart',chartId:id});
}
const title = 'Swiss Commutes — data audit';
md('title',title);
md('summary','The source totals mostly reconcile; the mode-specific picture does not',
  `Audited **12 cities and ${n(a.routes.length)} corridor rows**, using the local code and data snapshot dated ${a.generatedAt.slice(0,10)}. The new runner completed **${n(a.checks.length)} checks: ${n(a.checks.length-failures.length)} passed and ${n(failures.length)} failed instances**. Several failures share one cause; they are not ${failures.length} distinct bugs. All 26 existing tests pass.\n\nThe most consequential issues are resident mode shares applied to incoming workers, contradictory counts for the same journey across pages, misleading transport categories, and Geneva’s mixed geographic scope. Use the current site as an illustration of commuting patterns, not as a validated count of cars, train passengers or cyclists.\n\n**Decision:** correct the definitions and shared allocation first. Adding more dots or routes cannot fix a biased denominator. This report diagnoses the current snapshot; it does not change the production model.`, 'audit');
md('scope','What each number actually measures',
  '**Corridor:** one origin, destination, direction and app transport category. Its value is a worker estimate, not a vehicle count. **Mapped:** present in a city data module after geographic selection. **Routed:** has geometry the UI can display. Coverage is routed people ÷ mapped people for that category. It is not accuracy or share of all city traffic.\n\n**Population:** a modelled net change from incoming and outgoing workers; the chart subtracts that model’s daily average. There is no resident-population census baseline in the curve. **Travelling now:** selected routed workers whose simulated journeys overlap the chosen minute. Car uses a continuous departure calculation; PT and active modes sum sampled dot weights.\n\nGeneva’s inputs cover its canton; other pages use city communes. A commuter can appear on two city pages, so totals across this report’s city rows must not be presented as unique Swiss people.');
md('priority','Findings to review first','Severity ranks the impact on interpreting the site. “Confirmed” means reproduced from code or the original source; a limitation or review flag is not an assertion that every affected row is wrong. Each finding below has evidence, impact, a proposed fix and a file reference.');
table('finding-index','Ranked findings','findings',[['id','ID'],['severity','Severity'],['kind','Status'],['scope','Scope'],['title','Finding']], 'id','asc');
for (const f of findings.slice(0,7)) md(f.id,`${f.id} · ${f.title}`,`**${f.severity} · ${f.kind} · confidence: ${f.confidence} · ${f.scope}**\n\n${f.evidence}\n\n${f.impact} **Action:** ${f.action}\n\nEvidence: ${f.location}`, 'audit');
md('benchmarks','The incoming-worker benchmark is much less active than the applied resident mix',
  'The six-city comparison distinguishes incoming, outgoing and internal commuters. Its incoming MIV shares exceed the resident shares applied by this project in all six cities. MIV includes motorcycles. The reference is pooled 2019–2021, whereas the resident table is 2023: this is a diagnostic comparison, not a proposed automatic replacement. The report’s Figure 22 also puts Zürich incoming walking/cycling at 2%, versus the project’s roughly 21.7% residual. [Official six-city comparison, p. 20]('+comparisonUrl+').');
chart('modal-benchmark','Applied resident MIV share and incoming-worker benchmark','benchmark','bar','city','share','basis','Share of workers','percent','benchmark-source');
const zb = benchmarks.find(b => b.slug === 'zurich');
md('sensitivity','Zürich sensitivity: a different share changes the scale substantially',
  `For the same ${n(zb.mappedInbound)} mapped Swiss incoming workers, the current allocated car category is ${n(sum(a.routes.filter(r=>r.city==='zurich'&&r.group==='swissInbound'&&r.mode==='car'),'commuters'))}. Multiplying that cohort by the historical 28% incoming MIV share gives about ${n(zb.mappedInbound*0.28)}. This is a **sensitivity scenario**, not a corrected 2026 count: years, survey uncertainty and route choices still need reconciliation.`, 'audit');
table('shared-pairs','Identical OD pairs, different car allocations','reciprocal',[['origin','From'],['target','To'],['originPage','Origin page','number'],['targetPage','Destination page','number'],['delta','Difference','number']], 'delta');
md('coverage','Routing coverage changes what the user sees',
  'The denominator below is each city’s mapped transport-category estimate, both directions combined. The car target is reached, but PT and active coverage vary widely. The count of visible people therefore cannot be compared across modes without coverage context. Geographic exclusions happen before these percentages.');
chart('route-coverage','Share of mapped commuters with a displayed route','coverage','bar','city','coverage','mode','Routed / mapped people','percent');
table('route-coverage-table','Route coverage and missing estimates','coverage',[['city','City'],['mode','Category'],['people','Mapped people','number'],['covered','Routed people','number'],['coverage','Coverage','percent'],['missing','Missing','number']], 'coverage','asc');
table('largest-missing','Largest 60 missing routes by estimated commuters','missing',[['city','City'],['originName','Origin'],['targetName','Destination'],['mode','Mode'],['commuters','People','number']], 'commuters');
for (const f of findings.slice(7,9)) md(f.id,`${f.id} · ${f.title}`,`**${f.severity} · ${f.kind} · confidence: ${f.confidence}**\n\n${f.evidence}\n\n${f.impact} **Action:** ${f.action}\n\nEvidence: ${f.location}`, 'audit');
md('model','Two independent clocks describe the same commuters',
  'Car and active departures follow triangular waves from 05:00–10:00 and 15:00–20:00. The population curve uses independent sigmoid arrival/departure times. The plot holds the routed car cohort constant and compares those two constructions. It tests consistency; neither line is an observation, and journey-end time is not a measured crossing of the city boundary.');
chart('population-clock','Zürich car-category population change: two model constructions','temporal','line','minute','people','basis','Net people');
for (const f of findings.slice(9)) md(f.id,`${f.id} · ${f.title}`,`**${f.severity} · ${f.kind} · confidence: ${f.confidence} · ${f.scope}**\n\n${f.evidence}\n\n${f.impact} **Action:** ${f.action}\n\nEvidence: ${f.location}`, 'audit');
md('french','The French records can be reproduced, including the wrong category mapping',
  `The audit streamed ${n(a.french.rowsRead)} records from the original INSEE archive. Filtering Ain and Haute-Savoie residences and Geneva-canton workplace codes, then summing survey weight IPONDI, reproduces all ${a.french.comparedRows} published French rows. The unrounded total is ${a.french.rawSum.toFixed(2)}; rounding once per origin and app category yields ${n(a.french.roundedSum)}. Rounding is not the main error.`, 'audit');
table('french-modes','Original INSEE categories and current app grouping','frenchModes',[['code','TRANS'],['sourceMode','Recorded mode'],['people','Weighted people','number'],['appMode','Current app category']], 'code','asc');
md('checks','What passed, what failed, and what remains unverified',
  `**Passed:** every mapped domestic FSO pair and full domestic summary in the 11 standard cities; all 33 copied resident modal shares; all 11 rounded cross-border workplace totals; all 714 French origin-mode rows under the recovered mapping; positive integer corridor values; unique corridor keys; cache references; rail continuity; route timing arrays; both car-direction coverage targets; filter additivity and empty selection.\n\n**Failed instances:** ${failures.length}, listed below. The endpoint threshold is a review heuristic; the Geneva scope failures are related rather than independent errors. Definition and realism findings are recorded separately and are not disguised as passing numeric tests.\n\n**Not established:** actual route usage, daily attendance, train-service validity, car occupancy, bicycle-only totals, exact workplace addresses, live traffic volumes, and historical pre-regression behaviour. Statistical confidence intervals and metadata exist in the source snapshots, but are not propagated by the app.`, 'audit');
table('failed-checks','Failed checks and review flags','failures',[['city','City / pair'],['check','Check'],['actual','Actual','number'],['expected','Expected / comparison','number'],['severity','Severity']], 'city','asc');
table('group-denominators','Published, mapped and modelled populations','groups',[['city','City'],['group','Flow group'],['summaryPeople','Summary people','number'],['mappedPeople','Mapped people','number'],['modelPeople','Model people','number'],['coveragePct','Mapped share (%)','number']], 'coveragePct','asc');
md('method','How to rerun and investigate a particular city',
  'The audit runner imports the same city modules and routing helpers as the site. Independent Python CSV/XML readers reconcile original FSO, OCSTAT and INSEE files. Geometry is decoded and checked without calling a routing service. In-transit and population outputs are sampled every five minutes; comparisons on the report chart use every ten minutes. The UI’s non-car sampling formula is mirrored with guards for its constants.\n\nRun `npm run audit:data`, then `npm run audit:report`. The default audit command writes CSV and JSON even when findings exist; `npm run audit:data -- --strict` exits non-zero on failed checks. Use the companion notebook to filter `corridors.csv`, inspect `coverage.csv`, or compare `reciprocal.csv`. Source files, exact filters, hashes and the complete per-check results accompany the report.\n\nThere is no historical series of model versions in this audit: the time curves are simulations within one day, not observed trends. The reference date is a local source-code/data snapshot; production equality has not been rechecked in this run.');
md('next','Fix definitions before expanding the map',
  '1. Correct the shared mode allocation and enforce the same OD estimate across pages. Retain source cohort and category labels.\n2. Remove no-transport records from travel; distinguish motorcycles, walking, cycling and unknown modes where evidence allows.\n3. Reconcile Geneva’s canton scope and restore its known French workplace communes.\n4. Show coverage per mode, then improve the largest missing PT routes.\n5. Derive map, counter and population from one documented event model; add attendance and timing calibration only with suitable evidence.\n6. Run the audit as a release gate and retain versioned source snapshots.\n\n**Questions for the next analysis:** should Geneva remain a canton view or become a municipal view? Which directions have usable mode-specific survey estimates for every city? Should the site represent a typical working day or observed traffic? These choices affect the model and should be settled before replacing counts.');

const sources = [
  {id:'audit',label:'Reproducible audit of local application and original statistical inputs',path:'audits/2026-09-06/audit.json',query:{description:'scripts/audit-data.mjs imports app/cities.ts and all city caches; audit-sources.py independently parses original FSO and OCSTAT; audit-insee.py streams the original INSEE archive. CSV exports preserve all corridor rows and 5-minute samples.',tables_used:['app/data/*.ts','app/data/*-routes.json','app/model.ts','app/road-flow.ts','app/components/commute-dashboard.tsx','sources/fso-commune-matrix-original','sources/fso-modes.xml','sources/fso-mode-definitions.xml','sources/fso-cross-border-totals.json','sources/ocstat-commuters.xlsx','sources/insee-swiss-aggregates.json'],executed_at:a.generatedAt}},
  {id:'benchmark-source',label:'Six-city mobility comparison, Figure 22, page 20, joined to current app shares',href:comparisonUrl,path:'audits/2026-09-06/benchmarks.json',query:{description:'Published domestic incoming-worker main-mode shares for pooled 2019–2021; compare with FSO 2023 resident shares applied by the app. MIV includes motorcycles. Different cohorts and years; diagnostic only.'}},
  {id:'fso-modes',label:'FSO resident commuter mode table and definitions, 2023',href:'https://www.bfs.admin.ch/asset/de/DF_SSV_MOB_COM',path:'audits/2026-09-06/sources/fso-mode-definitions.xml'},
  {id:'ocstat',label:'OCSTAT T 11.06.2.04, 2024 sheet, canton of Geneva',href:'https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx'},
  {id:'insee',label:'INSEE RP2023 MOBPRO and TRANS dictionary',href:'https://www.insee.fr/fr/statistiques/9004795'},
  {id:'fso-od',label:'FSO home/work commune matrix, 2020',href:'https://dam-api.bfs.admin.ch/hub/api/dam/assets/27885394/master'},
  {id:'fso-border',label:'FSO cross-border workers, Q4 2025, sex total',href:'https://www.pxweb-admin-a.bfs.admin.ch/pxweb/en/px-x-0302010000_101/-/px-x-0302010000_101.px/'},
];
// The portable reader requires SQL provenance, including for file-based reports.
// Keep the original analytical code above as provenance; this real SQLite step is
// explicitly only a delivery projection over already-reviewed rows, not the model.
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE report_rows (dataset TEXT, payload TEXT)');
const insert = db.prepare('INSERT INTO report_rows VALUES (?, ?)');
for (const [dataset, rows] of Object.entries(datasets)) for (const row of rows) insert.run(dataset, JSON.stringify(row));
const projectionSql = 'SELECT payload FROM report_rows WHERE dataset = :dataset ORDER BY rowid';
const select = db.prepare(projectionSql);
for (const dataset of Object.keys(datasets)) datasets[dataset] = select.all({dataset}).map(r => JSON.parse(r.payload));
for (const source of sources.slice(0,2)) source.query = {...source.query, engine:'SQLite (Node.js built-in)', language:'sql', sql:projectionSql, tables_used:['report_rows'], description:source.query.description+' Delivery SQL is only a row projection over the reviewed datasets. It does not calculate or validate commuter counts. Upstream calculations are preserved in scripts/audit-data.mjs, audit-sources.py, audit-insee.py and build-audit-report.mjs; all are part of the audit bundle.'};
db.close();
const artifact = {surface:'report',manifest:{version:1,surface:'report',title,generatedAt:a.generatedAt,description:'Source reconciliation, model assumptions and route coverage for all 12 Swiss Commutes city pages.',blocks,charts,tables,sources},snapshot:{version:1,status:'ready',generatedAt:a.generatedAt,datasets},sources};
for (const [file, content] of Object.entries({'artifact.json':artifact,'findings.json':findings,'benchmarks.json':benchmarks})) fs.writeFileSync(path.join(dir,file),JSON.stringify(content,null,2)+'\n');
const cols=Object.keys(findings[0]); const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
fs.writeFileSync(path.join(dir,'findings.csv'),[cols.map(cell).join(','),...findings.map(r=>cols.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
console.log(JSON.stringify({findings:findings.length,blocks:blocks.length,charts:charts.length,tables:tables.length,artifact:path.join(dir,'artifact.json')}));
