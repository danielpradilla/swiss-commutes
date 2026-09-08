# Comparison with the original Geneva project

This compares [Habibi Code’s Geneva page](https://www.habibicode.org/commuters/geneva/), retrieved on 6 September 2026, with our corrected local build. It covers Geneva only; it does not validate Zürich or the other cities. The original project has changed over time, so this is a comparison with its current public version.

Our French commuter totals are reasonably close on comparable geography. Missing public-transport routes and the Vaud mode allocation are more substantial problems than the difference in incoming car counts. The original is another model, not a traffic measurement or an accuracy benchmark.

## Commuter counts

Counts below are people, not cars. The original identifies its French data as INSEE RP2021; ours uses RP2023. Its embedded French rows sum to 101,745.9, slightly below the 101,748 stated in its footer. Differences combine source vintage, selection and processing; they cannot all be attributed to real growth.

| Cohort | Original | Ours | Difference |
|---|---:|---:|---:|
| French incoming, each project’s selected origins | 101,745.9 | 118,892 | +16.9% |
| French incoming, restricted to the original origin communes | 101,745.9 | 107,867 | +6.0% |
| French car category, same origin communes | 81,862.9 | 82,952 | +1.3% |
| Vaud incoming, source cohort | 25,406 | 23,398 | −7.9% |
| All incoming, source cohorts | 127,151.9 | 142,290 | +11.9% |

We cover 392 French origins against the original’s 242. The additional origins account for 11,025 people, or 64.3% of the total French difference. Restricting further to the 2,141 positive origin/workplace/mode cells present in both snapshots gives 99,394.8 versus 103,710 (+4.3%). That comparison excludes cells absent in either year and must not be presented as a population-wide accuracy score.

Our motorised category explicitly combines cars and motorcycles. The original exposes a `car` category but no raw mode-code importer on the page; its treatment of motorcycles cannot be independently confirmed from this snapshot.

Our Vaud source total is OCSTAT 2024, distributed over FSO 2020 commune pairs. Of 23,398 incoming people, 21,301 have located pairs; 2,097 have an unknown commune code. The original page does not establish the lineage of its 25,406 Vaud total, so its higher number is not grounds for changing ours.

## Why the original looks busier

The original includes **259,330 modelled trips within Geneva canton**, in addition to French and Vaud incoming commuters. Its embedded internal-worker counts equal half of each commune’s resident population, within rounding. Those trips account for 67.1% of its approximately 386,482-person total. Our page excludes internal trips and includes Geneva-to-Vaud commuters, a group absent from the original model loops. Its overall total and our 145,715 mapped people therefore describe different populations.

The original assigns 26 people to each dot. Ours uses up to 50 for motorised travel and up to 200 for other modes, with smaller weights for small flows. In the original, rounding each French flow to whole dots reduces the 101,745.9 input total to 94,614 represented people (−7.0%). Visual density is not a reliable measure of a count discrepancy.

## Public-transport coverage

Our French public-transport data contain **18,812 people**, but accepted routes represent only **3,083 (16.4%)**. All routed French origins are Annemasse. The remaining 15,729 people are excluded from the map, travelling counter and population curve.

The original has rail geometry entries for all its French public-transport pairs: 14,779.5 people across 175 origins. Rounding to dots leaves represented trips from 90 origins. That is broader geometry coverage, but it does not establish valid services, station access, bus connections or actual passenger itineraries. We should acquire those routes from transport data rather than copy a rail path solely because it exists.

The largest gaps in our French public-transport coverage are:

| Origin | Our estimated commuters | Represented by routes |
|---|---:|---:|
| Saint-Julien-en-Genevois | 1,179 | 0 |
| Gaillard | 1,175 | 0 |
| Ferney-Voltaire | 988 | 0 |
| Saint-Genis-Pouilly | 847 | 0 |
| Ville-la-Grand | 779 | 0 |
| Valserhône | 638 | 0 |
| Thonon-les-Bains | 613 | 0 |
| Ambilly | 473 | 0 |

These totals aggregate all Geneva workplace communes. They are estimates of workers, not observed daily passenger counts.

## Vaud mode allocation

Neither model provides an observed Vaud-to-Geneva split by origin and workplace. The original assumes different shares by distance to central Geneva. Ours applies resident profiles to the located pairs. The following original percentages are weighted expectations before random particle sampling, not its rounded button values.

| Mode | Original expected share | Our mapped share |
|---|---:|---:|
| Car category | 42.7% | 44.7% |
| Public transport | 55.5% | 33.1% |
| Walk/bike category | 1.8% | 22.2% |

Our 22.2% active residual is a weak basis for incoming inter-cantonal commuting. Of its 4,738 allocated people, only 1,615 have accepted local active routes. This supports replacing the resident-mode fallback with evidence about incoming workers. It does not justify adopting the original’s assumed percentages.

## Population and peak-hour estimates

The original’s ribbon shows net arrivals minus departures in each ten-minute interval. Our chart shows accumulated net endpoint presence relative to its daily average. Their heights are different quantities and cannot be compared as an error percentage.

The original population view also includes a Geneva resident baseline totalling 518,679; ours has no resident baseline. The original uses sampled departure-time mixtures and assumed speeds; ours uses triangular departure waves with routed car/active durations and heuristic transit durations. Neither model validates attendance, remote work or observed peak-hour traffic. The original counter can include public-transport people even when their paths are not drawn; ours consistently excludes unrouted people.

## Priorities

1. Add valid cross-border bus and rail itineraries. The data already contain many people whose journeys are missing from the display.
2. Replace the incoming Vaud resident-mode fallback with relevant commuting evidence; separate unknown modes from observed walking/cycling.
3. If expanding the scope, add observed internal Geneva trips with a distinct source cohort. Do not fill the gap by assuming half of the population commutes internally.
4. Validate peak-hour estimates against observed timing, attendance and comparable traffic or passenger counts. The original animation cannot supply that validation.

## Evidence and reproduction

[comparison.ipynb](comparison.ipynb) contains the calculations and saved outputs. Its four Python code cells use only the standard library and passed all assertions. Run from this directory or the repository root. [comparison.json](comparison.json) contains the numerical results and input SHA-256 hashes. `source.html` preserves the retrieved original page; the notebook parses its embedded JSON without running its JavaScript. Source code references in that snapshot: input JSON at line 246; model and sampling at lines 295–424; population accounting at lines 429–485; drawing/counter treatment at lines 608–636; ribbon at lines 927–969.

The local input is the adjacent `audit.json` snapshot. These findings describe the corrected local build, not a verified deployment. No application counts or routes were changed merely to match the original.
