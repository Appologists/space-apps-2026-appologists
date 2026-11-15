# Lunar Landing Site Navigator

Team Appologists' project for the NASA Space Apps Challenge 2026,
[Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

A web app that runs on your own computer. You choose a landing date, how long the mission lasts and what
matters most; it ranks landing sites and shows where the Sun and Earth are in each site's sky.

**Start here:** the left panel is five steps. Choose a mission, see which regions near the south pole can
take it, plan the rover's drive and play it back, stand at the landing spot, then ride along the route.
The older tools (ranked list of 23 sites, weights, terrain data) are off the page for the demo: add `?tools`
to the address (`http://localhost:5173/?tools`) and they appear under "More tools" on the first step.

**What works today:** a 3D Moon with 23 sites, ranking by uninterrupted sunlight and Earth visibility, a
time slider, your own points by click or coordinates, and a one-click check against NASA JPL Horizons.
Within 10° of the south pole you can also **stand on the surface and look around**: real terrain from NASA's
LOLA instrument, real shadows, the Sun and Earth where they would be, and what the terrain does to the
mission's sunlight and Earth contact. Lenses recolour the ground by elevation or by slope, and pointing at
any spot reads out its height, slope and distance. The **landing-site finder** takes the landing accuracy,
slope limit and the darkness the rover can survive, searches the area round a chosen point, and maps where
a landing passes every check, with sunlight, darkness, Earth-link and slope layers. On that map you can also
see the ground a rover can **reach** from a starting point within its slope limit and range, and the shortest
drivable **route** to a destination.

**What does not work yet:** the ranking itself still assumes a smooth Moon, so no ridge or crater rim casts
a shadow in the scores. Near the poles that decides the real answer. See [docs/plan.md](docs/plan.md).

## The website (no server)

The hosted site is the same app reading saved answers instead of the server: the ready-made missions'
searches and the street view terrain at their landing spots. With the app running (`npm run dev`):

```bash
npm run export:static
npm run build:site
```

Then upload the `dist` folder to Netlify (drag it onto the site's Deploys page). Missions with other settings
say they are not saved on the website; they work when the app runs on a computer.

To try VR on a Meta Quest without hosting: `npm run dev:quest`, then open the address it prints in the
Quest's Browser (same Wi-Fi; tap "Advanced" > "Proceed" on the certificate warning).

## Start

You need [Node.js](https://nodejs.org/) 22.12 or newer (`node --version` to check).

```bash
npm install
```

```bash
npm run dev
```

Then open the address it prints (normally http://localhost:5173).

The surface view and the landing-site finder need terrain data, which is kept out of git. The "Terrain data"
section of the app lists the datasets it can use, which ones you have, and the command to get each. Start
with the south pole (115 MB), then reload the page:

```bash
npm run data:fetch -- lola-south-80s-80m
```

Then choose a south-pole site and press "Look around from here", or double-click the Moon near the south pole.

**Showing the demo to anyone?** Follow [docs/demo-runbook.md](docs/demo-runbook.md): it adds the stored
sunlight maps (`npm run data:light`) that make each region's search take about a second, and the warm-up.

For the sharpest street view (5 m ground at the four regions the finder favours: Connecting ridge, Shackleton rim,
Peak near Shackleton, Malapert), also get NASA Goddard's 5 m maps (387 MB). Without them the street view uses
the 80 m data and says so.

```bash
npm run data:fetch -- pgda-lola-5mpp
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app with live reload |
| `npm test` | Runs the tests (about 2 seconds) |
| `npm run check:horizons` | Compares our Sun/Earth maths with JPL Horizons over the next 28 days |
| `npm run check:landing` | Compares the landing-site finder with the slower point-by-point method at 16 places |
| `npm run data:light` | Stores the seven mission regions' sunlight and Earth maps (5 min, 344 MB in `data/raw/light/`), so their searches take about a second |
| `npm run check:light` | Checks that a search using the stored maps gives exactly the computed answer |
| `npm run demo:warm` | With the app running: asks every search the ready-made missions need, so the steps open at once |
| `npm run data:list` | Lists the large datasets we know about and which ones you have |
| `npm run data:fetch -- <id>` | Downloads one into `data/raw/` (never committed) |
| `npm run build` | Builds a static copy into `dist/` |

## Where things are

| Path | What |
| --- | --- |
| `index.html`, `src/main.js` | The page, and the file that wires everything together |
| `src/astro/` | Sun and Earth positions, the sky from a site, the JPL Horizons client |
| `src/criteria/` | One file per thing we score a site on. **Most new work goes here.** |
| `src/scoring/` | Turns criteria and weights into a ranking |
| `src/globe/` | The 3D Moon |
| `src/surface/` | The view from the ground, and its shadows |
| `src/terrain/` | Terrain around a point: the real horizon, and the format terrain travels in |
| `server/` | Runs inside the dev server: reads the big terrain files and serves the piece the app asks for |
| `src/finder/` | The landing-site finder: its rules, the map of results, and the format results travel in |
| `src/ui/` | The mission steps (`flow.js`), the panel, ranked list and site card |
| `data/missions.json` | Ready-made missions and the regions they are checked against, each with its source |
| `data/sites.json` | The curated sites, each with its source |
| `data/catalog.json` | Large datasets: where they come from and how big they are |
| `tools/` | Command-line helpers: dataset download, Horizons check |
| `lunar-planner/` | A second front end that runs with Python only (Flask): see its README |
| `tests/` | Tests, including reference values from JPL Horizons |
| `docs/` | Plan, decisions, architecture, how-tos, UI mockups (`docs/mockups/`) |

## How to…

- **Add a way to score sites** (terrain, water, temperature…): [docs/adding-a-criterion.md](docs/adding-a-criterion.md)
- **Add a site:** add an entry to `data/sites.json` with its `source`. `npm test` checks the format.
- **Use a big dataset:** [data/README.md](data/README.md)
- **See what to build next, or record a decision:** [docs/plan.md](docs/plan.md), [docs/decisions.md](docs/decisions.md)
- **Work with an AI coding tool:** it should read [AGENTS.md](AGENTS.md) first.

## Accuracy

Sun and Earth positions are computed in the browser with Astronomy Engine and agree with JPL Horizons to
about 0.004° (the Sun's disc is 0.53° wide). Terrain horizons come from 80 m LOLA data, sampled every half
degree of compass direction out to 300 km. Coordinates use the Moon's mean-Earth / polar-axis frame, the
same one LRO maps and Horizons use: latitude north-positive, longitude east-positive.
Details and assumptions: [docs/architecture.md](docs/architecture.md).

## Credits

- Moon colour map: NASA's Scientific Visualization Studio, [CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/),
  from Lunar Reconnaissance Orbiter data. Public domain.
- Reference ephemeris: [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/).
- Libraries: [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross (MIT),
  [three.js](https://threejs.org/) (MIT), [Vite](https://vite.dev/) and Vitest (MIT).
- Site coordinates: see the `sources` section of `data/sites.json`.
- Mission-card pictures (`public/images/`): NASA artist's concepts, public domain, via Wikimedia Commons:
  [Starship HLS](https://commons.wikimedia.org/wiki/File:HLS_Starship_rendering.jpg) and
  [VIPER](https://commons.wikimedia.org/wiki/File:Viper-ACD20-0047.jpg) (NASA Ames, Daniel Rutter).
  `janky-rover.svg` is our own drawing.
