# Trains and public transport

The transit pages animate geOps trajectories around the project's sixteen cities. `/trains/` shows trains only; `/public-transport/` shows trains, trams and buses. Both families have a Zürich default root and sixteen `/trains/<city>/` or `/public-transport/<city>/` pages, under `/projects/swiss-commutes`. Selecting a vehicle loads its complete supplied journey geometry and ordered stops, including sections outside the city's regional feed. The commute model and offline timetable imports are unchanged; the train view reuses the model's existing ARE rail cache for static track context.

The background-click selection update was committed, pushed and deployed on 14 October 2026. Both transit views passed production click and mobile-tap checks. See [selection deployment verification](outputs/deployments/20261014T210434Z/manifest.json). The earlier [mapped-network and wheel-zoom deployment](outputs/deployments/20261014T192659Z/manifest.json), mixed-dashboard cutover and rail/public-transport split have separate historical records below.

## Source and position estimates

The server uses the [geOps Realtime REST API](https://developer.geops.io/apis/realtime/) at `https://api.geops.io/tracker-http/v1/`:

| Request | Purpose |
| --- | --- |
| `trajectories/sbb/?bbox=<minX,minY,maxX,maxY>&gen_level=100` | Timed trajectories in a city's fixed bounding box |
| `journeys/<vehicleId>/` | Complete supplied trip geometry |
| `calls/<vehicleId>/` | Ordered trip stops and scheduled/reported times |

All coordinates use EPSG:3857 Web Mercator, including the GeoJSON geometry. Trajectory `time_intervals` carry timestamps in milliseconds, progress fractions and optional rotation values. The browser interpolates the fraction between timed points, then places the marker at that fraction of the path's cumulative distance. It converts that position to latitude/longitude for Leaflet. Before or after the supplied time window, it holds the first or last path position until another update arrives.

Positions derive from timetables and available realtime updates; they are not guaranteed measured GPS locations. `has_realtime_journey` distinguishes updated journeys from scheduled-only services. Reported vehicle delay is converted from milliseconds to minutes. Coverage varies by operator and service, so a missing marker does not prove that no vehicle is running.

The shared feed includes `rail`, `tram`, `subway` and `bus`. `/trains/` accepts only rail vehicles for its markers, visible train count and list, with no three-mode filters. `/public-transport/` labels rail as trains and groups subway with trams; ferries and other modes are omitted. Selected trips show the complete geometry and stop sequence returned by geOps; missing geometry, stop coordinates or times remain unavailable instead of being invented.

The city feed supplies timed segments for marker movement. Complete trip details need separate `journeys` and `calls` requests, so the detail panel can take time to load on first selection. Only the selected vehicle requests those details; no background journey requests are made for the other markers. Delay values come from the source, and missing realtime delay remains unavailable.

Public implementations and API references:

- [geOps Realtime API documentation](https://developer.geops.io/apis/realtime/), including REST and WebSocket contracts.
- [Trafimage Maps source](https://github.com/geops/trafimage-maps), the SBB map portal component.
- [mobility-toolbox-js source](https://github.com/geops/mobility-toolbox-js) and its [tracker example](https://mobility-toolbox-js.geops.io/example/ol-tracker).

geOps recommends WebSocket access wherever possible in production. This dashboard deliberately uses shared PHP REST polling so the browser receives no geOps key. Check the key's plan, request quota and data licence before publishing this implementation.

## City coverage and controls

`app/trains/cities.json/route.ts` exports `trains/cities.json` from the sixteen city centres in `app/cities.ts`. PHP projects the selected centre into Web Mercator and requests a fixed box extending 80,000 projected metres in each direction, roughly 55 km on the ground at Swiss latitudes. This is regional coverage, not a city-station membership filter or a nationwide feed. Panning does not change the upstream bounding box; the UI warns when the map extends outside it.

On `/public-transport/`, trains, trams and buses start enabled. Mode buttons control markers, the visible list and the grey mapped network. Train markers stay larger than tram markers, which stay larger than bus markers at every zoom. Hover and selection change the outline without increasing marker radius, so a selected bus remains smaller than a train.

In both views, the list and visible vehicle count follow the current map bounds. Search matches line, train number or mode, ignoring case and accents; it filters the list and dims nonmatching markers. Hovering or focusing a list item highlights its marker. Clicking a marker or list item selects the trip; clicking another marker switches to it. With a trip selected, clicking the selected route or its stops keeps the selection, and clicking elsewhere on the map clears it, as "Back to list" does. Hovering a selected trip's stop shows its name. Zooming in reveals line labels; "Show whole route" fits the supplied journey, and clicking a stop in the list centres the map if its coordinates are available. Base-map station labels are not clickable.

Wheel zoom is enabled by default in both views and zooms under the pointer. Wheel events outside the map scroll the page normally. The zoom buttons, dragging and touch controls remain available; map zoom stays within 7 to 17.

The browser fetches immediately, then polls 15 seconds after each request completes, for both the city feed and the selected trip. Markers animate at approximately 30 frames per second; reduced-motion preferences limit position updates to once a second. City and trip updates older than 30 seconds are labelled stale. Failed requests retain the previous data and display an error. Stop times use `Europe/Zurich`.

## Track and route context

`app/trains/[city]/tracks.json/route.ts` exports `/trains/<city>/tracks.json` with `{ source, networkYear, segments }` from the existing `app/data/<city>-rail-routes.json` cache. These ARE NPVM 2023 paths are the partial network used by the project's city routes, not the complete Swiss rail network. In `/trains/`, the grey static context stays visible when a train is selected; the selected full geOps trip is drawn in dark colour above it.

In `/public-transport/`, the grey "Mapped route network" shows continuous mapped transport geometry from [geOps Maps](https://developer.geops.io/apis/maps/) / OpenStreetMap, independent of active vehicles and their animation segments. Enabled modes match the tile's route flags: `train_route` for trains; `tram_route`, `light_rail_route` and `subway_route` for trams; `bus_route` and `trolleybus_route` for buses. Each disconnected geometry part is drawn separately, without bridging gaps. This is the mapped network within regional tile coverage, not every operator's complete line variants or a guarantee of the route used during a diversion. A selected vehicle's actual supplied journey still comes from the Realtime API.

Selecting a vehicle removes the mapped background immediately, before trip details arrive; only the selected complete supplied trip is drawn dark. "Back to list" restores the network for the enabled modes. Network loading and failures are independent of vehicle updates: an unavailable network displays a hint, preserves vehicle positions and does not fall back to animation segments.

`app/trains/train-dashboard.tsx` shares both views. Context paths are in a non-interactive pane below one interactive canvas pane that holds the selected trip and vehicles, so vehicles are drawn above the trip without masking clicks on it. The pure helpers `parseTrackContext` and `vehicleRadius` in `app/trains/train-data.ts` reuse the existing polyline decoder and keep the marker-size ordering consistent with the legend. `networkModes` reads the mapped route flags. In `app/trains/network-layer.ts`, `decodeNetwork` validates and decodes vector geometry and `drawNetwork` draws only enabled modes; `transportation_name` is used only if `transportation` is absent, avoiding duplicate label paths. `createNetworkLayer` owns the native Leaflet `GridLayer` lifecycle, retains up to 96 decoded tiles, redraws loaded geometry on mode changes and aborts requests on tile unload or layer removal. Removal also detaches the zoom handler. Native tiles stop at zoom 14 and scale up to map zoom 17, with stroke compensation keeping lines at 1.5 CSS pixels.

The default `SiteNavigation` export in `app/components/site-navigation.tsx` uses one section list for all page families. Desktop, mobile and footer menus share the same links and mark the active section with `aria-current="page"`.

## Public feed contract

Both page families make same-origin GETs to the existing `trains/feed.php` endpoint and share `trains/cities.json`. There is no duplicate city/detail feed or public credential. The city and detail contracts are unchanged:

- `?city=zurich` returns `city`, `fetchedAt`, `coverage` and `features`. `coverage` is `[minX, minY, maxX, maxY]` in EPSG:3857; `features` contains the accepted upstream trajectory features.
- `?city=zurich&vehicle=sbb_<digits>` returns `vehicleId`, `fetchedAt`, `route` and `calls`. `route` is the upstream journey FeatureCollection and `calls` is the ordered journey-call array. The vehicle must be present in that city's current cached feed.

`fetchedAt` is the UTC timestamp of a successful upstream fetch. It does not change when stale data is served. Unknown query parameters, malformed city values or invalid vehicle IDs return 400. Unknown cities and vehicles absent from the city feed return 404. Non-GET requests return 405. Responses use `Cache-Control: no-store`; the PHP cache, not browser caching, shares upstream requests.

The public view also requests `trains/network.php?city=zurich&z=12&x=<tileX>&y=<tileY>`. This is one tile proxy alongside the three existing PHP feeds, not a fourth feed. It accepts GET only, known cities and exactly `city`, `z`, `x`, `y`; zoom must be 7 to 14 and integer tile coordinates must be between 0 and `2^z - 1`. Malformed requests return 400, unknown cities return 404 and other methods return 405. A tile outside the selected city's fixed bounding box returns 204 without an upstream request. Successful tiles return `application/x-protobuf` with `Cache-Control: public, max-age=86400`; errors use `no-store`, and unavailable tiles return 503 with `Retry-After: 15`. Production also appends `max-age=5`; this existing override was preserved, so a 24-hour browser cache lifetime is not established. The private tile cache retains its 24-hour lifetime.

The server requests `https://maps.geops.io/data/openmaptiles_v2/{z}/{x}/{y}.pbf` using the existing private `GEOPS_API_KEY`. `public/trains/network.php` reuses the feed helpers and private-directory configuration; the browser never receives the key or contacts geOps directly.

## Credentials and PHP runtime

`public/trains/feed.php` requires PHP 8 with cURL. It reads `GEOPS_API_KEY` from the PHP process environment, or from `credentials.env` in `SWISS_TRAINS_PRIVATE_DIR`. Without that directory setting, it uses `trains/.private/` beside the deployed endpoint. The credentials file contains a `GEOPS_API_KEY=<key>` entry. The tracked `.private/.htaccess` contains `Require all denied`; retain it when using the default directory. A private directory outside the web root may also be used.

Keep the key out of public JavaScript, exported pages, response bodies and logs. Preserve `ASTRA_API_KEY` and any other existing credentials when adding the geOps entry; never replace an unrelated credentials file wholesale.

`.env.local` is private local Node configuration and must never be deployed. `next dev` does not execute PHP. Adding `GEOPS_API_KEY` to `.env.local` alone does not make the live feed work: a PHP-serving environment must receive `GEOPS_API_KEY` itself or have the private credentials file, and must serve the endpoint with `trains/cities.json` at the expected path.

For local PHP, prefer an environment variable or a private directory outside `public/`. Apache `.htaccess` rules do not protect files served by `next dev`; do not put local credentials under `public/`.

## Shared request-driven cache

PHP keeps cache files under `<private>/geops/`, with a separate file and exclusive lock for each city feed and city/vehicle detail pair. A valid cache is reused for 15 seconds. On expiry, the next request fetches and validates replacement data, then atomically replaces the cache. A detail refresh makes two upstream requests, one for geometry and one for calls. Details requests first check the city feed and may refresh it if expired.

Each upstream response is capped at 16 MiB. Requests have a five-second connection timeout and a twelve-second total timeout. Failed fetches or invalid responses leave the previous valid cache intact and create a 15-second retry marker. Requests during that interval serve the same stale data with its original `fetchedAt`; with no valid prior cache, the endpoint returns 503 with `Retry-After: 15`. Locks prevent simultaneous visitors from refreshing the same cache independently.

Mapped tiles use `<private>/network/<z>/<x>/<y>.pbf`, shared across cities and visitors for the same tile coordinates. The server reuses each valid tile for 24 hours (86,400 seconds), with directories created as `0700` and tile files as `0600`. Exclusive per-tile locks and atomic replacement protect concurrent refreshes. The proxy checks upstream status, MIME type, key echoes and top-level protobuf framing before storing a tile; browser decoding validates inner geometry. The same 16 MiB limit, timeouts and 15-second retry protection apply. A failed refresh retains the last valid tile; without one, the proxy returns 503. This day-cached mapped source is not realtime route or diversion data.

Neither transit view needs a collector cron, server-side background polling, timetable download or timetable import. The split and the local mapped-network update add no key or cron changes. Idle cities make no requests. At the 15-second cache interval, allow at most four Realtime city calls per minute per active city, plus up to eight detail calls per minute per unique active selected vehicle in that city (two upstream calls per refresh). Visitors sharing the same city and trip share the cache; the same vehicle selected under different city feeds has separate detail caches. These figures cover Realtime REST polling only. Panning and zooming the public map can request additional Maps tiles, with upstream requests on cache misses or expiry; loaded tiles redraw for mode changes without another upstream fetch. Maps tile quota and publication licence remain unverified. Check both APIs' combined expected load before publication.

## Checks and production cutover

The transit checks are `npm run test:trains`; the full application checks are `npm test` and `npm run build`. Before deployment, local verification of the mapped-network/wheel update passed all 63 application tests, the transit PHP checks including `test/network-feed.php` and all 17 train-data JavaScript tests, targeted lint with zero errors, and the production build with 120 static routes. `scripts/check-export.mjs` checks each city's track export against its source cache, validates decoded coordinates and checks both page families and shared navigation. The repository-wide `npm run lint` remains failing with twelve errors in archived JavaScript under `outputs/deployments/20260927-cleanup/`; it must not be described as clean.

For the background-click selection update, all 63 application tests, both transit PHP checks and 17 train-data tests passed. Production checks in Geneva preserved selection on route and stop clicks, switched IR95 to another train and bus 1 to bus 52 on marker clicks, and cleared both views on background clicks. Public transport restored its 20 network tiles with trams still disabled. Native touchscreen taps also cleared both views in a 390-pixel Chromium touch viewport without horizontal overflow. Credentials, access rules and cron fingerprints were unchanged; private credentials, tile cache and rollback archives returned HTTP 403 to HEAD requests. The checks used mobile emulation, not a physical phone.

Local browser checks used the existing PHP-serving dev environment with the private key: a zoom-12 tile returned HTTP 200 as gzipped protobuf. Mode filtering changed the mapped network; selecting bus 1 removed it immediately and drew the complete supplied trip dark, and Back restored the filtered network. At zoom 17 the scaled tiles retained 1.5 CSS-pixel strokes. Wheel zoom moved both views from 12 to 13 without page scrolling; a wheel event outside the map scrolled the page without changing map zoom. A selected IR90 showed 13 stops. At 390 pixels wide there was no horizontal overflow and all eight mobile navigation links were above the map. An injected tile 503 retained 190 vehicles, showed the network error hint and drew no segment fallback; normal reload recovered. Observed requests included one selected-trip request, no background journey requests and no direct browser geOps traffic. These checks do not establish a first-selection latency guarantee.

Production verification of the mapped-network/wheel update covered Geneva's two views and the Zürich public-transport root. The Geneva train list contained nine rail-only vehicles with track context. Public transport showed 179 vehicles; disabling buses reduced painted network pixels from 109,392 to 16,067. Selecting bus 1 left zero network tiles and a dark supplied route with 31 stops; Back restored the network. Both maps zoomed from 12 to 13 under the pointer without page scrolling, while an outside wheel event scrolled the page without changing map zoom. At zoom 17, all ten retained network canvases had 1.5 CSS-pixel strokes. At 390 pixels wide, all eight navigation links were clickable above the map with no horizontal overflow. A tile returned HTTP 200 with 178,643 protobuf bytes; a repeated request left its private timestamp and size unchanged, and an outside-coverage tile returned 204. Private credentials, tile caches and rollback archives returned HTTP 403 to HEAD requests. No direct geOps API requests came from the browser. Credentials, access rules and cron were unchanged.

Historical production checks for the [14 October split](outputs/deployments/20261014T164801Z/manifest.json) confirmed its current-leg background disappearing on selection and returning on deselection, train-only counts, an IR15 trip with 13 stops, a bus 1 trip with 34 stops, and the mobile menu above the map. Both root pages defaulted to Zürich; private paths returned HTTP 403 to HEAD requests.

For future deployments:

1. Confirm both geOps Realtime and Maps access, plan quotas and licences permit the expected polling, tile requests and publication.
2. Preserve the existing server-private `GEOPS_API_KEY`, ASTRA and other keys. Retain private-directory access protection and verify it denies web access, including network caches. The update requires no new credentials.
3. Publish both checked page families, `/trains/<city>/tracks.json`, `trains/feed.php`, `trains/network.php` and `trains/cities.json`. Never publish `.env.local`, local credentials or cache contents. Preserve server-private credentials and caches when syncing; deploy `_next/` before HTML, without `--delete`.
4. Keep the existing traffic collector entry. The former train collector and hourly train timetable updater entries were removed during the original geOps cutover; the split requires no cron changes.
5. Request a city feed and a vehicle from that feed, confirm recent timestamps and complete supplied route/stops, and check that repeat requests within 15 seconds reuse the shared cache. Check rail-only counts and partial ARE tracks in `/trains/`. Verify a valid network tile, its 24-hour cache reuse and an out-of-coverage tile's 204 response; check mapped coverage, all mode filters, immediate network removal on selection and filtered restoration with Back in `/public-transport/`. Confirm tile failures preserve vehicles and display the network hint without segment fallback. Check wheel zoom under the pointer, page scrolling outside the map, zoom-17 strokes and mobile navigation.

The export sanitizer still removes old local `trains/timetable/` files intentionally, so leftover historical data cannot enter a static export. Those files are not a runtime requirement. The original mixed geOps dashboard was deployed on 14 October 2026. Production smoke verified Geneva and Zürich, vehicle motion, a selected bus route with 31 stops, mobile layout and HTTP 403 for private credentials and backups. Existing credentials and unrelated cron entries were preserved; the two obsolete train jobs were removed. See [original cutover verification](outputs/deployments/20261014T154455Z/manifest.json). The split and mapped-network/wheel update have separate manifests linked above. The geOps quota and licence were not independently verified.
