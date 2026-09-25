# Swiss Commutes

Swiss Commutes is an illustrative working-day model for sixteen Swiss locations. It turns commune-level home-to-work records into a map that can follow Swiss local time, fast-forward through the day or be scrubbed by hand.

[Open the live project](https://www.danielpradilla.info/swiss-commutes/geneva/)

The current cities are Zürich, Geneva, Basel, Lausanne, Bern, Winterthur, Lucerne, St. Gallen, Lugano, Biel/Bienne, Schaffhausen, La Chaux-de-Fonds, Chiasso, Mendrisio, Zug and Neuchâtel. Geneva covers the canton; the other pages cover city communes.

## Inspiration

The project began with [“An animated map of all commuters to Geneva”](https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/) by [Habibi Code](https://www.habibicode.org/commuters/). The original made a large statistical subject feel immediate: people leave hundreds of communes, converge on Geneva and return later in the day.

Swiss Commutes is an independent implementation of that idea. It expands the view to several Swiss cities and adds commune tooltips, inbound and outbound colours, a clock-driven animation and a chart showing the estimated population above or below its daily average.

## What the animation shows

- Red dots are travelling into the selected city; blue dots are travelling out.
- A moving dot represents a bundle of trips, not one person.
- Grey circles represent communes. Their size follows the routed commuters associated with that commune, and they pulse when a journey arrives.
- Hovering a moving dot shows its origin and destination. Hovering a commune shows its name.
- Car / motorcycle, Public transport and Walk / bike start enabled. The buttons filter the map, chart, city circle and travelling counter together. The chart compares the selected commuters with their daily average; all mode counts are estimates.
- The animation starts at 07:45 once the map is ready and advances 15 simulated minutes per second. “Use current time” follows the Swiss clock; the data is not a live feed.
- Reduced-motion preferences start the clock paused. The “Commune journeys” disclosure provides keyboard-accessible names, commuter estimates and journey times; the time slider announces hours and minutes.

## Data sources

The project combines several official datasets because no single table contains all the necessary geography, direction, transport mode and current totals.

### Used across most cities

| Source | What it supplies |
| --- | --- |
| [FSO home-to-work commune matrix](https://opendata.swiss/en/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020) | Swiss residence-to-workplace pairs. The latest commune-level release used here is 2020. |
| [FSO cross-border workers, Q4 2025](https://www.pxweb-admin-a.bfs.admin.ch/pxweb/en/px-x-0302010000_101/-/px-x-0302010000_101.px/) | Reported cross-border worker totals by Swiss workplace commune. |
| [FSO Swiss Cities 2026](https://www.bfs.admin.ch/asset/en/DF_SSV_MOB_COM) | 2023 resident commuter counts: total, motorised private transport and public transport. The residual is an estimate of walking/cycling and may include other modes. |
| [Six-city mobility comparison](https://www.stadt-zuerich.ch/content/dam/web/de/aktuell/publikationen/2023/staedtevergleich-mobilitaet-2021/staedtevergleich-mobilitaet-2021.pdf) | Incoming and outgoing domestic main-mode shares, pooled 2019–2021; Figures 22–23. |
| [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d) | Swiss commune geography and centre points. |
| [API Géo](https://geo.api.gouv.fr/decoupage-administratif/communes) | Official French commune names, populations and centre points. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Names and centre points for other foreign communes. |
| [ARE NPVM 2023, version 2](https://zenodo.org/records/18486217) | Swiss rail network geometry. Passenger load fields are not imported. |
| [DiDok station register, published by SBB / SKI](https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/) | Passenger station locations and their commune identifiers. |
| [Stadia Alidade Smooth](https://docs.stadiamaps.com/map-styles/alidade-smooth/) | The basemap displayed behind the animation. |

### Geneva

Geneva has a more detailed combination of sources:

| Source | What it supplies |
| --- | --- |
| [INSEE RP2023 MOBPRO](https://www.insee.fr/fr/statistiques/9004795) | French home-to-work records, including the usual transport mode. |
| [FSO home-to-work commune matrix](https://opendata.swiss/fr/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020) | Swiss commune pairs and their relative shares. |
| [OCSTAT 2024](https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx) | More recent totals used to update the Geneva–Vaud flows. |
| [API Géo](https://geo.api.gouv.fr/decoupage-administratif/communes) and [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d) | Commune names and locations on both sides of the border. |

## The difficult parts

### The tables do not contain a clock

The source records say where people live and work, but not when they leave. The morning and evening waves are modelled with smooth arrival and departure curves. The car count uses estimated departures and route travel times. This makes the animation legible, but it should not be read as an observed traffic count for a particular minute.

### Cross-border totals do not always include foreign origins

For most cities, the FSO cross-border table gives the Swiss workplace commune but not the worker’s home commune abroad. The project distributes that total among nearby foreign communes using population and distance. Geneva is the important exception: INSEE provides actual French origin communes. These figures cover people working in Switzerland; they do not measure Swiss residents who commute to jobs abroad.

### The source years do not line up neatly

The Swiss commune matrix is from 2020, transport shares are from 2019–2021 or 2023 and cross-border totals are from Q4 2025. Geneva combines French 2023 records with OCSTAT 2024 totals. The project preserves those vintages instead of presenting the result as a single-year census.

### Transport detail is uneven

The French records used for Geneva retain the reported workplace commune and usual transport mode; no-journey records are excluded. Swiss pairs use domestic inbound shares for Zürich, Basel, Bern, Lucerne, St. Gallen and Winterthur where available. Otherwise they use the home city’s outbound shares, then its 2023 resident mix. A small-city resident average proxies missing Swiss communes. The same directed pair gets the same estimate on both city pages. These aggregate shares do not establish an individual pair’s modes. Foreign allocations outside Geneva still use the destination’s resident mix as a proxy.

### Road routing is a model

Every city’s car layer routes at least 95% of its mapped inbound and outbound motorised estimates separately through the road network. Valhalla supplies independent journeys to work and home, including travel times for each route manoeuvre. Moving dots follow the routed journeys over the existing basemap. No additional road or rail traces are drawn. The travelling counter and particles use the same modelled departure waves.

Particles keep their route-specific timing. The map caches projected coordinates and moves the existing canvas during a drag. Animation pauses in hidden tabs. The removed road overlays no longer allocate shared-road indexes or calculate road widths.

The data ends at the commune boundary. French town halls from API Géo and Swiss settlements from [swisstopo's place search](https://docs.geo.admin.ch/access-data/search.html) approximate the endpoints, keeping departures in inhabited places instead of forest tracks near a geographic centroid. Swiss communes without a single matching settlement retain their original point, and one route represents each commune pair. Geneva retains the known home and workplace communes in Vaud and Geneva canton; unknown source code 7777 is not given an invented endpoint. Travel times are routing estimates, not live congestion. Road volumes count people in the car/motorcycle category, not vehicles. Shared geometry is matched by directed coordinate pairs; partial overlaps at route endpoints can remain separate. Outside Geneva, foreign home locations and the transport split remain estimates from the existing city datasets; routing does not make those counts more precise.

### Rail paths and timetable journeys

All sixteen locations include Swiss rail paths from ARE’s NPVM 2023 network, matched to the official DiDok passenger station register. Independent railways use their own terminus within the destination city (for example Zürich HB SZU and Stadelhofen for the Forchbahn), without inventing a track connection to the main railway. Station mode lists accept both comma and pipe separators, including mixed train/tram stops. The importer uses the existing Swiss public-transport corridors and their estimated commuter counts. It does not add the federal model’s passenger loads: those include journeys for other purposes and would not be compatible with our commuter totals.

A path connects a station in the remote commune to the selected city’s main station, or to a terminus of its independent railway within the city. The station must be within 5 km of the commune’s settlement point and within 500 m of a connected model-network node. Geneva uses the actual workplace or home commune within the canton, skipping communes without a suitable station. Main stations are preferred for the sixteen project cities; elsewhere the nearest eligible station is used. Paths follow the shortest physical distance on the connected network, with an excessive-detour check. This does not establish a timetable-valid itinerary, a particular train service, or passengers’ actual station choices. The same track path is used on the return journey. The network is from 2023, while the station register was downloaded in September 2026; unmatched stations are skipped.

No straight access lines are added between commune centres and stations. Bus connections, disconnected rail systems that require a transfer, foreign rail sections, and unknown canton-level destinations remain incomplete. Geneva now retains the known commune pairs in both directions. Geneva prioritises the dated timetable itineraries described below, including routed walking connections; other cities retain a small set of public-transport preview routes.

Only the selected city’s used track segments are exported, each stored once. Particle interpolation reuses cumulative route distances; track lines are supplied by the basemap. No national network processing or routing API calls run in the browser. Road exports similarly store repeated manoeuvre geometry once and reconstruct the original polylines in the browser; a round-trip check verifies that no coordinates or timing change. Prepared road routes share coordinate objects.

### Walking and cycling share a category

The third button is labelled **Walk / bike (estimate)**. Geneva’s French data and the six-city study explicitly distinguish active travel; the resident-table fallback uses a residual that may include other modes. Local routes come from Valhalla, using walking for endpoints within 3 km of each other and cycling beyond that. This distance rule chooses route geometry and travel time; it does not establish which people actually walk or cycle.

The importer considers endpoints up to 25 km apart, then selects pairs covering 95% of those local estimates in each direction. Routes longer than 35 km, taking more than three hours, or snapping over 400 m from a settlement are skipped. Coverage can fall below the selection target when a route is unsuitable. Independent journeys to work and home respect each direction's routing restrictions. The chart and counter include only the routed local journeys. Unrouted and long-distance active estimates remain visible in the coverage audit; they are not reassigned to cars.

City route caches are generated once and loaded with the selected city. Toggling modes reuses the prepared routes and preserves map position and zoom. The city circle keeps the same size scale; the chart keeps the all-mode vertical range unless a selection would fall outside it. This makes the smaller walk/bike contribution visible at its actual relative size.

### Every person cannot be drawn

Large cities contain hundreds of thousands of journeys. Drawing one point per person would obscure the map and perform poorly, so each moving dot stands for a group of trips. Commune circles preserve the relative scale without covering the entire basemap.

### The map has a practical boundary

The map, chart and counter use the same routed commune pairs. The coverage disclosure separates the source cohort, mapped pairs and routed estimates for each mode. Geographic exclusions happen before the 95% car-routing target. These percentages measure completeness of the model, not its accuracy.

## How the model works

Each routed corridor contributes its commuter estimate to one departure/arrival model. Incoming workers increase the estimate when they arrive at their workplace endpoint and leave it when they depart for home; outgoing workers do the reverse. These are endpoint times, not measured crossings of the city boundary. The chart has no resident-census population baseline.

All modes depart in triangular waves from 05:00–10:00 and 15:00–20:00. Road and active routes supply travel times; rail time remains a distance-based estimate, not a timetable. The full cohort travels on this illustrative working day, without attendance, remote-work, holiday or shift adjustments. Following the Swiss clock does not make it live traffic.

Map particles, the travelling counter and population chart share those distributions and routes. Car particles represent up to 50 people; other particles up to 200. Counters use continuous weighted estimates, so sampled dots can differ slightly at a particular minute. Selecting no modes gives zero; mode contributions add to the all-mode estimate within rounding.

The chart samples the resulting population estimate every ten minutes. Its centre line is the modelled daily average, not midnight, so the same curve can show both the quieter and busier parts of the day.

## Live views: what the server needs

Two views read live sources instead of the model: `/live/` (measured road counters) and `/trains/` (reported timetable delays). Both are PHP on DreamHost; the static export ships the pages, not the data. [LIVE.md](LIVE.md) documents the traffic source, units and the retained minute; [trains/SPEC.md](trains/SPEC.md) documents the train feed.

### State kept outside the published directory

| State | Location | Holds |
| --- | --- | --- |
| Traffic private directory | `/home/depr001/.swiss-commutes/live` on DreamHost | `credentials.env` with `ASTRA_API_KEY`, the last collected minute, station metadata, `collection.log` |
| Train private directory | `trains/.private/` | `credentials.env` with `GTFS_RT_API_KEY`, the GTFS-RT source cache, `timetable-current` |

`SWISS_LIVE_PRIVATE_DIR` names the traffic directory. Web requests read it from `live/.htaccess` (`SetEnv`); CLI reads it from the cron line. Without it the collector falls back to `live/.private`, which stores no key: `/live/` answers 503 and the error log records `Traffic key not configured`. Publishing the export must therefore exclude `live/.private/`, `trains/.private/` and `trains/timetable/`, and must not remove `live/.htaccess`.

### Required cron entries

```sh
* * * * * SWISS_LIVE_PRIVATE_DIR=/home/depr001/.swiss-commutes/live /usr/bin/php /home/depr001/danielpradilla.info/swiss-commutes/live/feed.php >/dev/null 2>&1 # Swiss Commutes live collector
15 * * * * /usr/bin/python3 /home/depr001/danielpradilla.info/swiss-commutes/trains/.private/updater/scripts/update-train-timetable.py --root /home/depr001/danielpradilla.info/swiss-commutes/trains >> /home/depr001/danielpradilla.info/swiss-commutes/trains/.private/timetable-update.log 2>&1
```

The traffic collector waits for the source's publication minute itself, so its entry adds no `sleep`. The train feed needs no entry: a request refreshes its cache at most once a minute.

### Checklist

1. Run `npm run test:live`, `npm run test:trains`, `npm run lint` and `npm run build`. The export check reads `public/live/.htaccess` and both `.private/.htaccess` files, so these three must stay tracked in git; credentials and caches are ignored by `.gitignore`.
2. Publish `out/` to `/home/depr001/danielpradilla.info/swiss-commutes/`, `_next/` first, without `--delete` and excluding the private directories and `trains/timetable/`.
3. Confirm `live/feed.php` returns the collected minute, `live/.private/` returns 403, collection advances without page visits, and every `/live/<city>/` page shows that minute. `trains/feed.php?city=zurich` must report a recent `fetchedAt`.

## Development

### Data audit

The [8 September project audit](audits/2026-09-08-project/README.md) records the code, browser, dependency and data checks, the bugs fixed, and the remaining improvement priorities. The build also verifies that the home page loads Zürich’s complete route coverage and that exported scope labels and metadata are present.

The [audit and deployment verification](audits/2026-09-06-deployed/README.md) covers all sixteen locations and retains the [original twelve-city baseline](audits/2026-09-06/README.md). The follow-up includes a standalone report, an analysis notebook, original-source reconciliations and CSVs for every city and corridor. Run `npm run audit:data -- --strict --output=audits/2026-09-06-deployed` to refresh the checks and return a non-zero exit code when checks fail. Its findings distinguish source-copy accuracy from the suitability of mode shares, geography, routing coverage and time models.

The site is a statically exported Next.js application using React, Leaflet and a canvas overlay.

Pages include commuter counts and journey durations, while geometry loads from each city’s separate `routes.json` file. A content version keeps the page and geometry in sync. Route preparation yields between batches so filters, the clock and navigation stay usable while the map loads. Failed downloads can be retried without losing the counts or chart. These files use Next.js’s [static Route Handler export](https://nextjs.org/docs/app/guides/static-exports#route-handlers); production needs no application server.

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Validation and production export:

```bash
npm test
npm run lint
npm run build
```

The production files are written to `out/` and expect the `/swiss-commutes` base path. The build adds `data-cfasync="false"` to exported scripts so Cloudflare Rocket Loader preserves Next’s script execution order.

The generated city modules can be rebuilt from downloaded FSO and swisstopo inputs with:

```bash
node scripts/generate-top-city-data.mjs \
  --commutes=/path/to/commune-matrix.csv \
  --centres=/path/to/commune-centres.tsv \
  --out=app/data
```

The audit folder preserves the statistical source snapshots. `app/data/commune-centres.json` retains the existing point catalogue; Gy was added from the swisstopo settlement search. Older point transformations are not fully recoverable. The generated TypeScript modules under `app/data/` are the files used by the site. Add `--cities=chiasso,mendrisio,zug,neuchatel` and `--centres=app/data/commune-centres.json` to rebuild just the four additions. Neuchâtel combines the 2021 merger communes and excludes journeys within that merged commune. Chiasso and Mendrisio distribute their border-worker totals using Lugano’s existing foreign-origin pattern; this is a regional proxy.

`python3 scripts/generate-resident-modes.py` rebuilds the resident-mode lookup. `python3 scripts/generate-geneva-data.py` rebuilds Geneva from the preserved sources, using Vaud-only totals in both directions and retaining unlocated estimates in its summary. The original raw imports for Basel, Lugano, Schaffhausen and La Chaux-de-Fonds are still missing; their generated pairs are independently reconciled to the original FSO matrix by the audit.

Rebuild or resume all car route caches, or just one city:

```bash
npm run routes:cars
npm run routes:cars -- lausanne
```

This writes `app/data/<city>-car-routes.json`, retaining each successful batch with an atomic checkpoint. Only the selected city’s routes are loaded from its static geometry file. Both directions must be present for a commune pair to appear. The generator batches journeys with separate break waypoints within the public server’s ten-location limit, makes at most one request per second, and retries temporary errors. Journeys with matching endpoints are reused across inbound/outbound pairs and cities. Remove matching cached routes to refresh them. The exported site makes no routing API requests. The tests check coverage, both route directions, travel-time interpolation and travelling commuter totals.

Rebuild all Swiss rail caches offline:

```bash
npm run routes:rail -- /path/to/Belastungswerte_Schiene_Schweiz_NPVM_2023.gpkg /path/to/stations.json
```

Download only `2_Belastungswerte_Schiene_Schweiz_NPVM_2023.zip` from the [ARE release](https://zenodo.org/records/18486217) and extract its GeoPackage. The national model’s much larger matrices and VISUM files are unnecessary. Export station JSON from SBB’s `/api/explore/v2.1/catalog/datasets/dienststellen-gemass-opentransportdataswiss/exports/json` endpoint, filtering `stoppoint="true" AND meansoftransport like "TRAIN" AND isocountrycode="CH"` and selecting `number,designationofficial,geopos,fsonumber,meansoftransport,validfrom,validto`. The importer validates dates locally and requires Node.js 22.13+ with its built-in SQLite module; no extra dependencies are needed.

The generated `app/data/<city>-rail-routes.json` files include source URLs, station names and locations, signed segment references and encoded geometry. Tests check coordinate conversion, graph routing, station endpoints, continuous tracks, city file sizes and the previously missing Geneva connections.

Generate or resume the walking/cycling caches:

```bash
npm run routes:active
npm run routes:active -- geneva
```

This reuses the car importer's Valhalla client, settlement points, batching and one-request-per-second limit. Successful directional routes are shared across matching pairs and saved after each batch. The browser receives only complete, suitable pairs. Route choices rejected by the distance/time checks are recorded in `skipped`; delete that entry to retry it. Tests check local-trip selection, both route directions, route durations, conservation of population totals across mode selections and the empty selection.

Car, active and timetable imports save progress in ignored `.pending` files, then atomically replace the published cache after the import completes. Interrupted imports resume those checkpoints and preserve the previous published cache. Changed endpoints invalidate rejected active and timetable routes; changed walking/cycling routing also retries an active pair. Preview refreshes preserve the old file if any request fails, and rail exports use an atomic file replacement.

### Geneva timetable journeys and Vaud modes

Geneva prioritises paired morning/return itineraries from the Swiss 2026 GTFS timetable, including cross-border buses, trains, walking connections and transfer waiting. Routes are imported with local MOTIS; the app makes no live timetable requests. Missing timetable journeys retain the documented rail-geometry fallback where available. A sample weekday itinerary establishes a possible connection, not the service or departure time each worker uses.

Vaud–Geneva mode shares use the directional RS 2020 survey in OCT’s 2022 report (page 40). Unspecified modes remain in mapped totals but are excluded from the three mode filters, chart and counter. They are not counted as cyclists. Other cities still have the limitations described in the audit.

The [priority-fixes audit](audits/2026-09-06-priorities/README.md) preserves the earlier snapshots and documents the offline transit import, original mode table, before/after values and remaining gaps.
