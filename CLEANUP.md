# Repository cleanup

The production site is a Next.js static export under `/swiss-commutes/`. DreamHost also runs PHP feeds for traffic, trains and mobility. Generated city data and historical audits are source artifacts; private feed state and credentials must not be published or removed.

## Cleanup items

- [x] Remove the unused `public/og.png` poster. City-specific `public/social/*.jpg` images supply all sharing metadata; keep the export check against a return to the old poster.
- [x] Make `scripts/check-export.mjs` cover the home page and every city in all four app families (commutes, live traffic, trains, mobility), including route and rail assets, sharing images, PHP endpoints and private-directory protection. Keep the checks tied to published behavior rather than HTML implementation details where possible.
- [x] Sanitize the static export before verification so Next's `public/` copy cannot publish local train feed caches, locks or timetable files. Preserve the source files locally and the `.private/.htaccess` access rules in the export.
- [x] Document the repository layout and the safe publication boundary in `README.md`. Keep historical audits, generated source data, feed credentials, cron jobs and server-side caches in place.
- [x] Run the TypeScript/Node, PHP and Python checks, lint and production export; smoke-test representative interactive pages and all exported city URLs and feeds before publication.
- [x] Publish the verified export to DreamHost without deleting remote files or overwriting private state; verify all four app families, city pages and feeds over HTTPS.
- [x] Commit and push only the reviewed cleanup changes.

## Completion record

Tick each item only after its result is verified. Record any verification limitation here rather than treating an unchecked item as done.

Local verification: 48 model tests, 5 traffic tests, 2 train data tests, 2 Python updater tests, both PHP feed suites, ESLint and the production build passed. Local HTTP returned 200 with content for 100 paths (four roots, 64 city pages, 16 route files, 16 rail files). Browser checks rendered each dashboard; the commute mode control updated its map. The three production feed endpoints returned data before deployment; the train feed was briefly stale at 00:02 UTC, then refreshed at 18:49 UTC during the check.

Deployment verification: backed up the public tree to ignored `outputs/deployments/20260927-cleanup/before/` (excluding private state and timetables), then synced `_next/` before the rest of the checked export without `--delete`. A checksum dry run found no differing exported files. HTTPS returned 200 with content for the same 100 paths. Browser checks rendered the commute map, measured traffic minute, current train list and mobility pickup sites. All three PHP feeds returned data; both private directories returned 403. The server retained the train credentials and active timetable symlink.

GitHub: commit `5bec460` pushed to `origin/main`; this final checklist tick is committed separately. Unrelated untracked `TODO.md` was left untouched.
