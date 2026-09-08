// Use the plugin's canonical reader, chart extraction and verifier. No custom report renderer.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [plugin, folder = 'audits/2026-09-06'] = process.argv.slice(2);
if (!plugin) throw new Error('Usage: node scripts/package-audit-report.mjs /path/to/data-analytics-plugin [audit-folder]');
const scripts = path.resolve(plugin, 'skills/build-report/scripts');
const { buildPortableArtifact } = await import(pathToFileURL(path.join(scripts, 'build_portable_artifact.mjs')));
const { extractPortableChartSvgs } = await import(pathToFileURL(path.join(scripts, 'extract_portable_chart_svgs.mjs')));
const { verifyPortableArtifact } = await import(pathToFileURL(path.join(scripts, 'verify_portable_artifact.mjs')));
const dir = path.resolve(folder), input = path.join(dir,'artifact.json'), output = path.join(dir,'report.html'), tmp = path.join(dir,'report.pending.html');
const artifact = JSON.parse(fs.readFileSync(input));
// ponytail: shared reader 0.2.10 sizes its top bar to 100vw, overflowing when scrollbars occupy space.
// Remove this one CSS correction once the shared reader uses its containing width.
const containHeader = html => html.replace('</head>', '<style>#data-analytics-portable-reader .analytics-top-bar{width:100%;margin-inline:0}</style></head>');
fs.writeFileSync(tmp, containHeader(buildPortableArtifact(artifact)));
const staticCharts = await extractPortableChartSvgs({htmlPath:tmp});
fs.writeFileSync(tmp, containHeader(buildPortableArtifact(artifact,{staticCharts})));
const receipt = await verifyPortableArtifact({artifactPath:input,htmlPath:tmp});
fs.writeFileSync(path.join(dir,'report-verification.json'),JSON.stringify(receipt,null,2)+'\n');
if (!receipt.ok) throw new Error(JSON.stringify(receipt));
fs.renameSync(tmp,output);
console.log(JSON.stringify({output,...receipt}));
