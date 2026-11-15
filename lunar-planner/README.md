# Lunar Site Planner (Flask version)

Runs the team's Lunar Landing Site Navigator with Python only: no Node.js and no npm.

- **http://127.0.0.1:8002** is the team's own app: `index.html` and `src/` at the repo root, unchanged.
  Ranking, the 3D Moon, the surface view with real terrain and lenses, and the mission wizard (landing-site
  finder, reach and route, drive planner). When the team changes `main`, this page changes with it.
- **http://127.0.0.1:8002/learn** is the education section (`../education/`): 3D Moon, Earth and Sun with live
  NASA data, facts, a quiz, a temperature exercise and a leaderboard.
- **http://127.0.0.1:8002/classic** is our Flask planner described below (street view with measure, real-horizon chart, sky paths and snapshots; Diviner temperatures, the
  5 m south-pole page, the Cesium surface view, heatmaps, missions and quiz).

## How the team app runs without npm

`team_api.py` is a Python version of the team's dev-server plugin (`server/*.mjs`). It answers the same
requests with the same binary formats, so the browser code does not know the difference:

| Request | What it gives | Node version |
| --- | --- | --- |
| `GET /api/terrain/info` | the terrain datasets and which are downloaded | `server/terrain-sources.mjs` |
| `GET /api/terrain/polar` | the ground around a point, for the surface view | `samplePolarPatch` |
| `POST /api/terrain/landing-search` | the landing-site finder, with the same shadow sweep | `server/landing-search.mjs` |
| `GET /api/horizons` | JPL Horizons, forwarded | the proxy in `vite.config.js` |

It also serves `src/*.js` with the two things only Vite understands rewritten (a CSS import and a JSON
import). `three` (0.187) and `astronomy-engine` (2.1.19) are single files in `public/vendor/team/`, the same
versions as `package-lock.json`, so nothing is installed from npm.

Checked against the Node version on the same data: the surface-view terrain is identical; the landing
search gives the same heights, slopes, scores and best sites, in about the same time (4 to 5 s for a 10 km
search). One difference: Sun and Earth directions come from JPL Horizons at the search centre, where the
Node version uses Astronomy Engine. When the Sun is right on the horizon this changes a few hundred of
about 1.3 million cell-hours.

Not read here yet: the 59 m whole-Moon tiles (`lola-global-512`, 34 GB). The other datasets work:

```powershell
python lunar-planner\fetch_data.py --list
python lunar-planner\fetch_data.py lola-south-80s-80m     # 115 MB, the finder's best data at the south pole
python lunar-planner\fetch_data.py ldem-64 --large        # 1.06 GB, whole Moon at 470 m
```

`start.ps1` downloads the 80 m south-pole grid the first time. The whole-Moon 1.9 km data comes from
`build_terrain.py` (also run by `start.ps1`).

## The classic planner (/classic)

## What it does

The look follows the team mockups in `docs/mockups/`: a full-screen Moon, floating field-notes panels
(Instrument Serif and IBM Plex), and glowing zones where analyzed sites score well. Press Ctrl+K (or Cmd+K)
to search sites, views and questions.

- **Moon:** a 3D Moon lit by the real Sun direction, with a latitude/longitude grid. Hover to read latitude,
  longitude and elevation. Click any point to stand there in 3D. Click the Sun or Earth to zoom in on it.
- **Ranking:** Sun and Earth positions come live from NASA/JPL Horizons, with the observer on the Moon.
  Sites rank by the longest unbroken time with both sunlight and Earth in view. Sliders set what matters
  most. The mission need ("unbroken Sun + Earth, hours") is a must-have.
- **Surface:** stand on the Moon with CesiumJS. The terrain is NASA LOLA (16 px/degree, about 1.9 km),
  served by this app, and the photo is the NASA Moon Trek LRO WAC mosaic. Options: elevation colours with
  hill shading, real sunlight with shadows, and Cesium Moon 3D tiles (needs the asset in your ion account).
- **Heatmaps:** a 40 km patch around a site, coloured by elevation, slope or estimated temperature, with
  terrain shadows.
- **Earth and Sun:** click Earth for Google Street View and the newest NASA EPIC photo. Click the Sun for the
  newest NASA SDO images in 4 wavelengths.
- **Moon view extras:** 3D globe or 2D map, day/night, a latitude/longitude grid, and quick views (near side,
  south pole, far side, Sun & Earth).
- **Compare, Timeline, Past missions:** site cards with scores, pros and cons; hour-by-hour Sun and Earth bars
  for every site with a sky chart; the six Apollo landings with surface time and samples (NASA KSC flight
  summary, NSSDCA landing table), and how the south pole differs.
- **Surface panels:** "If you landed here this week" and "What's overhead" (Sun, Earth, in sun, call home,
  height, slope), quick jumps to the South Pole, Malapert and Apollo 11, click to walk, realistic or
  exaggerated elevation, and a time-lapse speed control.
- **South pole:** NASA LOLA 5 m/pixel south-pole tiles and their regions of interest (ROIs). 40 candidate
  sites with slope, a real terrain horizon, hours of sunlight and Earth for the week, and temperature.
- **Real temperatures:** NASA LRO Diviner bolometric temperature snapshots, for the time you choose. Map
  layers show now, the hottest and the coldest temperature everywhere.
- **Learning game:** missions with XP, NASA facts with their source pages, and a quiz on why sites are chosen.

## Start

Windows PowerShell, from the `lunar-planner` folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

macOS or Linux:

```bash
./start.sh
```

The script does the setup the first time, then starts the app and opens http://127.0.0.1:8002.

1. It makes a Python environment (`.venv`) and installs `requirements.txt`. You need Python 3.10 or newer.
2. It copies `lunar_keys.example.json` to `lunar_keys.json`.
3. It downloads NASA LOLA `ldem_16.tif` (66 MB) once into `data/` (git-ignored).

The app runs with no keys. Keys add more:

- Put your own keys in `lunar_keys.json` (git-ignored). **Never commit it.**
  - **Cesium ion token:** for the 3D surface view. For "Cesium Moon 3D", add **Cesium Moon** to your ion assets.
  - **Google key:** enable **Maps JavaScript API** for it, and restrict it to `http://127.0.0.1:8002/*`.
- With no Cesium token, the surface view still shows the NASA Trek photo on a smooth Moon.

The south-pole and Diviner data are already in git (`public/south-pole/`, `derived/`, `public/diviner/`).
To build them again from the NASA files, put the files in `data/south-pole/` and `data/diviner/`, then:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-build.txt
.\.venv\Scripts\python.exe build_south_pole.py
.\.venv\Scripts\python.exe build_diviner.py
```

## Data and what the numbers leave out

| What | Source | Leaves out |
| --- | --- | --- |
| Sun and Earth az/el | NASA/JPL Horizons, airless, observer `coord@301` | Terrain horizon in the ranking (smooth Moon) |
| Terrain | NASA LRO LOLA `ldem_16`, SVS CGI Moon Kit | Detail finer than about 1.9 km |
| Surface photo | NASA Moon Trek, LRO WAC global mosaic (WMTS) | |
| Temperature (measured) | NASA LRO Diviner tbol snapshots (12 subsolar longitudes), colour scale fitted back to kelvin (median error 0.08 K) | Times between snapshots (linear), detail finer than the snapshot grid |
| Temperature (estimate) | Radiative equilibrium, albedo 0.12, emissivity 0.95, 100 K night floor; used where Diviner has no data | Thermal inertia |
| South pole | NASA LOLA 5 m/pixel south-pole tiles (slope, surface) and ROI shapefiles; horizons from the 5 m tiles and `ldem_16` to 150 km | Detail finer than 20 m in the horizons |
| Earth photo | NASA EPIC (DSCOVR) | |
| Sun photos | NASA SDO, latest images | |
| Facts | science.nasa.gov fact pages (Moon, Sun, Earth), paraphrased | |

## Files

| File | What |
| --- | --- |
| `lunar_server.py` | Flask: Horizons queries and analysis, terrain tiles, NASA EPIC, keys |
| `start.ps1`, `start.sh` | First-time setup and start |
| `team_api.py` | The team app's server in Python (see above) |
| `fetch_data.py` | Downloads a dataset from `data/catalog.json` into `data/raw/` |
| `public/vendor/team/` | `three` and `astronomy-engine` for the team app, one file each |
| `build_terrain.py` | Downloads and prepares LOLA terrain |
| `build_south_pole.py` | Makes the south-pole maps and `public/south-pole/sites.json` from the LOLA 5 m tiles |
| `build_diviner.py` | Turns the Diviner snapshot images into `derived/diviner_tbol.npz` |
| `public/lunar-southpole.js` | South-pole map, site details and horizon chart |
| `public/lunar.js` | Moon globe, heatmaps, ranking, timeline, wiring |
| `public/lunar-surface.js` | CesiumJS surface view |
| `public/lunar-bodies.js` | Earth (Street View, EPIC) and Sun (SDO) views |
| `public/lunar-game.js` | Missions, XP, facts, quiz |
| `public/vendor/three/` | three.js r180 (MIT, see LICENSE) |
