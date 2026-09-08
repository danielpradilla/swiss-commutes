# Swiss Commutes audit and fixes

This follow-up audits all 16 locations after the model corrections and the addition of Chiasso, Mendrisio, Zug and Neuchâtel. The [original twelve-city audit](../2026-09-06/README.md) remains unchanged as the baseline.

Open [report.html](report.html) for findings and before/after comparisons. [analysis.ipynb](analysis.ipynb) is the companion notebook. `audit.json` and the CSVs contain the complete evidence; `findings.json` records the disposition of the original sixteen findings. `report-verification.json` records the portable report checks.

Passing numeric checks does not establish actual traffic or validate the remaining modal proxies, foreign-origin allocations, rail itineraries or attendance assumptions. The report distinguishes corrected errors from those limits. Counts are people, not vehicles. City rows overlap and must not be summed as unique national commuters. Geneva represents its canton, the other pages municipalities.

The [comparison with Habibi Code’s original Geneva project](original-project/README.md) separates geography and source-vintage differences from route omissions. It includes the retrieved source page, numerical results and an executed notebook. On the original French origins, our incoming car-category count is 1.3% higher; the larger issues are missing public-transport routes and the incoming Vaud mode assumptions.

## Reproduce

From the repository root, with Node 22.13+ and Python 3:

```sh
python3 scripts/generate-resident-modes.py
python3 scripts/generate-geneva-data.py
node scripts/generate-top-city-data.mjs --cities=chiasso,mendrisio,zug,neuchatel --commutes=audits/2026-09-06-fixed/sources/fso-commune-matrix-original --centres=app/data/commune-centres.json --out=app/data
npm run routes:cars
npm run routes:active
npm run routes:rail -- /path/to/rail.gpkg /path/to/stations.json
npm test
npm run lint
npm run build
npm run audit:data -- --strict
npm run audit:report
```

The route imports need the public routing service or national geometry files; the audit itself is offline and read-only against the app. It writes the evidence even when checks fail, then `--strict` returns a nonzero exit code. Missing required original statistical inputs stop the audit. Rebuilding the HTML uses the existing canonical report packager:

```sh
node scripts/package-audit-report.mjs /path/to/data-analytics-plugin audits/2026-09-06-fixed
```

The HTML contains all report tables and works without a server. The notebook uses only Python's standard library and reads the adjacent evidence files; run it from this directory or the repository root. Its saved outputs show the delivered audit snapshot, not fresh live data.

## Sources and limits

The source folder preserves the original FSO 2020 commune matrix, FSO 2023 resident mode counts and definitions, FSO Q4 2025 border totals and exact national query, OCSTAT 2024 workbook, six-city mobility comparison and INSEE aggregates streamed from the original RP2023 archive. Input hashes are in `audit.json`; the original audit README documents source retrieval and the INSEE filters.

Domestic mode priority is destination inbound share, origin outbound share, origin resident share, then the FSO small-city resident average. The first two come from Figures 22–23, pages 20–21 of the six-city study (2019–2021). Rounded percentages are normalised. This is a shared allocation rule, not observed mode data for each pair. Foreign flows outside Geneva still use resident modal proxies; Chiasso and Mendrisio reuse Lugano's allocated origin pattern. The residual active category may contain other modes.

Neuchâtel's FSO 2020 rows are combined across codes 6458, 6407, 6412 and 6485 to reflect the 2021 merger; internal journeys within the merged commune are excluded. Geneva retains all 45 French workplace communes, excludes TRANS=1, and rounds once per origin, workplace and grouped mode. Swiss Geneva flows use Vaud in both directions (23,398 inbound, 6,881 outbound). Unlocated source code 7777 and the other-canton/unknown remainders are not assigned to invented routes.

`app/data/commune-centres.json` preserves coordinates from the existing city modules. Gy was added from the official swisstopo settlement search; Glarus Süd's road anchor is the official Linthal station. Older point transforms and the original raw importers for Basel, Lugano, Schaffhausen and La Chaux-de-Fonds remain incomplete. Their domestic counts are nevertheless reconciled against the original matrix. Published uncertainty remains in the source files and is not yet propagated into model intervals.
