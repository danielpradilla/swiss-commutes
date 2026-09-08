# Presentation update — 9 September 2026

The map now starts animating at 07:45 after its first draw. Reduced-motion preferences start paused; a pause requested while loading is preserved. The Now button selects the current Swiss time.

On mobile, the timeline follows the map and precedes the statistics. Map and playback controls fit at 390×844, 375×667 and 320×568, including La Chaux-de-Fonds and long transport-filter labels. Shorter viewports can scroll while retaining a map at least 240 pixels tall.

The basemap uses [Stadia Alidade Smooth](https://docs.stadiamaps.com/map-styles/alidade-smooth/). Moving-dot radii are 0.9–1.5 pixels, depending on weight and mode. Direction colours, commuter weights and the population model are unchanged. All 16 exported route files match their previous SHA-256 hashes. Geneva at 07:45 still reports 33,284 travelling, −5,313 relative to the daily average and a peak of +77,404.

Validation: 40 tests pass; ESLint, TypeScript and the static export checks pass. `check-browser.mjs` tests loading, playback, current time, keyboard scrubbing, city changes, reduced motion and responsive layouts. Results are in `browser-results.json`; screenshots show the finished map tiles.

To repeat the browser check, serve the static export under `/swiss-commutes/` on port 8873, then call the installed Playwright `browser_run_code_unsafe` tool with this directory’s `check-browser.mjs` as its `filename`. The function accepts an optional base URL for another deployment.

Published to `www.danielpradilla.info/swiss-commutes/`. All 128 remote file hashes match the build; all 33 public page and route checks pass. A fresh live browser confirmed autoplay, unchanged Geneva counts, visible mobile controls and nine successful Alidade Smooth tile responses, with no page errors.

Deployment receipt and rollback archive: `outputs/deployments/20260908T224631Z/`.
