# Swiss Commutes: priority fixes

This snapshot implements the two priorities identified in the [original-project comparison](../2026-09-06-fixed/original-project/README.md): missing Geneva public-transport itineraries and the inappropriate resident-mode mix on Vaud–Geneva journeys. The [preceding corrected build](../2026-09-06-fixed/README.md) and [original audit](../2026-09-06/README.md) remain unchanged.

Open [report.html](report.html) for before/after values and all 16 locations. French public-transport coverage rises from 3,083 to 16,081 of 18,812 mapped people (85.5%), across 76 origins. Geneva’s overall public-transport coverage is 31,201 of 34,167 (91.3%), including 483 people on rail-geometry fallback. The Vaud incoming mix changes from 9,516 car / 7,047 public transport / 4,738 active to 8,469 car / 12,103 public transport / 729 unspecified. [analysis.ipynb](analysis.ipynb) reproduces the checks offline; `audit.json` and the CSVs hold complete results.

Geneva now uses sample morning and return itineraries from the Swiss 2026 GTFS timetable, including cross-border buses, trains, walking connections and transfer waiting. Both directions must have a dated public-transport service, accepted geometry and a journey under three hours. Segments longer than 2 km are rejected for review. An initial 1 km threshold wrongly excluded straight OSM road/rail sections: 21 samples along each of five rejected segments stayed within 0.05 metres of the source network. `sources/transit-gap-review.json` and its companion script preserve that check; it is not a validation of every segment. Walking is capped at 45 minutes total and 20 minutes at each end. Failed pairs remain explicit in the cache. Where a timetable pair is missing, an existing rail-geometry route can still be shown with an estimated duration. No connections are invented to fill gaps.

The dated itinerary is a possible journey between commune points. It is not the service used by every commuter, nor a timetable simulation throughout the day. The shared illustrative departure waves remain unchanged. OSM geometry is a routing estimate; GTFS establishes the service and timing. The app makes no live routing requests.

Vaud–Geneva shares now use the original RS 2020 table in [OCT’s 2022 report](https://www.ge.ch/document/22897/telecharger), physical PDF page 40. Adding Nyon and the other Vaud districts gives 9,389 car, 13,437 train and 858 other incoming commuters; outgoing counts are 2,561 car, 4,419 train and 521 other. Directional shares are applied to the existing scaled OD totals using largest remainders. The other category stays unspecified, with no active allocation. It remains in source/mapped totals and is excluded from the three filters, chart and counter. Zero allocated active travel does not establish zero cyclists. The survey year coincides with the pandemic, and aggregate historical shares do not identify individual OD modes.

## Reproduce the audit

Node 22.13+, Python 3 and `pdftotext` are required. Original statistical inputs are preserved in `sources/`; the PDF is independently parsed by `audit-sources.py`.

```sh
npm test
npm run lint
npm run build
npm run audit:data -- --strict
npm run audit:report
node scripts/package-audit-report.mjs /path/to/data-analytics-plugin audits/2026-09-06-priorities
```

The notebook needs only Python's standard library and the adjacent evidence. The audit is offline; the route imports below are separate. Passing reconciliation and geometry checks does not establish actual traffic, mode choices, attendance or passenger loads.

## Reproduce the local timetable import

`sources/transit-inputs.json` records download URLs, byte counts and SHA-256 hashes for MOTIS 2.11.2, the Swiss GTFS snapshot of 2 September 2026, the Swiss/French OSM inputs and the clipped region. The large raw files remain outside the repository. OSM latest URLs change; exact reproduction requires files matching the saved hashes. Swiss GTFS includes the cross-border TPG and Léman Express services used here.

1. Download the recorded inputs. Install pyosmium in an isolated Python environment for the map preparation script; it is not an application dependency.
2. Run `scripts/prepare-transit-map.py region.osm.pbf switzerland.osm.pbf rhone-alpes.osm.pbf` with that environment. It retains relevant roads, rails, ferries and turn restrictions within the documented region and merges duplicate OSM elements.
3. Adapt paths in `sources/motis-config.yml`. Run `motis import -c config.yml -d data`, then `motis server -d data`. Keep the service bound to localhost.
4. Run `npm run routes:transit -- geneva 2026-09-08 http://127.0.0.1:8090`. The importer only accepts a local routing endpoint; it does not bulk-query Transitous. Cached accepted routes and unavailable pairs avoid repeated routing. To change the map with the same metadata, archive the old route cache and regenerate it.
5. Run `python3 scripts/generate-geneva-data.py`, `npm run routes:cars -- geneva lausanne`, `npm run routes:active -- geneva lausanne` and the documented `routes:rail` command if rebuilding the mode changes from an earlier checkout. Then rerun the checks above.

`app/data/geneva-transit-routes.json` preserves both routes and service evidence: dates, lines, agencies, trip/route IDs, stops and times. The runtime receives only packed geometry and timing. Source and method limitations for the other locations remain documented in the preceding audit; foreign-origin allocation, modal residuals and timetable coverage beyond Geneva are still open.

Validation: 716 audit checks and 35 tests pass; lint and production export pass. Six notebook cells execute successfully. The portable report passes desktop/mobile checks. `implementation-verification.json` records mode-filter, layout and local performance checks. The larger route set uses more browser memory; the saved sample is specific to the local machine. These changes are local and have not been deployed.
