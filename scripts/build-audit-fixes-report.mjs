import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dir = path.resolve(process.argv[2] ?? 'audits/2026-09-06-priorities');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const a = read(path.join(dir, 'audit.json'));
const baseline = read('audits/2026-09-06/audit.json');
const original = read('audits/2026-09-06/artifact.json');
const previous = read('audits/2026-09-06-fixed/audit.json');
const deployed = fs.existsSync(path.join(dir, 'deployment-verification.json')) ? read(path.join(dir, 'deployment-verification.json')) : null;
const sum = (rows, field) => rows.reduce((n, r) => n + r[field], 0);
const n = value => Math.round(value).toLocaleString('en-CH');
const failures = a.checks.filter(c => c.status === 'fail');
const cantonTitle = a.checks.find(c => c.check === 'Canton scope is visible in the city title');
const cantonWorkplaces = a.checks.find(c => c.check === 'French workplace communes are retained');
const findingChecks = {
  F02: /^Same OD /,
  F03: /^Motorcycle category/,
  F04: /^INSEE /,
  F06: /^OCSTAT Vaud|^Consistent Vaud/,
  F07: /^Canton scope|^French workplace communes/,
  F10: /^Population follows|^Mode filters add|^UI journeys match|^Commune markers/,
  F15: /^Route geometry|^Route endpoint/,
};
const statuses = [
  ['F01','Partly corrected','Direction-specific mode shares','Six cities now use domestic incoming-worker shares. Other pairs use home-city outgoing shares where available, otherwise resident shares as an explicit proxy. Aggregate and historical shares do not establish actual OD modes.'],
  ['F02','Corrected','Shared journeys agree across pages','One destination-first rule allocates each Swiss OD pair. Known and unspecified mode counts are reconciled across city pages.'],
  ['F03','Corrected','Motorcycles are disclosed','The button is labelled Car / motorcycle. All counts are people, not vehicles.'],
  ['F04','Corrected','No-journey records excluded',`${a.french.byOriginalMode['1'].toFixed(2)} weighted INSEE no-transport people are excluded from travel. Rounding once per origin, workplace and category also changes the rounded total.`],
  ['F05','Partly corrected','Active-mode residual','Vaud–Geneva now uses the 2020 commuting survey and keeps its other category unclassified. French records and the six-city study identify active travel. Elsewhere, the resident-table fallback still treats the residual as a walking/cycling estimate; it may contain other modes.'],
  ['F06','Corrected','Geneva uses a consistent Swiss scope','Vaud-only totals in both directions: 23,398 inbound and 6,881 outbound. Other cantons and foreign/unknown outbound groups are disclosed as outside the model.'],
  ['F07',cantonTitle?.status === 'pass' && cantonWorkplaces?.status === 'pass' ? 'Corrected' : 'Needs review','Geneva workplaces retained',`Page label: ${cantonTitle?.actual ?? 'not checked'}. French workplace communes: ${cantonWorkplaces?.actual ?? 'not checked'} (expected 45). Swiss routes use known commune pairs; other pages represent municipalities.`],
  ['F08','Partly corrected','Coverage disclosed','Map, counter and chart now use the same routed cohort. The page shows source-to-mapped totals and mapped-to-routed coverage by mode. Missing rail, bus and foreign itineraries remain a substantial limitation.'],
  ['F09','Partly corrected','Unrouted active estimates removed from chart','Only local, accepted active routes contribute to the chart. Implausible long-distance residual allocations are retained in the audit as uncertainty, not silently reassigned to cars.'],
  ['F10','Corrected','One journey clock','All modes share departure waves, arrival accounting and continuous counters. Population reflects arrival at a workplace endpoint and departure for home, not measured municipal-boundary crossings.'],
  ['F11','Open limitation','Illustrative working day','The full cohort travels daily in the model. Attendance, remote work, holidays, shift work and observed departure distributions are not calibrated.'],
  ['F12','Partly corrected','Timetable journeys and rail fallback','Geneva now prioritises dated bus/rail itineraries with transfer waiting and separate outward/return times. Remaining rail-only paths use heuristic durations. A sample itinerary does not prove each commuter’s service or passenger load.'],
  ['F13','Open limitation','Foreign origins outside Geneva','Workplace totals match FSO, but foreign homes and modes are allocated. Chiasso and Mendrisio reuse Lugano’s foreign-origin proportions; that is a regional proxy.'],
  ['F14','Partly corrected','Vintages and exclusions exposed','Source files and hashes are preserved; coverage denominators are explicit. Counts still combine 2020 OD, 2019–2021 or 2023 modes, 2023 French records, 2024 Geneva totals and Q4 2025 border totals.'],
  ['F15',a.routes.some(r => r.geometryErrors) ? 'Review remaining flags' : 'Corrected','Road endpoint review','Glarus Süd now uses the official Linthal station settlement point instead of a remote centroid. Every cache is checked for endpoint displacement; any remaining flags appear below.'],
  ['F16','Partly corrected','Reproducible inputs and checks','Added Geneva and resident-mode imports, four city modules, merger handling and source reconciliations. Earlier raw transforms for four cities and older point lookups remain incomplete. Survey uncertainty is preserved in source files but is not propagated into chart intervals.'],
].map(([id,status,title,evidence]) => {
  const checks = a.checks.filter(c => findingChecks[id]?.test(c.check));
  const failed = checks.filter(c => c.status !== 'pass');
  if (failed.length) {
    status = 'Needs review';
    evidence = failed.map(c => `${c.city}: ${c.check}; actual ${c.actual}, expected ${c.expected}.`).join(' ');
  } else if (status === 'Corrected' && !checks.length) {
    status = 'Not verified';
    evidence = 'The current audit does not contain the required checks.';
  }
  return {id,status,title,evidence};
});
const names = Object.fromEntries(a.cityRows.map(c => [c.city,c.name]));
const coverage = a.cityRows.flatMap(c => ['car','transit','soft','unknown'].map(mode => {
  const rows = a.modes.filter(r => r.city === c.city && r.mode === mode);
  const mapped = sum(rows,'people'), routed = sum(rows,'covered');
  return {city:c.name,mode,mapped,routed,missing:mapped-routed,coverage:mapped?routed/mapped:0};
}));
const comparison = a.cityRows.map(c => {
  const old = baseline.cityRows.find(r => r.city === c.city);
  return {city:c.name,status:old?'Existing':'Added',mapped:c.mappedPeople,carBefore:old?.carPeople??null,carAfter:c.carPeople,car0745Before:old?.carNow0745??null,car0745After:c.carNow0745,populationTimingDifference:c.populationCarDisagreement};
});
const datasets = {findings:statuses,comparison,coverage,groups:a.groups.map(g=>({...g,city:names[g.city]})),checks:a.checks,failures,geometryFlags:a.routes.filter(r=>r.geometryErrors),missing:a.routes.filter(r=>r.geometry==='missing').sort((x,y)=>y.commuters-x.commuters).slice(0,60)};
const measure = (audit, group, mode, routed = false) => sum(audit.routes.filter(r => r.city === 'geneva' && r.group === group && r.mode === mode && (!routed || r.geometry !== 'missing')), 'commuters');
datasets.priorities = [
  ['French public transport, mapped','foreignInbound','transit',false],
  ['French public transport, routed','foreignInbound','transit',true],
  ['Vaud incoming car allocation','swissInbound','car',false],
  ['Vaud incoming public-transport allocation','swissInbound','transit',false],
  ['Vaud incoming active allocation','swissInbound','soft',false],
  ['Vaud incoming other / unspecified allocation','swissInbound','unknown',false],
  ['Vaud incoming public transport, routed','swissInbound','transit',true],
].map(([measureName,group,mode,routed]) => ({measure:measureName,before:measure(previous,group,mode,routed),after:measure(a,group,mode,routed)}));
// Chart contract: compare two Zurich model snapshots, not a time trend; two worker-headcount rows.
// Native horizontal bar, zero baseline, direct category/value labels, neutral bars distinguished by direct category/value labels, no redundant legend.
// QA: canonical portable HTML at desktop/mobile widths, with the same exact figures in the companion table.
const z = comparison.find(c => c.city === names.zurich);
datasets.zurichComparison = [{basis:'Previous model',people:z.carBefore},{basis:'Corrected model',people:z.carAfter}];
const charts=[{id:'zurich-comparison',title:'Zürich: mapped car / motorcycle commuters',subtitle:'Estimated workers in two model versions; this is not a traffic trend.',type:'bar',dataset:'zurichComparison',sourceId:'audit',
  encodings:{x:{field:'basis',type:'nominal',label:'Model version'},y:{field:'people',type:'quantitative',label:'Estimated workers',format:'number'}},
  showDescription:true,valueFormat:'number',palette:{kind:'sequential',name:'neutral'},labels:{values:'all'},settings:{orientation:'horizontal',groupMode:'single',sort:'none'},layout:'full'}];
const blocks=[],tables=[];
const md=(id,title,body)=>blocks.push({id,type:'markdown',sourceId:'audit',body:`${id==='title'?'#':'##'} ${title}\n\n${body}`});
function table(id,title,dataset,columns,sort='city') {
  tables.push({id,title,dataset,sourceId:'audit',defaultSort:{field:sort,direction:'asc'},density:'dense',layout:'full',columns:columns.map(([field,label,format])=>({field,label,...(format?{format}:{type:'text'})}))});
  blocks.push({id:`${id}-block`,type:'table',tableId:id,layout:'full'});
}
md('title','Swiss Commutes: audit and fixes',`**16 locations · ${n(a.routes.length)} corridor rows · ${n(a.checks.length)} checks · ${failures.length} failed checks**\n\nSnapshot: ${a.generatedAt}. This follow-up preserves the original twelve-city audit and records the corrections, four additions and remaining limitations. ${deployed?.status === 'verified' ? 'The deployment checks below tie this audit to the live build.' : 'It checks the local build; it does not establish that production has been deployed.'}`);
if (deployed) md('deployment','Deployment verification',`Status: ${deployed.status}. Checked ${deployed.verifiedAt}.\n\n${deployed.files.checked} deployed files checked against the local SHA-256 manifest; ${deployed.files.mismatches} mismatches. ${deployed.http.passed} of ${deployed.http.checked} public pages matched after excluding Cloudflare’s injected analytics beacon. Browser checks covered ${deployed.browser.cities.join(', ')}. Details and reproducible file hashes are in deployment-verification.json and deployment-files.json.\n\nThe live check found Cloudflare Rocket Loader rewriting application scripts. The build now adds Cloudflare’s documented opt-out attribute to every exported script. Follow-up checks verify the script order and mode controls. This change affects the export, not the commuter estimates.\n\nThese checks establish which build is live. They do not validate the remaining statistical assumptions.`);
md('result','Corrections and limits','Shared Swiss journeys now agree across pages; Geneva retains its known workplaces and excludes no-journey records; the map, counter and population use one routed cohort and departure model. Historical domestic mode evidence replaces the misapplied resident mix for six destinations.\n\n**Use the result as an illustrative working-day model.** Passing reconciliation checks does not validate actual cars, passengers, cyclists or traffic at a given minute. The unresolved mode proxies, missing public-transport itineraries and attendance assumptions remain material.');
md('priority-fixes','Geneva public transport and Vaud modes','Compared with the preceding corrected build, Geneva now includes morning and return journeys from the Swiss 2026 timetable, with cross-border buses, trains, walking connections and transfers. MOTIS runs locally against a regional OpenStreetMap extract. Accepted sample journeys provide geometry and separate outward/return durations; they do not establish the service each person uses throughout the day.\n\nVaud–Geneva shares now come from the 2020 inter-cantonal commuting survey, published in OCT’s 2022 transport report, page 40. Nyon and the other Vaud districts are combined in each direction. The other category remains unclassified. The 2020 survey year coincides with the pandemic; these historical shares are an estimate for later cohorts. Its people remain in source and mapped totals but are excluded from the three transport filters. Zero allocated active travel does not establish zero cyclists.');
table('priority-comparison','Before and after these two priorities','priorities',[['measure','Measure'],['before','Previous corrected build','number'],['after','Current build','number']],'measure');
table('status','Disposition of the original findings','findings',[['id','ID'],['status','Status'],['title','Finding'],['evidence','Correction or remaining limit']],'id');
md('scope','Cohorts, geography and counting','A corridor is an origin, workplace, direction and app category. Counts are estimated workers. A person can occur on two city pages; summing city rows does not yield unique Swiss commuters. Geneva covers its canton; the other 15 locations are municipalities. Neuchâtel includes the 2021 merger of Neuchâtel, Corcelles-Cormondrèche, Peseux and Valangin; journeys inside the merged municipality are excluded.\n\nThe source cohort precedes geographic cropping. Mapped people have known selected commune pairs. Routed people have accepted geometry. Only routed people contribute to the chart and counter. The chart subtracts its modelled daily average; it does not include a census resident-population baseline.');
blocks.push({id:'zurich-chart',type:'chart',chartId:'zurich-comparison',layout:'full'});
table('city-comparison','Before and after: mapped estimates and simulated 07:45','comparison',[['city','City'],['status','Status'],['mapped','All mapped','number'],['carBefore','Motorised before','number'],['carAfter','Motorised after','number'],['car0745Before','At 07:45 before','number'],['car0745After','At 07:45 after','number']]);
md('comparison-notes','Interpretation of the comparison','“Motorised” includes motorcycles and counts people, not vehicles. Before/after values are two model versions, not a real traffic trend. Mode allocation, route coverage and Geneva workplace detail changed together. The table cannot attribute the difference to one change. Blank before-values identify the four additions.');
table('source-coverage','Source cohort to mapped pairs','groups',[['city','City'],['group','Group'],['summaryPeople','Source people','number'],['mappedPeople','Mapped people','number'],['omittedFromMap','Unmapped','number']]);
table('route-coverage','Mapped to routed, both directions','coverage',[['city','City'],['mode','Category'],['mapped','Mapped','number'],['routed','Routed','number'],['coverage','Coverage','percent'],['missing','Unrouted','number']]);
md('geneva','Geneva source reconciliation',`INSEE filtering: residences in Ain/Haute-Savoie, Geneva-canton SUC workplace codes, TRANS 2/3 active, 4/5 motorised, 6 public transport; TRANS 1 excluded. Sum survey weight IPONDI and round once per origin, workplace and grouped mode. All ${n(a.french.comparedRows)} retained French rows are independently checked; ${a.french.mismatches} mismatches and ${a.french.omitted.length} omitted positive rows.\n\nSwiss 2020 home/work pairs are scaled separately to OCSTAT’s Vaud-only 2024 totals using largest remainders. Source code 7777 has no known commune; its share remains unmapped. Other-canton inbound workers and foreign/unknown outbound workers are outside the selected cohort. French and Swiss series use different definitions and years; they are not an independently validated municipal census.`);
md('methods','Allocation and timing rules','Vaud–Geneva pairs use the directional 2020 inter-cantonal survey. Other Swiss pairs use destination inbound share, then origin outbound share, then origin resident profile. Missing resident profiles use the FSO small-city aggregate. The six-city benchmark uses Figures 22–23 of Städtevergleich Mobilität 2021 (pooled 2019–2021); rounded whole percentages are normalised. Each OD allocation conserves its original count using largest remainders, including unspecified modes. These aggregate rules do not establish individual OD modes.\n\nAll modes use triangular departures at 05:00–10:00 and 15:00–20:00. Routed travel time determines arrival. Accepted timetable itineraries take precedence over rail geometry and include transfer waiting. Rail-only fallback durations remain heuristic. Continuous departure differences produce travelling counts; net endpoint presence produces population change. Active routes require local endpoints and accepted distance, duration and snapping.');
table('missing-routes','Largest 60 missing mapped routes','missing',[['city','City'],['originName','Home'],['targetName','Workplace'],['mode','Category'],['commuters','People','number']]);
md('checks','Verification boundaries',`${n(a.checks.length-failures.length)} checks passed; ${failures.length} failed. Checks cover original FSO pairs and totals, modal source-copy accuracy, INSEE aggregation, OCSTAT scope, per-mode reciprocal OD consistency, geometry integrity, route coverage, cache references, empty filters and journey-time accounting. Geometry displacement thresholds are review flags, not proof of a bad route. Findings marked open or partly corrected are not converted into passing claims of real-world accuracy.`);
if(failures.length) table('failed-checks','Failed checks requiring review','failures',[['city','Scope'],['check','Check'],['actual','Actual','number'],['expected','Expected','number']]);
if(datasets.geometryFlags.length) table('geometry-flags','Endpoint and geometry flags','geometryFlags',[['city','City'],['originName','Home'],['targetName','Workplace'],['snapKm','Snap km','number'],['geometryErrors','Flag']]);
md('next','Evidence still needed','Priorities: acquire comparable domestic OD-by-mode evidence beyond six cities; replace allocated foreign origins; extend timetable-valid bus and cross-border itineraries beyond Geneva; separate explicit active and unknown categories outside Vaud–Geneva; calibrate attendance and timing against observations. Survey confidence intervals should be propagated before presenting uncertainty bands. Adding extra dots cannot establish any of these facts.');
md('reproduce','Reproduce and inspect','Run `npm run audit:data -- --strict`, then `npm run audit:report`. The evidence directory contains complete corridor, coverage, pair reconciliation, check and time-series CSVs, original inputs and SHA-256 hashes. The companion notebook reads those files without network access. The Zürich chart compares model snapshots. Tables provide the exact reconciliation values and exceptions.\n\nRegeneration: `scripts/generate-resident-modes.py`, `scripts/generate-geneva-data.py` and `scripts/generate-top-city-data.mjs`; routed caches use the `routes:*` commands. The saved point catalogue reuses earlier project coordinates, with Gy from swisstopo and the Glarus Süd routing anchor from the official Linthal station. Older point transforms and four earlier raw city importers remain incomplete.');
const sources=original.sources.filter(s=>s.id!=='benchmark-source').map(s=>({...s}));
sources[0]={id:'audit',label:'16-location audit, original inputs and baseline comparison',path:`${path.relative(process.cwd(),dir)}/audit.json`,query:{description:'audit-data.mjs imports current city modules and caches; audit-sources.py independently reads original FSO and OCSTAT inputs. build-audit-fixes-report.mjs compares the preserved original snapshot. SQLite below only projects the reviewed report rows; it does not calculate or validate commuter counts.'}};
sources.push({id:'directional-modes',label:'Städtevergleich Mobilität 2021, Figures 22–23, pages 20–21',href:'https://www.stadt-zuerich.ch/content/dam/web/de/aktuell/publikationen/2023/staedtevergleich-mobilitaet-2021/staedtevergleich-mobilitaet-2021.pdf'});
sources.push({id:'vaud-modes',label:'OCT 2022, page 40: Vaud–Geneva commuting modes, RS 2020',href:'https://www.ge.ch/document/22897/telecharger'});
sources.push({id:'timetable',label:'SKI Swiss timetable 2026, snapshot 2 September',href:'https://data.opentransportdata.swiss/en/dataset/timetable-2026-gtfs2020'});
const db=new DatabaseSync(':memory:'); db.exec('CREATE TABLE report_rows(dataset TEXT,payload TEXT)');
const insert=db.prepare('INSERT INTO report_rows VALUES(?,?)');
for(const [dataset,rows] of Object.entries(datasets)) for(const row of rows) insert.run(dataset,JSON.stringify(row));
const sql='SELECT payload FROM report_rows WHERE dataset=:dataset ORDER BY rowid';
for(const dataset of Object.keys(datasets)) datasets[dataset]=db.prepare(sql).all({dataset}).map(r=>JSON.parse(r.payload));
sources[0].query={...sources[0].query,engine:'SQLite (Node.js built-in)',language:'sql',sql,tables_used:['report_rows'],executed_at:a.generatedAt}; db.close();
const title='Swiss Commutes: audit and fixes';
const artifact={surface:'report',manifest:{version:1,surface:'report',title,generatedAt:a.generatedAt,description:'Corrections, source reconciliation and remaining modelling limits across 16 locations.',blocks,charts,tables,sources},snapshot:{version:1,status:'ready',generatedAt:a.generatedAt,datasets},sources};
fs.writeFileSync(path.join(dir,'artifact.json'),JSON.stringify(artifact,null,2)+'\n');
fs.writeFileSync(path.join(dir,'findings.json'),JSON.stringify(statuses,null,2)+'\n');
console.log(JSON.stringify({locations:a.cityRows.length,checks:a.checks.length,failures:failures.length,artifact:path.join(dir,'artifact.json')}));

const cols=Object.keys(statuses[0]), cell=v=>'\"'+String(v??'').replaceAll('\"','\"\"')+'\"';
fs.writeFileSync(path.join(dir,'findings.csv'),[cols.map(cell).join(','),...statuses.map(r=>cols.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
