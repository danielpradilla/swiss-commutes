# Swiss Commutes

Swiss Commutes is an animated portrait of a weekday in and around twelve Swiss cities. It turns commune-level home-to-work records into a map that can follow Swiss local time, fast-forward through the day or be scrubbed by hand.

[Open the live project](https://www.danielpradilla.info/swiss-commutes/geneva/)

The current cities are Zürich, Geneva, Basel, Lausanne, Bern, Winterthur, Lucerne, St. Gallen, Lugano, Biel/Bienne, Schaffhausen and La Chaux-de-Fonds.

## Inspiration

The project began with [“An animated map of all commuters to Geneva”](https://www.reddit.com/r/geneva/comments/1vxy0q9/an_animated_map_of_all_commuters_to_geneva/) by [Habibi Code](https://www.habibicode.org/commuters/). The original made a large statistical subject feel immediate: people leave hundreds of communes, converge on Geneva and return later in the day.

Swiss Commutes is an independent implementation of that idea. It expands the view to several Swiss cities and adds commune tooltips, transport filters, inbound and outbound colours, a clock-driven animation and a chart showing the estimated population above or below its daily average.

## What the animation shows

- Red dots are travelling into the selected city; blue dots are travelling out.
- A moving dot represents a bundle of trips, not one person.
- Grey circles represent communes. Their size follows the number of commuters associated with that commune, and they pulse when a journey arrives.
- Hovering a moving dot shows its origin and destination. Hovering a commune shows its name.
- The chart estimates how commuting changes the city’s daytime population relative to its daily average.
- “Real-time estimate” follows the Swiss clock, but the data is not a live feed.

## Data sources

The project combines several official datasets because no single table contains all the necessary geography, direction, transport mode and current totals.

### Used across most cities

| Source | What it supplies |
| --- | --- |
| [FSO home-to-work commune matrix](https://opendata.swiss/en/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020) | Swiss residence-to-workplace pairs. The latest commune-level release used here is 2020. |
| [FSO cross-border workers, Q4 2025](https://www.pxweb-admin-a.bfs.admin.ch/pxweb/en/px-x-0302010000_101/-/px-x-0302010000_101.px/) | Reported cross-border worker totals by Swiss workplace commune. |
| [FSO Swiss Cities 2026](https://www.bfs.admin.ch/asset/en/DF_SSV_MOB_COM) | 2023 city-level shares for car, public transport, walking and cycling, plus the population figures used to select the largest cities. |
| [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d) | Swiss commune geography and centre points. |
| [API Géo](https://geo.api.gouv.fr/decoupage-administratif/communes) | Official French commune names, populations and centre points. |
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | Names and centre points for other foreign communes. |
| [Stadia Outdoors](https://docs.stadiamaps.com/map-styles/outdoors/) | The basemap displayed behind the animation. |

### Geneva

Geneva has a more detailed combination of sources:

| Source | What it supplies |
| --- | --- |
| [INSEE RP2023 MOBPRO](https://www.insee.fr/fr/statistiques/9004795) | French home-to-work records, including the usual transport mode. |
| [FSO home-to-work commune matrix](https://opendata.swiss/fr/dataset/erwerbstatige-nach-wohn-und-arbeitsgemeinde-2014-2018-und-2020) | Swiss commune pairs and their relative shares. |
| [OCSTAT 2024](https://statistique.ge.ch/statistique/tel/domaines/11/11_02/T_11_06_2_04.xlsx) | More recent totals used to update the Geneva–Vaud flows. |
| [API Géo](https://geo.api.gouv.fr/decoupage-administratif/communes) and [swissBOUNDARIES3D](https://www.swisstopo.admin.ch/en/landscape-model-swissboundaries3d) | Commune names and locations on both sides of the border. |

## The difficult parts

### The tables do not contain a clock

The source records say where people live and work, but not when they leave. The morning and evening waves are modelled with smooth arrival and departure curves. The in-transit count uses two broad peaks. This makes the animation legible, but it should not be read as an observed traffic count for a particular minute.

### Cross-border totals do not always include foreign origins

For most cities, the FSO cross-border table gives the Swiss workplace commune but not the worker’s home commune abroad. The project distributes that total among nearby foreign communes using population and distance. Geneva is the important exception: INSEE provides actual French origin communes. These figures cover people working in Switzerland; they do not measure Swiss residents who commute to jobs abroad.

### The source years do not line up neatly

The Swiss commune matrix is from 2020, transport shares are from 2023 and cross-border totals are from Q4 2025. Geneva combines French 2023 records with OCSTAT 2024 totals. The project preserves those vintages instead of presenting the result as a single-year census.

### Transport detail is uneven

The French records used for Geneva include the usual mode of travel. The other city datasets do not provide mode for every commune pair, so their flows are split using the selected city’s 2023 overall transport mix.

### The map is schematic

The data ends at the commune boundary. It does not identify an address, station or road. Trips therefore travel between commune centre points on curved display paths; they do not claim to reproduce the route a commuter actually took.

### Every person cannot be drawn

Large cities contain hundreds of thousands of journeys. Drawing one point per person would obscure the map and perform poorly, so each moving dot stands for a group of trips. Commune circles preserve the relative scale without covering the entire basemap.

### The map has a practical boundary

The population model uses the published city totals, while the dots are limited to commune pairs inside each map’s configured viewing area. A long-distance commuter can therefore affect the chart without appearing as a moving dot.

## How the model works

The city configuration separates three population groups: cross-border arrivals, Swiss arrivals and residents commuting outward. Smooth sigmoid curves estimate when each group arrives and leaves. Gaussian morning and evening peaks estimate how many people are travelling at once.

The chart samples the resulting population estimate every ten minutes. Its centre line is the modelled daily average, not midnight, so the same curve can show both the quieter and busier parts of the day.

## Development

The site is a statically exported Next.js application using React, Leaflet and a canvas overlay.

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Validation and production export:

```bash
npm test
npm run lint
npm run build
```

The production files are written to `out/` and expect the `/swiss-commutes` base path.

The generated city modules can be rebuilt from downloaded FSO and swisstopo inputs with:

```bash
node scripts/generate-top-city-data.mjs \
  --commutes=/path/to/commune-matrix.csv \
  --centres=/path/to/commune-centres.tsv \
  --out=app/data
```

The input downloads are not committed to the repository. The generated TypeScript modules under `app/data/` are the files used by the site.
