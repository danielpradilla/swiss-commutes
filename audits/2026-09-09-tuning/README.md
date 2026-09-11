# Temporary animation controls — 9 September 2026

Two native sliders above the map allow selection of moving-circle size and playback speed. Size ranges from 0.80 to 4.00 px in steps of 0.05; the 1.40 current and 2.70 previous presets reproduce the corresponding radii for cars, public transport and active travel. The number is the radius of a full-weight car dot; other modes retain their relative sizes. Speed ranges from 1.0 to 100.0 simulated minutes per second. The preceding speed is approximately 71.4. Initial tuning values are 2.70 px and 30.0 min/s. Values reset on a fresh city page; they are temporary controls for choosing final constants.

Fast-forward previously advanced five simulated minutes every 70 ms, limiting updates to about 14 per second. It now uses `requestAnimationFrame` and elapsed time. Pausing cancels the loop; returning from a hidden tab resets its timestamp to avoid a jump. Changing speed explicitly starts fast-forward. Reduced-motion startup remains paused.

Three-second Geneva samples in the same browser at 1440×1000 and approximately 71.4 simulated minutes per second measured 14.28 map redraws/s before and 119.02 after. Median redraw intervals were 68.1 ms and 8.3 ms. These are local browser measurements, not a guarantee for other hardware or refresh rates. The before/after JSON files retain the observations.

`check-browser.mjs` is runnable through the installed Playwright `browser_run_code_unsafe` tool using its `filename` argument. By default it tests a static export served at `http://127.0.0.1:8873/swiss-commutes`. It checks actual canvas radii, unchanged commuter counts, keyboard size adjustment, measured playback rates, pause, hidden-tab behavior, midnight wrapping, city cleanup and the 390×844 layout. Screens shorter than 688 pixels retain a 240-pixel map and allow scrolling.

All 40 existing tests, lint, TypeScript and static export checks pass. All 16 route files are byte-identical to the previous deployment. The local post and LinkedIn drafts remain excluded from Git.

Deployment receipt and rollback backup: `outputs/deployments/20260909T112837Z/`.

The live deployment passed all 128 remote file hash checks and 33 public HTTP checks. A fresh browser confirmed the initial values, adjustable sliders, unchanged Geneva statistics and no page errors.

## Selected settings

The user selected 1.50 px and 15 simulated minutes per second. These are now constants; the temporary sliders, state, props and CSS have been removed. The frame-synchronised clock remains. All 1,355 coloured-dot radii at 07:45 match the slider set to 1.50 exactly. The permanent browser check in `../2026-09-09-presentation/check-browser.mjs` verifies the chosen speed, absent temporary controls and restored mobile layout; `selected-settings.json` records the results. The earlier tuning check requires the historical slider build.

Final-settings deployment receipt: `outputs/deployments/20260909T114001Z/`.

The final deployment passed 128 remote file hash checks and 33 public HTTP checks. A fresh browser measured 14.97 simulated minutes per second, confirmed absent temporary controls and unchanged Geneva statistics, and reported no page errors. The project-specific favicon declaration was removed; all 20 exported HTML pages leave the favicon to the browser’s default behavior. `selected-live.json` records the live check.
