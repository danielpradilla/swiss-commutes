# Swiss Commutes: deployment audit

The current 16-city build is live at [Swiss Commutes](https://www.danielpradilla.info/swiss-commutes/geneva/). This snapshot reruns the model audit after deployment and checks that the public website contains the audited build. It preserves the [priority-fixes audit](../2026-09-06-priorities/README.md) and earlier snapshots.

[Open the report](report.html). [The notebook](analysis.ipynb) contains seven executed cells; `audit.json` and the CSVs hold the full model results. `deployment-verification.json`, `deployment-files.json` and `http-verification.json` record the live checks.

## Results

- 716 model checks pass, with no numerical changes from the priority-fixes snapshot.
- 36 tests, lint and the production build pass.
- All 164 files on DreamHost match the local SHA-256 manifest.
- All 17 public pages (16 cities and the landing page) match the application HTML after excluding only Cloudflare’s injected analytics beacon.
- Geneva, Lausanne and Zürich start with all three modes enabled. At 07:45, their travelling counters and population charts match the audit. Public-transport-only counts agree; disabling all modes returns zero. No application exceptions were observed. The test browser refused Cloudflare’s optional analytics beacon.
- The sampled DreamHost access log contains 48 Swiss Commutes responses (45 successful, two redirects and one cache revalidation), with no server or missing-file errors.
- Desktop checks at 1,200 pixels and the Zürich mobile check at 390 pixels found no horizontal overflow. Screenshots are included.

The export was uploaded with compressed rsync, assets first and delayed file replacement, to `/home/depr001/danielpradilla.info/swiss-commutes`. Old assets and unrelated files were retained. The pre-deployment backup is `/tmp/swiss-commutes-before-20260906-2051.tar.gz` (226 archive entries).

## Issue found and fixed

Cloudflare Rocket Loader rewrote the application scripts, including Next’s inline data scripts. A live control check initially ran before the app became interactive. The origin files matched, but public HTML had been transformed; the first failed HTTP comparison is preserved in `http-before-script-fix.json`.

The build now adds `data-cfasync="false"` to every exported script, including dependencies, before any `src` attribute. This follows [Cloudflare’s documented opt-out](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/ignore-javascripts/). The fix is confined to this application’s HTML and is reapplied by `npm run build`; it does not change domain-wide settings or commuter estimates. All 20 exported HTML files are protected. The final public-page comparisons and browser checks show no rewritten application scripts. No before/after loading-speed claim is made.

## Remaining data limits

The fresh checks reconcile source copies, allocations, route geometry and calculations. They do not turn the model into observed traffic. Geneva’s French public-transport coverage remains 16,081 of 18,812 mapped commuters (85.5%); overall public-transport coverage is 31,201 of 34,167 (91.3%). The remaining gaps, historical mode assumptions, allocated foreign origins, attendance assumptions and timetable coverage outside Geneva are unchanged. Lausanne uses the corrected Vaud–Geneva mode shares, but still uses rail geometry and estimated times rather than the new Geneva timetable cache.

## Reproduce

From the repository root:

```sh
npm test
npm run lint
npm run build
npm run audit:data -- --strict --output=audits/2026-09-06-deployed
npm run audit:report -- audits/2026-09-06-deployed
node scripts/package-audit-report.mjs /path/to/data-analytics-plugin audits/2026-09-06-deployed
python3 audits/2026-09-06-deployed/verify-http.py
```

The HTTP check reads the saved deployment manifest. A later build needs a fresh deployment manifest before its hashes can be compared. Rerunning the model audit does not redeploy the site. Remote verification used `sha256sum --check --quiet` in the deployment directory with `deployment-sha256.txt` on standard input and returned exit code zero. The notebook checks the saved receipts and live counter observations against the model; it does not make new browser requests.

Original statistical inputs and transit provenance are in `sources/`. Large routing downloads remain outside the repository, with their URLs and hashes preserved. Source definitions and import instructions are in the preceding audit.
