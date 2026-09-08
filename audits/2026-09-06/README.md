# Swiss Commutes data audit — 6 September 2026

Open **[report.html](report.html)** for the full report. Start with findings F01–F07, then compare the city coverage table. This audit diagnoses the current local snapshot; it does not change or deploy commuter counts.

## Contents

| File | Purpose and grain |
| --- | --- |
| `report.html` | Self-contained report, sortable tables, three interactive charts, source details and print fallback. No server or network required. |
| `audit.ipynb` | Executed companion notebook; change `CITY` to inspect another city. |
| `findings.csv` / `findings.json` | 16 findings with severity, confidence, evidence, impact, proposed action and source location. |
| `cities.csv` | One row per city; daily model and car-counter diagnostics. |
| `groups.csv` | One row per city and population group; published, mapped and modelled denominators. |
| `coverage.csv` | One row per city, mode and direction; routed / mapped people. Local active coverage uses a different, explicit eligible denominator. |
| `corridors.csv` | All 18,834 app corridors, with routing status, estimated people, distances, travel times, skipped-route reasons and geometry flags. |
| `timeseries.csv` | Every city at five-minute intervals; simulated values, not observations. |
| `reciprocal.csv` | Same directed city-to-city OD pairs compared across pages, by mode and all modes. |
| `checks.csv` | All 335 checks, including 17 failed instances. Repeated failures can share one cause. |
| `sourceComparisons.csv` | Original modal shares and rounded cross-border workplace totals versus the application. |
| `reconciliation.csv` | Individual FSO OD discrepancies. Empty in this snapshot: all checked pairs match. |
| `benchmarks.json` | Six-city incoming-worker comparison transcribed from Figure 22, page 20. |
| `audit.json` | Full machine-readable audit, input file hashes, raw-source profiles and all detail datasets. |
| `artifact.json` | Canonical report definition and bounded report datasets. |
| `report-verification.json` | Browser verification receipt for the finished report. |
| `sources/` | Original public FSO / OCSTAT inputs and aggregated INSEE evidence. |

Do **not** add city-row totals together and call the result unique Swiss commuters. Some people appear on both their origin and destination city pages. Likewise, routing coverage measures completeness of the displayed model, not correctness of its transport assumptions.

## Reproduce

From the repository root, using Node 22.13+ and Python 3:

```sh
npm run audit:data
npm run audit:report
npm run audit:data -- --strict
```

`audit:data` regenerates the JSON and CSV evidence. It does not call routing services. Missing required input files stop the audit rather than silently skipping external checks. The default command succeeds after writing results even when findings exist. `--strict` writes the same evidence and then returns exit code 1 for failed checks; that is expected for this snapshot. `audit:report` regenerates the findings and canonical report input.

The written diagnoses are a reviewed snapshot, not an automatic classifier. After changing definitions or the model, review and update the narrative findings as well as rerunning the numeric checks. In particular, the recovered INSEE grouping deliberately reproduces the current, incorrect mapping so its impact is inspectable; update that reconciliation when implementing the correction. Preserve this dated audit before replacing it with a later review.

To build the standalone HTML using the installed Data Analytics plugin:

```sh
node scripts/package-audit-report.mjs /path/to/data-analytics-plugin
```

The packaging helper reuses the plugin's validator, reader, SVG extraction and browser verifier. It contains one CSS correction for the plugin's `100vw` top bar, which otherwise overflows when macOS scrollbars occupy space. It preserves the reader's automatic light/dark styling. No separate chart or report renderer is implemented. The plugin requires SQL provenance even for file analyses: the report records an actual SQLite row-delivery projection and explicitly identifies it as packaging only. The analytical calculations remain in the audit scripts and source snapshots.

## Original sources and exact selections

All sources were fetched on 6 September 2026. File hashes are in `audit.json`; the INSEE archive hash is also in its aggregate file.

| Source | File and selection |
| --- | --- |
| [FSO commune matrix](https://dam-api.bfs.admin.ch/hub/api/dam/assets/27885394/master) | `sources/fso-commune-matrix-original`; year 2020, W perspective for inbound, R for outbound, excluding residence=workplace. Reconcile every retained domestic pair and full domestic totals for the 11 standard cities. |
| [FSO 2023 modes](https://www.bfs.admin.ch/asset/de/DF_SSV_MOB_COM) | `sources/fso-modes.xml`; `CH1.SSV,DF_SSV_MOB_COM,2026.1.0`. OBS total / PT / MIV and CI attributes. |
| [FSO mode definitions](https://disseminate.stats.swiss/rest/dataflow/CH1.SSV/DF_SSV_MOB_COM/2026.1.0?references=all) | `sources/fso-mode-definitions.xml`; concept explicitly says outgoing and within-commune commuters. MIV includes motorised private transport; soft is reconstructed as a residual. |
| [FSO border workers](https://www.pxweb-admin-a.bfs.admin.ch/api/v1/en/px-x-0302010000_101/px-x-0302010000_101.px) | Metadata, exact read-only POST query and result in `sources/fso-cross-border-*.json`; sex total, 12 workplace communes, 2025Q4. Verify the 11 standard-city totals rounded to people. Geneva's INSEE canton cohort has a different definition. |
| [OCSTAT 2024](https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx) | `sources/ocstat-commuters.xlsx`; sheet `2024`, rows 15, 21, 22 and notes 24–30. C/F columns are published 95% confidence interval percentages. This is canton-level data. |
| [INSEE RP2023](https://www.insee.fr/fr/statistiques/9004795) | Original `RP2023_mobpro.zip`, streamed without extracting individual records to the repository. Aggregate Swiss-workplace rows in `sources/insee-swiss-aggregates.json`; preserve TRANS categories and sum IPONDI. The audit then selects French departments 01/74 and SUC workplace codes (the 45 Geneva canton communes), reconstructs the current grouping, and rounds once per origin/app mode. All 714 French rows reproduce. |
| [Six-city mobility comparison](https://www.stadt-zuerich.ch/content/dam/web/de/aktuell/publikationen/2023/staedtevergleich-mobilitaet-2021/staedtevergleich-mobilitaet-2021.pdf) | `sources/city-mobility-comparison-2021.pdf`, Figure 22, printed p. 20. Domestic incoming main-mode shares, pooled 2019–2021. Different cohort and vintage from the applied resident shares; a diagnostic benchmark, not a replacement estimate. |

To recreate the INSEE aggregate from a downloaded archive:

```sh
python3 scripts/audit-insee.py /path/to/RP2023_mobpro.zip audits/2026-09-06/sources/insee-swiss-aggregates.json
```

`scripts/audit-sources.py` uses Python's CSV and XML parsers independently of the original application generator. The INSEE sum is 119,005.63 before rounding and 119,003 after the recovered origin/category rounding. This small difference is expected; the inclusion of “no transport” in active travel is not.

## Validation and limits

The 26 existing application tests passed. All corridor keys, numeric values, cache joins, rail continuity, directional road coverage and filter conservation checks passed. The 17 failed audit instances comprise 14 inconsistent shared car allocations, two related Geneva population-scope checks and one 1.64 km road-endpoint snap review flag. These are not 17 independent root causes.

The notebook code cells were executed sequentially with Python 3 and their actual outputs saved. Jupyter/nbclient is not installed here; there was no Jupyter-kernel launch. The notebook uses only standard-library Python and can be rerun in any Python 3 Jupyter environment.

The audit has no independent observations of live road traffic, passenger loads, bicycle counts, attendance, congestion or actual station choice. Its time series compare model constructions, not observed historical trends. No earlier complete input/model snapshot was available for a before/after regression comparison. Source years and cohort definitions must remain attached to the findings. Production-versus-local equality was not rechecked during this audit.

Report design: technical audit; summary → metric definitions → ranked findings → six-city benchmark → 12-city coverage → model-clock comparison → source reconciliation → next actions. The first chart compares two categorical bases across six cities; the second compares route coverage across 12 cities and three modes; the line chart compares two constructions across 145 model-time points. Exact values and exceptions are kept in tables/CSVs rather than additional charts.
