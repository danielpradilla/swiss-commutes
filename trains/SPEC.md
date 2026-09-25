# Trains

A live map of trains at `/swiss-commutes/trains/`, with the same sixteen city routes as the other views under `/trains/<city>/`. For each city it maps trains currently serving that city's stations and lists the trains visible in the map: train number, current delay, next station, and estimated departure/arrival there. It follows the same city set, station register and PHP-on-cron pattern as [`LIVE.md`](../LIVE.md).

## Concept

- Scope trains to the stations already matched to each city in `app/data/<city>-rail-routes.json` (DiDok-numbered `stations` map, sourced from the [DiDok register](https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/)). A train is in scope for a city if its stop sequence includes one of that city's stations.
- Per train, show: train number (not the line name — see below), the next station it has not yet departed, and the estimated departure or arrival there (scheduled time adjusted by the reported delay).
- Unlike the traffic view, there is no 30-minute history to replay. The source is a live schedule-plus-delay feed, so this would show current state only, refreshed on an interval, not a replay loop.

## Source and units

- [GTFS-RT Trip Updates](https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/), endpoint `https://api.opentransportdata.swiss/la/gtfs-rt`, Bearer token via API Manager (same auth shape as the traffic feed, separate subscription/application).
- One request returns trip updates for all of Switzerland; there is no per-station or per-city query. Rate limit is 2 requests/minute, sliding window, so polling more often than every 30 seconds is not possible regardless of how many cities are shown.
- The feed reports **delay in minutes** (0.1-minute resolution) per stop, not an absolute predicted time and not a position. Estimated departure/arrival = the static schedule's time for that stop plus the reported delay. A stop with no update in the feed has no reported delay; whether to show the scheduled time unmarked or omit the train needs a decision (see below).
- Map geometry reuses the project’s existing [ARE NPVM 2023 Swiss rail network](https://zenodo.org/records/18486217), processed by `scripts/generate-rail-routes.mjs`; station coordinates come from the [DiDok register](https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/). Per-city encoded segments are exported at `/trains/<city>/rail.json` rather than embedded in page HTML.
- The feed is GTFS-RT "Trip Update" v1.0 only. **There is no vehicle-position (GPS) feed on this platform** — only Trip Update. A map view cannot show an observed location; any dot placed on the map would be a scheduling estimate (last known stop, next stop, elapsed fraction of scheduled running time), not a measured position. This should be labelled as such if built, the same way the traffic view labels modelled routes as not being live GPS.
- Train identity: `tripId` / `originalTripId` in the RT feed matches `trip_id` in the static GTFS. The static `trips.txt`'s `trip_short_name` field is confirmed by the source documentation to hold the train number for trains (distinct from `route_short_name`, which holds the line name, e.g. IC1, IR15, S3).
- Coverage is self-reported as "all transport companies providing real-time data" — not a documented guarantee of completeness. Smaller operators or specific services may not publish updates; those trains would show only the static schedule with no live delay.

## Static timetable (needed to interpret the RT feed)

The RT feed only carries stop IDs, sequence numbers and delays — it does not carry train numbers, stop names or the full stop sequence. Those come from the [static Swiss GTFS timetable](https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/) (`trips.txt`, `stop_times.txt`, `stops.txt`), which:

- Regenerates twice weekly (new HRDF Tuesdays/Fridays, GTFS built 1–2 working days later) and is republished as a dated dataset per timetable year (e.g. `timetable-2026-gtfs2020`).
- Uses `stop_id`s that incorporate the same DiDok numbers already used in `app/data/*-rail-routes.json` (e.g. `8503000` for Zürich HB), so city-station matching reuses the existing station register without a new geocoding step.
- Is a nationwide file covering every mode and operator, not just the sixteen project cities. `scripts/generate-train-timetable.mjs` filters it offline to rail trips active in a three-day window whose stop sequence touches a project-city station, then writes compact per-city files (trip ID → train number, ordered stop list with scheduled times) to the generated `public/trains/timetable/` deployment directory.
- Must match the realtime header's `feed_version`. The source can change trip IDs with each Monday/Thursday static publication, so regenerate and deploy the compact files whenever that version changes. The PHP endpoint rejects a mismatch instead of joining the wrong trips.

## Data model

The public feed uses this shape:

```
{
  "fetchedAt": "...",
  "trains": [
    {
      "tripId": "...",
      "trainNumber": "515",
      "line": "IC1",
      "lastStation": { "id": "8503000", "name": "Zürich HB", "lat": 47.378, "lon": 8.54, "departedAt": "..." },
      "nextStation": { "id": "8500010", "name": "Baden", "lat": 47.476, "lon": 8.307, "scheduledAt": "...", "delayMinutes": 3 },
      "cancelled": false
    }
  ]
}
```

## Operation

- `public/trains/feed.php` uses PHP 8.2+ and cURL. Browser requests share a locked 60-second nationwide source cache, so all cities together make at most one upstream attempt per minute.
- The uncompressed feed is about 62 MB, so the response streams directly to the candidate cache file with `CURLOPT_FILE` instead of being buffered in a PHP string; buffering it exhausted the 128 MB request limit and returned HTTP 500. A body above 64 MB is rejected. The candidate file is parsed before it replaces the last good source.
- A successful refresh is validated before it replaces the cache. If the API times out, rejects a request or returns invalid data, the endpoint serves the last valid cached feed instead of making the map unavailable. A retry marker prevents other city/browser requests from hammering the upstream API for the next minute. With no valid cache yet, the endpoint returns `503` and retries after one minute.
- Reading the cached source and building one city's feed takes about 17 seconds, because the streaming parser walks the 62 MB body character by character to stay inside the memory limit. Browsers fetch once per minute, and the client shows its loading state meanwhile.
- The implementation uses `?format=JSON` to avoid adding a PHP/Composer protobuf stack. This endpoint is documented for testing rather than production; move to protobuf when a supported decoder is available in the deployment environment.
- Credentials follow the existing pattern: `GTFS_RT_API_KEY` in `public/trains/.private/credentials.env`, `.htaccess`-denied.
- No 30-minute replay buffer is needed the way traffic has one — GTFS-RT is a current-state feed, not a per-minute counter history. A simple "latest fetch" cache, refreshed roughly every 30–60 seconds, covers the concept above. If a played-back history of delays is wanted later, that's an addition, not a default.

## Implementation decisions

1. Use JSON and no new dependency.
2. Omit a train when its next stop has no realtime update.
3. Show an explicitly labelled estimated position using delay-adjusted progress between the last and next timetable stop, snapped to the existing ARE NPVM 2023 rail geometry used by the commute maps. The source has neither GPS positions nor GTFS track shapes. If no project rail segment is nearby, keep the dot at the nearer stop rather than drawing an impossible straight path across lakes or mountains.
4. Store the API Manager token as `GTFS_RT_API_KEY` in `public/trains/.private/credentials.env`.
5. Filter the trains currently visible on the map by line, train number or next-station name. Matching map dots are enlarged and outlined; a clicked result remains distinctly selected.

## Checks and deployment

`scripts/update-train-timetable.py` checks the realtime header and the active three-day service window. When either changes, it finds the exact-version ZIP in the [official GTFS catalog](https://data.opentransportdata.swiss/dataset/timetable-2026-gtfs2020), verifies `feed_info.txt`, generates all city timetables from the rail-station data, validates each result, and atomically switches `.private/timetable-current`. It retains the ZIP for daily service-window rebuilds and leaves the previous timetable active on failure. Errors go to the cron log. The PHP endpoint prefers this private symlink and falls back to the original public timetable before the first successful update.

Deploy `scripts/update-train-timetable.py` as `.private/updater/scripts/update-train-timetable.py`, `scripts/generate-train-timetable.mjs` alongside it, and `app/data/*-rail-routes.json` under `.private/updater/app/data/`. DreamHost requires Python 3 with `zoneinfo`, Node 18+, and `unzip`. Run the updater once, then schedule it hourly (server time):

```sh
15 * * * * /usr/bin/python3 /home/depr001/danielpradilla.info/swiss-commutes/trains/.private/updater/scripts/update-train-timetable.py --root /home/depr001/danielpradilla.info/swiss-commutes/trains >> /home/depr001/danielpradilla.info/swiss-commutes/trains/.private/timetable-update.log 2>&1
```

Run `npm run test:trains`, `npm run lint` and `npm run build`. Deploy `out/trains/` without deleting `.private/` or its credentials, caches, and generated timetables. Verify the active version, the feed's current timestamp, and a nonempty train list after activation.
