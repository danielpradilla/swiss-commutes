# Trains (spec, not yet built)

A proposed live view of trains, at `/swiss-commutes/trains/`, with the same sixteen city routes as the other views under `/trains/<city>/`. For each city it would list trains currently serving that city's stations: train number, current delay, next station, and estimated departure/arrival there. This document describes the source data, what it can and cannot support, and the operational pattern before any code is written. It follows the same city set, station register and PHP-on-cron pattern as [`LIVE.md`](../LIVE.md).

## Concept

- Scope trains to the stations already matched to each city in `app/data/<city>-rail-routes.json` (DiDok-numbered `stations` map, sourced from the [DiDok register](https://data.sbb.ch/explore/dataset/dienststellen-gemass-opentransportdataswiss/)). A train is in scope for a city if its stop sequence includes one of that city's stations.
- Per train, show: train number (not the line name — see below), the next station it has not yet departed, and the estimated departure or arrival there (scheduled time adjusted by the reported delay).
- Unlike the traffic view, there is no 30-minute history to replay. The source is a live schedule-plus-delay feed, so this would show current state only, refreshed on an interval, not a replay loop.

## Source and units

- [GTFS-RT Trip Updates](https://opentransportdata.swiss/en/cookbook/realtime-prediction-cookbook/gtfs-rt/), endpoint `https://api.opentransportdata.swiss/la/gtfs-rt`, Bearer token via API Manager (same auth shape as the traffic feed, separate subscription/application).
- One request returns trip updates for all of Switzerland; there is no per-station or per-city query. Rate limit is 2 requests/minute, sliding window, so polling more often than every 30 seconds is not possible regardless of how many cities are shown.
- The feed reports **delay in minutes** (0.1-minute resolution) per stop, not an absolute predicted time and not a position. Estimated departure/arrival = the static schedule's time for that stop plus the reported delay. A stop with no update in the feed has no reported delay; whether to show the scheduled time unmarked or omit the train needs a decision (see below).
- The feed is GTFS-RT "Trip Update" v1.0 only. **There is no vehicle-position (GPS) feed on this platform** — only Trip Update. A map view cannot show an observed location; any dot placed on the map would be a scheduling estimate (last known stop, next stop, elapsed fraction of scheduled running time), not a measured position. This should be labelled as such if built, the same way the traffic view labels modelled routes as not being live GPS.
- Train identity: `tripId` / `originalTripId` in the RT feed matches `trip_id` in the static GTFS. The static `trips.txt`'s `trip_short_name` field is confirmed by the source documentation to hold the train number for trains (distinct from `route_short_name`, which holds the line name, e.g. IC1, IR15, S3).
- Coverage is self-reported as "all transport companies providing real-time data" — not a documented guarantee of completeness. Smaller operators or specific services may not publish updates; those trains would show only the static schedule with no live delay.

## Static timetable (needed to interpret the RT feed)

The RT feed only carries stop IDs, sequence numbers and delays — it does not carry train numbers, stop names or the full stop sequence. Those come from the [static Swiss GTFS timetable](https://opentransportdata.swiss/en/cookbook/timetable-cookbook/gtfs/) (`trips.txt`, `stop_times.txt`, `stops.txt`), which:

- Regenerates twice weekly (new HRDF Tuesdays/Fridays, GTFS built 1–2 working days later) and is republished as a dated dataset per timetable year (e.g. `timetable-2026-gtfs2020`).
- Uses `stop_id`s that incorporate the same DiDok numbers already used in `app/data/*-rail-routes.json` (e.g. `8503000` for Zürich HB), so city-station matching reuses the existing station register without a new geocoding step.
- Is a nationwide file covering every mode and operator, not just the sixteen project cities. Importing it needs an offline filter step, the same shape as the existing `scripts/generate-rail-routes.mjs`: download once, keep only trips whose stop sequence touches a project-city station, and write a compact per-city file (trip ID → train number, ordered stop list with scheduled times) into `app/data/`.
- Needs a refresh when the timetable changes (mid-December each year, per existing rail-network refresh cadence), not on every cron tick. A stale static file would misalign the RT feed's stop sequence against the wrong trip.

## Draft data model

Sketch only, not final:

```
{
  "fetchedAt": "...",
  "trains": [
    {
      "tripId": "...",
      "trainNumber": "515",
      "line": "IC1",
      "lastStation": { "id": "8503000", "name": "Zürich HB", "departedAt": "..." },
      "nextStation": { "id": "8500010", "name": "Baden", "scheduledAt": "...", "delayMinutes": 3 },
      "cancelled": false
    }
  ]
}
```

## Operation (proposed, mirrors `public/live/feed.php`)

- `public/trains/feed.php`, PHP 8.2+, cURL only (no protobuf library exists in this repo, and there is no `composer.json`). DreamHost cron polls on an interval within the 2 requests/minute cap.
- **Open decision:** GTFS-RT is protobuf by default; the source also offers `?format=JSON`, documented as "for testing purposes" only. Parsing protobuf in PHP needs a dependency this repo doesn't currently have (no Composer setup); using the JSON parameter avoids that but relies on an endpoint the source doesn't commit to for production use. This is a real trade-off to decide before building, not a default to assume.
- Credentials follow the existing pattern: `ASTRA_API_KEY`-style env var in `public/trains/.private/credentials.env`, `.htaccess`-denied, read the same way `feed.php` reads `ASTRA_API_KEY`.
- No 30-minute replay buffer is needed the way traffic has one — GTFS-RT is a current-state feed, not a per-minute counter history. A simple "latest fetch" cache, refreshed roughly every 30–60 seconds, covers the concept above. If a played-back history of delays is wanted later, that's an addition, not a default.

## Open decisions (need an answer before building)

1. JSON (`?format=JSON`, undocumented-for-production) vs. adding a protobuf dependency.
2. What to show for a train with no RT update on its next stop: scheduled time unmarked, or omit until a delay is reported.
3. Whether to draw a map at all, given there is no GPS position — the concept above is a station-board list (train number, next station, delay) per city; a map would need to fabricate position from elapsed scheduled time, which is a modelled position, not an observed one, and should be labelled that way if built.
4. A second (or reused) opentransportdata.swiss API Manager subscription needs to be requested for GTFS-RT before any of this can be tested against real data.

## Checks and deployment (planned, mirrors `LIVE.md`)

Not applicable until built. Once implemented, follow the same verification shape as the traffic view: an export check that trains pages carry no modelled commuter data, a live-feed test script, and deploy `.private/` preserved across releases.
