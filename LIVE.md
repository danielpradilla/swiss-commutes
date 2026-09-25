# Live traffic

The live variation is at `/swiss-commutes/live/`, with the same sixteen city routes under `/live/<city>/`. It shows the newest measured minute available from Swiss road counters, refreshed every minute. Detectors that report no usable count for that minute stay grey, and the measured zeros remain visible. The clock names the minute the readings describe. There is no playback, scrubber, commuter model, route interpolation or population calculation.

## Source and units

- API Manager subscription: **Road traffic - traffic counters**, application **Swiss Commutes Live**.
- [ASTRA / FEDRO DATEX II documentation](https://opentransportdata.swiss/en/cookbook/road-traffic-cookbook/rt-road-traffic-counters/).
- Each detector reports a measurement interval. This view accepts 60-second intervals only.
- The source expresses flow in vehicles/hour. Dividing by 60 restores the measured one-minute count. Non-integer results are excluded rather than rounded into observations.
- Indices 11/12 describe light-vehicle counts/speeds; 21/22 describe heavy goods vehicles. Indices 1/2 are error categories, not totals. Missing values remain missing, and measured zero remains zero.
- No averaging or summing across detectors: the same vehicle may cross several sensors. Values cover all trip purposes and count vehicles, not occupants.
- Map colours use the busiest detector at each station: green 0–9, yellow 10–19, orange 20–29 and red 30+ measured vehicles/minute. Light and heavy counts must both be present; otherwise that detector has no total. Grey means no complete count for the displayed minute. The scale describes volume, not congestion or road capacity.
- Markers dim once per vehicle counted in the displayed minute, using the same busiest-detector total as the colour: five vehicles a minute is five dims a minute, each taking about a fifth of the blink period and fading back to full opacity between them. The rate follows the recorded minute, not individual vehicles, so the dimming shows the minute's average rate. Blinking stops at 120 a minute (two per second, below the three general flashes per second WCAG 2.3.1 allows) and the marker stays lit above it. Measured zeros, minutes without a complete count and `prefers-reduced-motion: reduce` leave markers steady. Opacity is applied to the existing canvas markers in place, so no extra layers or requests are added.
- Test/forecast data, source error flags, unmatched metadata versions and unusable readings are excluded from counts. A reading is shown only for the measured minute it reports. The browser polls once a minute, pauses requests in hidden tabs and reloads the window on return.
- Public transport forecasts and interpolated vehicle positions are not included. Counter coverage varies by city and does not cover every street or foreign approach.

Station coordinates come from the counter API. Optional station names and road labels come from the [official ASTRA map directory](https://services3.arcgis.com/IXAVBLfeIsfhE7s9/arcgis/rest/services/SVZ_2022/FeatureServer/1), retrieved 10 September 2026. Names are matched by federal counter ID and checked against the live metadata coordinates. Other stations retain their source IDs. No historical volumes are imported from the directory.

## Operation

`public/live/feed.php` uses PHP 8.2+, cURL and SimpleXML, already available on DreamHost. DreamHost cron runs `/usr/bin/php /home/depr001/danielpradilla.info/swiss-commutes/live/feed.php` every minute, with `SWISS_LIVE_PRIVATE_DIR` set inline, independently of page visits. The script waits until at least 25 seconds past the minute, after the source's publication at about 20 seconds. The cron entry must not add a separate sleep.

Cache reuse and collection success depend on the observation minute. A recently fetched duplicate does not count as a new collection. Failed, empty, delayed or duplicate responses retry once after five seconds; each upstream request times out after ten seconds. The next publication cycle can try again even if the previous failure was less than a minute ago. Requests share a lock. Station metadata refreshes daily or when the source version changes.

The private `collection.log` keeps the last 200 attempts: expected and received minutes, publication time, elapsed seconds, outcome and error. It contains no counts or credentials. Recorded source errors distinguish offline detectors, sensor errors and missing source readings from minutes we did not collect. Existing history without error flags cannot identify the original cause.

The source publishes one minute at a time and cannot backfill. The cache holds the last publication we collected readings from; a read never expires or rewrites it, and a collection that fails, repeats the stored minute or arrives without usable readings never replaces it. The map therefore keeps showing the last minute it has data for, with the clock naming that minute, and recovers on its own when the next publication arrives. Missing or delayed source readings are never replaced with nearby ones.

`public/live/feed.php` serves the stored minute as JSON. A request collects first when the cache is older than the expected minute, so the first visit after a pause still triggers collection; otherwise it returns the cache without touching ASTRA. When collection fails, the endpoint still returns the stored minute with HTTP 200 and only reports unavailability (HTTP 503) when nothing has ever been collected. The browser fetches it every minute, validates the payload, keeps the last received minute if a refresh fails, and labels a collection that is more than four minutes behind the clock.

The server key is `ASTRA_API_KEY` in `credentials.env` inside the private state directory, `/home/depr001/.swiss-commutes/live` on DreamHost. Both entry points must name that directory through `SWISS_LIVE_PRIVATE_DIR`: `live/.htaccess` sets it for web requests and the collector cron entry sets it for CLI. It also holds the cached feed, station metadata and the collection log, so publishing `out/live/` cannot delete the key or the collected minute. `live/.private/.htaccess` keeps the same deny rule for the in-directory fallback used when the variable is absent. The key never enters a client bundle or public JSON. Local development reads `.env.local`, or an environment variable.

API access is initially limited to six months and 260,000 requests. Continuous collection uses about 1,440 measurement requests per day, plus metadata requests. Continued use requires an extension from ASTRA under its published access conditions.

## Checks and deployment

Run `npm run test:live`, `npm run lint` and `npm run build`. The export check verifies that live pages contain no model data or scrubber and that the private-directory access rule and the private-state location are both shipped.

Deploy `out/_next/` first, then `out/live/` to `danielpradilla.info/swiss-commutes/live/`. The key and stored minute sit outside that path, so replacing it keeps collection working. Keep exactly one collector entry in the existing server crontab with its `SWISS_LIVE_PRIVATE_DIR` assignment, and preserve unrelated jobs. Verify `live/feed.php` returns 200 with stations, private files return HTTP 403, collection advances without visits, every city page shows the stored minute, and hidden-tab polling resumes on return. Test that a failed collection still serves the stored minute, that a publication without usable readings never replaces it, and how the page reads without any stored minute at all. Saved measurements must remain labelled with their recorded time.
