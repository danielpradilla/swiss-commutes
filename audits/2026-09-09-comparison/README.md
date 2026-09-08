Comparison with the original, 9 September 2026

Compared the current [Habibi Code Geneva page](https://www.habibicode.org/commuters/geneva/), linked as the inspiration in this repository, with [Swiss Commutes](https://www.danielpradilla.info/swiss-commutes/geneva/). This is a comparison with the original author’s current site, not a reconstruction of an earlier release. Both were paused at 07:45 with all modes selected. Desktop captures use 1440 × 1000; mobile captures use 390 × 844.

My assessment: the commuting-map idea remains intact, but Swiss Commutes has become a statistics dashboard and lost some of the original’s immediate visual effect.

| Aspect | Original | Swiss Commutes |
| --- | --- | --- |
| Layout | Map, compact statistics and timeline fit one screen, including mobile | Larger introduction and statistics; mobile timeline begins below the initial viewport |
| Map | Sparse background, fine particles and visible regional boundaries | Detailed labelled basemap, larger particles and a closer initial view |
| Colour | Distinguishes transport modes | Distinguishes inbound and outbound travel |
| Default playback | Begins at 05:00 and advances 90 simulated minutes per second; reduced motion starts paused | Follows the current Swiss time; reduced motion starts paused at 07:45 |
| Chart | Net arrivals and departures in ten-minute bins | Commuter population relative to its daily average |
| Additional exploration | Origin filters, border-crossing counter and busiest crossing | Sixteen Swiss locations, route coverage and accessible commune journey details |

The numerical totals are not directly comparable. The original lists 386,482 commuters, including roughly 259,000 originating in Geneva. Swiss Commutes’ source cohort is 149,171 people: 118,892 from France, 23,398 from Vaud and 6,881 travelling from Geneva to Vaud. It omits journeys wholly within Geneva, and some source pairs lack mapped or routed journeys. The source years and timing models also differ. At 07:45 the displayed travelling counts were 72,956 and 33,284 respectively; that difference alone does not demonstrate an error.

Both animations group commuters into particles. The original’s current script uses 26 people per particle; Swiss Commutes uses up to 50 for cars and 200 for other modes. The original’s “one person at a time” tagline should not be treated as a literal description of its rendering.

The smallest useful changes would be to start the animation in the morning using the existing fast-forward mode, place the map and time controls together in the first mobile screen, and simplify the basemap while reducing particle size. Keep reduced-motion support, city selection, data checks and the method details. Changing the data or chart merely to reproduce the original’s numbers would not be justified.

Screenshots: [original desktop](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-09-comparison/original-desktop.png), [Swiss Commutes desktop](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-09-comparison/swiss-desktop.png), [original mobile](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-09-comparison/original-mobile.png), [Swiss Commutes mobile](/Users/dpradilla/dev/swiss-commutes/audits/2026-09-09-comparison/swiss-mobile.png). No application changes were made during this comparison.
