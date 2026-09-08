Loading performance, implemented 8 September 2026

The first audit recommendation is implemented locally. Each city now exports its route caches to a separate static JSON file. The page retains the commuter data and journey durations, so counts, charts, filters and commune details work before the map loads. A content version prevents a cached page from displaying mismatched geometry. Failed loads offer retry; changed data offers a page reload.

Profiling found that formatting millions of coordinate keys as strings dominated route preparation. Numeric coordinate maps retain exact vertex sharing without that formatting. Unused road-name arrays were removed. The browser prepares routes in short batches, yielding to input between batches; the build and source audit consume the same preparation logic synchronously.

| Measurement | Before | After |
| --- | ---: | ---: |
| Geneva HTML | 13.43 MB | 1.84 MB (86% smaller) |
| Geneva HTML, local gzip | 4.99 MB | 0.12 MB |
| Longest startup task, local Chromium | 3,670 ms | At most 52 ms across three runs |
| Complete static export | 210.42 MB | 75.71 MB (64% smaller) |

The map appeared after 1.82–1.94 seconds in the final runs; first content appeared after 56–160 ms. These are local measurements at 1280 × 900, with reduced motion, an uncompressed Python server and no network or CPU throttling. The three runs reused one browser context. One run had no task meeting the browser’s 50 ms reporting threshold. Production advertises Brotli, so local gzip sizes are not production transfer measurements.

The geometry still contains the original coordinates and journey times. Its separate Geneva file is 11.36 MB, or 5.03 MB under local gzip. The combined HTML and geometry download is roughly unchanged; the gain is a much smaller initial document, reusable geometry files and responsive preparation. No worker, dependency or application server was added.

Validation: 40 tests, all 748 source/data checks, lint, TypeScript and production export passed. The export check verifies separate geometry and matching content versions. Browser checks covered all sixteen cities and the home page, delayed downloads with active filters and time controls, cancellation during city switching, HTTP failure, invalid JSON, retry, version mismatch and recovery. Geneva still shows 33’284 travelling, −5’313 relative to the daily average and a +77’404 daily peak at 07:45. Home and Zürich still agree.

The 390 × 844 mobile check retained the map and statistics without horizontal overflow; the native commune selector and time slider worked. The final Geneva page had no console errors or warnings.

Evidence: [before sizes](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-08-project/performance-before.json), [after sizes](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-08-project/performance-after.json), [three browser runs](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-08-project/performance-browser.json), [mobile screenshot](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-08-project/performance-mobile.png). No deployment was made.
