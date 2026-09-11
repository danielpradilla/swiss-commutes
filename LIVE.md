# Live traffic

The live variation is at `/swiss-commutes/live/`, with the same sixteen city routes under `/live/<city>/`. It replays available road counts from the last 30 completed minutes, displaying each recorded minute for two seconds. Minutes without a complete detector count in the current map view are skipped, including at the start of a replay. The clock keeps the actual observation time, and measured zeros remain visible. It has a pause button and no scrubber, commuter model, route interpolation or population calculations.

## Source and units

- API Manager subscription: **Road traffic - traffic counters**, application **Swiss Commutes Live**.
- [ASTRA / FEDRO DATEX II documentation](https://opentransportdata.swiss/en/cookbook/road-traffic-cookbook/rt-road-traffic-counters/).
- Each detector reports a measurement interval. This view accepts 60-second intervals only.
- The source expresses flow in vehicles/hour. Dividing by 60 restores the measured one-minute count. Non-integer results are excluded rather than rounded into observations.
- Indices 11/12 describe light-vehicle counts/speeds; 21/22 describe heavy goods vehicles. Indices 1/2 are error categories, not totals. Missing values remain missing, and measured zero remains zero.
- No averaging or summing across detectors: the same vehicle may cross several sensors. Values cover all trip purposes and count vehicles, not occupants.
- Map colours use the busiest detector at each station: green 0–9, yellow 10–19, orange 20–29 and red 30+ measured vehicles/minute. Light and heavy counts must both be present; otherwise that detector has no total. Grey means no complete count for the displayed minute. The scale describes volume, not congestion or road capacity.
- Test/forecast data, source error flags, unmatched metadata versions and unusable readings are excluded from counts. Replay readings must match the displayed minute exactly. Missing minutes remain gaps in storage and are skipped during playback, never filled with nearby readings. The browser pauses playback and requests in hidden tabs and reloads the window on return.
- Public transport forecasts and interpolated vehicle positions are not included. Counter coverage varies by city and does not cover every street or foreign approach.

Station coordinates come from the counter API. Optional station names and road labels come from the [official ASTRA map directory](https://services3.arcgis.com/IXAVBLfeIsfhE7s9/arcgis/rest/services/SVZ_2022/FeatureServer/1), retrieved 10 September 2026. Names are matched by federal counter ID and checked against the live metadata coordinates. Other stations retain their source IDs. No historical volumes are imported from the directory.

## Operation

`public/live/feed.php` uses PHP 8.2+, cURL and SimpleXML, already available on DreamHost. DreamHost cron runs `/usr/bin/php /home/depr001/danielpradilla.info/swiss-commutes/live/feed.php` every minute, independently of page visits. The script waits until at least 25 seconds past the minute, after the source's publication at about 20 seconds. The cron entry must not add a separate sleep.

Cache reuse and collection success depend on the observation minute. A recently fetched duplicate does not count as a new collection. Failed, empty, delayed or duplicate responses retry once after five seconds; each upstream request times out after ten seconds. The next publication cycle can try again even if the previous failure was less than a minute ago. Requests share a lock. Station metadata refreshes daily or when the source version changes.

The private `collection.log` keeps the last 200 attempts: expected and received minutes, publication time, elapsed seconds, outcome and error. It contains no counts or credentials. Recorded source errors distinguish offline detectors, sensor errors and missing source readings from minutes we did not collect. Existing history without error flags cannot identify the original cause.

Each collection or replay request deletes saved readings older than 60 minutes, using their observation time. Repeated readings are stored once per detector and timestamp in private `history-<timestamp>.json` files. Expired readings are also removed from the current feed cache. If collection stops, cleanup runs on the next request. Missing or delayed source readings remain gaps.

`public/live/replay.php` reads saved measurements without querying ASTRA. It returns station metadata once and all 30 minute frames, including gaps and source errors. The browser skips frames without complete counts in the current view. After the last available frame, it holds that frame until the next refresh, at least a minute after the previous response. An entirely empty window shows a message and retries after a minute. Markers are updated in place. Collection delays are labelled; a failed replay request stops playback and retries after a minute. The source cannot backfill missing minutes.

The server key is `ASTRA_API_KEY` in `live/.private/credentials.env`. The `.private` directory denies HTTP access through `.htaccess`. It holds the key and caches and must be preserved during deployment. The key never enters a client bundle or public JSON. Local development reads `.env.local`, or an environment variable; `SWISS_LIVE_PRIVATE_DIR` can move local caches outside the export directory.

API access is initially limited to six months and 260,000 requests. Continuous collection uses about 1,440 measurement requests per day, plus metadata requests. Continued use requires an extension from ASTRA under its published access conditions.

## Checks and deployment

Run `npm run test:live`, `npm run lint` and `npm run build`. The export check verifies that live pages contain no model data or scrubber and that the private-directory access rule is included.

Deploy `out/_next/` first, then `out/live/` to `danielpradilla.info/swiss-commutes/live/`, preserving `.private/` contents. Keep exactly one collector entry in the existing server crontab and preserve unrelated jobs. Verify private files return HTTP 403, collection advances without visits, and replay refreshes after a complete loop. Test pause/resume, missing minutes, expired readings and an API outage. Saved measurements must remain labelled with their recorded time.
