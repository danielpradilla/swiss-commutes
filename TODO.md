# Swiss Commutes: possible next projects

Each version below is a separate project, not a release sequence. The present site has four different views: an illustrative home-to-work model, measured road counters, reported train delays, and reported shared-vehicle availability. A future project should choose a question and a matching unit of observation before combining them. In particular, a vehicle at a counter is not a commuter in the model, a train update is not a passenger count, and a rental vehicle available now is not a completed trip.

## What the current sources can support

| Source already used | Available evidence and current implementation | Boundary for future work |
| --- | --- | --- |
| [FSO commune home/work matrix and other statistical inputs](README.md#data-sources), [2023 ARE national passenger model](https://zenodo.org/records/18486217), [Valhalla](https://valhalla1.openstreetmap.de/) | Sixteen city views with estimated inbound/outbound people by mode. The 2020 Swiss commune matrix, 2019–2021 or 2023 mode shares, Q4 2025 cross-border totals, Geneva's French 2023 records and 2024 OCSTAT totals have different vintages. Valhalla supplies cached directional car and local active route geometry and travel time; ARE supplies Swiss rail geometry, not this project's passenger loads. | Departure waves, rail fallback time, pair-level modes outside French records, and most foreign home communes are estimates. The model does not observe daily attendance, car occupancy or current congestion. City totals overlap and must not be added nationally. |
| [ASTRA / FEDRO DATEX II counters](https://opentransportdata.swiss/en/cookbook/road-traffic-cookbook/rt-road-traffic-counters/) | One-minute, lane/direction-specific light/heavy vehicle counts and mean speeds at instrumented roads; `public/live/feed.php` keeps the newest collected minute, matching site-table versions and excluding error/test readings. `/live/` colours each station by its busiest complete detector, not by total station traffic. | The feed replaces each minute and offers no historical backfill. Counters cover only instrumented roads and all trip purposes. Light vehicles include more than private commuter cars; counts are vehicles, not people. Speed at a detector alone does not prove delay or congestion. The data is best-effort, not the validated official annual series. |
| [Swiss GTFS Static](https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/) + [GTFS-RT Trip Updates](https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/) | Dated service calendars, stops, routes, stop times and transfers, joined to reported stop-level delays by `feed_version` and trip identity. `/trains/` shows trains serving a selected city's stations, their next reported stop and delay. Train number comes from `trip_short_name`; line from `route_short_name`. The site places an *estimated* dot between stops along nearby ARE rail geometry. | No GPS/vehicle-position or occupancy feed on this platform. RT covers operators that contribute updates, not necessarily every scheduled train. No update is not the same as on time. GTFS trips/stop identifiers and service days require careful version and >24:00 handling. The current collector requests nationwide JSON, which the provider documents for testing only; production use should switch to protobuf. |
| [SFOE / sharedmobility.ch GBFS](https://github.com/SFOE/sharedmobility/blob/main/Access%20the%20data.md) | `/mobility/` merges four public combined feeds (types, free vehicles, station information and status) and provider-specific GBFS 2.3 station type counts. It filters reserved/disabled vehicles and stale station counts, removes station/vehicle double counting, and shows available bikes, scooters, cars and mopeds at reported sites. The list and total follow the map viewport. | Only participating providers and reported availability; no bookings, completed rides or guarantee that a vehicle will still be there. Mixed-type station counts need provider detail; missing detail is omitted. The present icon groups cargo bikes with bikes and does not expose e-assist, provider restrictions, prices, docks or service areas. Combined GBFS 2.0 has Swiss multi-provider extensions; provider 2.3 needs an email Authorization header. |

The road and train collectors require server credentials. ASTRA access is initially six months and 260,000 requests in this project's subscription; a minute-by-minute collector uses about 1,440 measurement calls per day plus metadata ([LIVE.md](LIVE.md#operation)). The train API allows two requests per minute in a sliding window, caches new data for 30 seconds and has a three-hour preview; the site polls once a minute. Shared mobility's same-origin PHP cache lasts at least 60 seconds and needs no API Manager key ([MOBILITY.md](MOBILITY.md#server-operation)). Preserve source timestamps, coverage and failure states whenever building a historical or comparative view.

## Version 1 — Evidence and coverage atlas

**Question:** Which mapped commute corridors come from published records, statistical allocation, routing or a combination of these, and which are omitted?

- Put the routed share of each mode beside its control; show source cohort, mapped people and routed people separately. Let users inspect a commune pair's source year, origin evidence (recorded French commune versus allocated foreign origin), mode-share rule, route method and reason for exclusion. Do not invent confidence intervals.
- Add a city-by-city coverage panel. The [8 September audit](audits/2026-09-08-project/README.md) reports routed public-transport shares of 14.7% in Chiasso, 15.2% in Mendrisio, 29.6% in Lugano and 44.8% in Basel, against 91.3% in Geneva. These are completeness figures for mapped transit estimates, not accuracy or public-transport market shares.
- Extend the existing offline timetable/MOTIS importer to one weakly covered area first. Basel tests a cross-border urban network; Ticino tests rail/bus connections to Italy. Report accepted and rejected pairs and keep any unknown mode explicit. The present Geneva import demonstrates dated feasible journeys, not the train each worker used.

**Deliverable:** A route-evidence view for all sixteen locations and one newly imported region, with reproducible source vintages and denominators. This is the safest first project because it improves the interpretation of data already shown before adding new observations.

## Version 2 — Road counters versus modelled car corridors

**Question:** Where do measured weekday road patterns agree or disagree with the *timing* of the illustrative car wave?

- With ASTRA access and retention/redistribution terms checked, archive one-minute detector records by site, lane, direction, source minute and site-table version. Preserve missing/error minutes; do not fill them with zeros. Derive comparable weekday profiles and a same-detector reference band from collected history. The upstream live endpoint cannot backfill missed minutes.
- Match selected routed car corridors to counter locations and direction, then compare *normalised time profiles*, not absolute commuter totals: the route layer counts people in a car/motorcycle category while the counter measures all passing vehicles, including non-commute trips. Publish how many corridor routes actually cross a matched detector; a nearest-road match is not sufficient.
- Add light/heavy and speed panels per detector, with detector-specific baseline and sample count. Use measured speed as a measurement, not a congestion index, until a defensible free-flow/reference speed is available. Keep lane counts separate unless physical layout proves they can be summed; never add sequential counters as if they counted distinct vehicles.

**Deliverable:** An instrumented-corridor case study, perhaps an approach to Zürich or Geneva, showing weekday timing, data gaps and a labelled model overlay. Road-counter terms require the attribution “Datenquelle: Verkehrsdaten-Plattform (VDP) ASTRA”; they prohibit raw machine-readable redistribution and combinations enabling behavioural profiling ([ASTRA terms](https://opentransportdata.swiss/tac-fedro/)). Public exports need a terms review and appropriately aggregated derived results.

## Version 3 — Rail reliability and connections

**Question:** Which scheduled commuter connections remain plausible when trains are delayed or cancelled?

- Start from dated GTFS trips and `transfers.txt` minimum transfer times. Join same-version GTFS-RT updates for sampled station pairs and calculate scheduled versus delay-adjusted connection margins. Show each contributing train, the feed publication timestamp, and whether the reported connection remains feasible, is at risk or has unknown status. A missing realtime update must stay unknown; a reported delay of zero means a report of on-time running.
- Replace the collector's testing-only `?format=JSON` with protobuf before scaling. Archive a bounded, versioned delay sample if history is needed; it does not exist in the current single-snapshot cache. Account for feed switches on Mondays/Thursdays, service exceptions, post-midnight trips and stop/platform identifiers (including newer SLOIDs).
- As a separate new source, evaluate [GTFS-RT Service Alerts](https://opentransportdata.swiss/en/cookbook/event-cookbook/gtfs-sa/) for closures and affected routes/stops; it is not part of the current Trip Updates integration and requires its own access and matching. Do not turn an alert into a confirmed missed connection without the relevant itinerary and times.

**Deliverable:** A station-pair reliability study for a named commuter corridor, with observed update coverage and explicit unknowns. The current moving train dots are timetable/geometry estimates, not observations of where trains actually are; neither this feed nor the timetable provides passenger loads or crowding.

## Version 4 — First- and last-mile shared mobility

**Question:** At what times are shared vehicles reported near the stations used by commuting corridors?

- Match validated DiDok station points to available GBFS sites using walking-network travel time, not a circle alone. Show bikes/cargo bikes, scooters and cars separately, with provider, freshness, station versus free-floating status and last reported availability. A map of available vehicles is not evidence that anyone used them to commute.
- Sample station availability at fixed intervals, preserving provider and type, to estimate the fraction of observed weekday snapshots with at least one usable vehicle near each station. Call this *observed availability*, not probability of securing a booking. Avoid tracking individual `bike_id`s: the combined-feed documentation says some providers do not rotate them after every trip ([GBFS additions](https://github.com/SFOE/sharedmobility/blob/main/Additions%20to%20GBFS.md#differences)).
- Check the provider's GBFS 2.3 metadata for operating areas, vehicle details, return rules and station capacity before showing them. The [sharedmobility REST API](https://github.com/SFOE/sharedmobility/blob/main/Sharedmobility.ch-API.md) additionally documents spatial `identify`, provider and region endpoints; it is an optional new integration, not a trip-history API. Do not infer a station's service area or capacity from `num_bikes_available`.

**Deliverable:** A station-access map and weekday availability profile for a few commuter hubs, with participating-provider coverage and stale-feed intervals visible. The [SFOE source terms](https://github.com/SFOE/sharedmobility/blob/main/Access%20the%20data.md#terms-of-use) allow reuse with author, title and dataset link attribution.

## Version 5 — Cross-border commute evidence

**Question:** Where do known foreign home communes support a corridor map, and where are origins only allocated?

- Make a Geneva case study using INSEE RP2023 MOBPRO's French origin communes, the Swiss workplace geography and the existing OCSTAT adjustments. Separate the French mode records from Swiss pair-level mode proxies and show dates on every comparison. Present Vaud–Geneva survey shares as aggregate evidence, not as the mode of each individual pair.
- For Basel, Schaffhausen and Ticino, first locate compatible official origin–destination and mode data from neighbouring countries. Until they are verified and reconciled to Swiss workplace definitions, keep the current population/distance allocation labelled as a scenario, not as measured border flows. Swiss cross-border totals identify workplace communes but generally do not locate workers' foreign homes; they also exclude Swiss residents who work abroad.
- Extend timetable-valid access beyond Geneva only where cross-border services and stop identifiers match; the Swiss ARE rail geometry alone omits foreign sections and buses. Report which destinations/communes lack a usable connection instead of drawing straight lines.

**Deliverable:** A Geneva border-corridor comparison plus a published source inventory and feasibility decision for one other border region. Do not rank cities by summed commuters: Geneva covers a canton while most pages cover a city commune, and the views overlap.

## Version 6 — A day in four data clocks

**Question:** How do the illustrative commuter day, observed roadside minutes and reported services differ at the same local time?

- Build a time-linked explanation rather than a single blended live counter. Place the modelled departure curve beside the latest ASTRA minute, GTFS-RT publication and GBFS update, each with its own date, scope and freshness. Let a user compare a selected city, detector, rail station and nearby pickup sites without implying that they describe the same people.
- A replay requires new timestamped storage for all three live feeds, rules for missed collections and retention, and permission to publish derived historical results. Until then, the honest view is current snapshots plus a simulated clock; a slider over today's model must not animate historical live data it never collected.
- A later scenario tool could ask how a timetable disruption changes a feasible route, but should use dated itinerary routing and explicitly chosen assumptions for attendance, departure time and mode switching. It cannot infer diverted car volumes from a train delay or count station availability as completed transfers.

**Deliverable:** A synchronised, source-labelled comparison for one city. Promote it to a historical replay only after enough complete collection days and terms review exist; keep it separate from Versions 2–4 rather than requiring their features.

## Shared decision rules

- Keep units visible: people in the commute model, vehicles/minute and km/h at detectors, minutes of train delay, and available rental vehicles at a feed timestamp. Show the population and coverage denominator before cross-city percentages.
- Preserve source year, collection time, missingness and geographic scope in exports. A gap caused by no station, an offline sensor, no realtime train report and an unrouted commune pair are different states.
- Start with one corridor or station pair and check the source joins and map geometry against known examples before scaling nationally. The present static Next.js export plus small PHP feeds suffices for current snapshots; longitudinal studies need a deliberately operated collector and storage policy, not a browser polling history.

## Sources and project evidence

- Local methods and operational detail: [README](README.md), [live traffic](LIVE.md), [trains](trains/SPEC.md), [shared mobility](MOBILITY.md), [project audit](audits/2026-09-08-project/README.md), [Geneva timetable audit](audits/2026-09-06-priorities/README.md).
- Provider specifications and constraints: [ASTRA counters](https://opentransportdata.swiss/en/cookbook/road-traffic-cookbook/rt-road-traffic-counters/), [ASTRA terms](https://opentransportdata.swiss/tac-fedro/), [GTFS Static](https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/), [GTFS Trip Updates](https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/), [GTFS Service Alerts](https://opentransportdata.swiss/en/cookbook/event-cookbook/gtfs-sa/), [SFOE sharedmobility access](https://github.com/SFOE/sharedmobility/blob/main/Access%20the%20data.md), [GBFS multi-provider additions](https://github.com/SFOE/sharedmobility/blob/main/Additions%20to%20GBFS.md), [sharedmobility REST API](https://github.com/SFOE/sharedmobility/blob/main/Sharedmobility.ch-API.md), [ARE NPVM 2023](https://zenodo.org/records/18486217). Access conditions and feed schemas should be checked again when selecting a version for implementation.
