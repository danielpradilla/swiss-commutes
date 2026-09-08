Publication review, 9 September 2026

Verdict: the current static build is ready for publication as an illustrative commuting map. No remaining release blockers were found in this review. Deployment followed the review, as recorded below.

One small issue was corrected: the map credits displayed provider names without hyperlinks. The Stadia Maps, OpenMapTiles, OpenStreetMap and applicable Stamen links are now present in the shared layer configuration. The browser check confirmed the rendered links. This follows the provider’s [attribution guidance](https://docs.stadiamaps.com/attribution/).

Fresh checks passed:

- 40 tests and all 748 data checks across 16 cities and 24,673 corridors. Source checks used the preserved statistical snapshots.
- ESLint, TypeScript, production export and exported metadata/geometry version checks.
- npm security audit: zero reported vulnerabilities on the installed dependency tree.
- All 16 city maps, the home page, city switching, browser back/forward, empty mode selection and 24:00 scrubbing.
- Current-time mode, fast-forward, pause and reduced-motion startup.
- Mobile layout at 390 × 844, an HTTP 503 route failure and successful retry with the selected time, modes and counts preserved.
- The final Geneva page had no console errors or warnings. The browser tests used Chromium desktop and mobile viewport emulation; this was not a Safari or physical-device test.
- A targeted export scan found no missing local HTML asset links, local user-directory paths or matches for the checked private-key/API-token patterns. This was not a comprehensive secret or penetration audit.

The existing public domain returned HTTP 200 and loaded 15 observed Stadia tile requests successfully. This verifies that production-domain tile access currently works; it does not verify deployment of the new build.

Publish the complete `out/` directory, including `_next/` and every city’s `routes.json`, under `/swiss-commutes/`. Update the release coherently and refresh cached pages so HTML and geometry versions agree. Then verify the live root, Geneva and another city. Required source and cache files remain untracked in the working tree: include them before any Git-based release. A clean-clone build was not verified.

Remaining improvements are not publication blockers: Geneva’s geometry is still about 5 MB under local gzip; public-transport coverage varies by city; small map labels and tile-failure feedback could improve. The visible estimates, incomplete coverage and illustrative timing qualifications should remain. Earlier details are in the [project audit](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-08-project/README.md) and [performance follow-up](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-08-project/performance.md).

Deployed on 9 September 2026 (Europe/Paris) to `/home/depr001/danielpradilla.info/swiss-commutes`, using compressed rsync with assets first and delayed page replacement. Existing unrelated files and old assets were retained. The user’s subsequent naming request is included: the displayed name is “Geneva”, with geographic coverage explained in the method text. The rebuilt export and all 748 data checks passed.

All 128 deployed files matched their local SHA-256 checksums. Public HTTP checks matched all 17 pages and 16 geometry files; HTML comparisons removed only Cloudflare’s injected analytics beacon. Live browser checks verified the root, Geneva and Basel, mode controls, mobile width, attribution links and unchanged 07:45 counts. Final Geneva title: “Geneva / 24h | Swiss Commutes”; no browser errors were observed.

[Live site](https://www.danielpradilla.info/swiss-commutes/geneva/) · [Deployment receipt](/Users/dpradilla/dev/swiss-commutes/outputs/deployments/20260908T221324Z/geneva-label/manifest.json) · [Verified pre-deployment backup](/Users/dpradilla/dev/swiss-commutes/outputs/deployments/20260908T221324Z/before.tar.gz).


## Presentation update

Morning autoplay, the compact mobile timeline, Alidade Smooth and smaller moving dots were deployed in `outputs/deployments/20260908T224631Z/`. All 128 remote hashes and 33 public HTTP checks passed. Playback, reduced motion, narrow layouts and unchanged route data are recorded in `audits/2026-09-09-presentation/`.
