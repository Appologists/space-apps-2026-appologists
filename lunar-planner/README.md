# Lunar Site Planner (Flask version)

A second front end for the Lunar Landing Site Navigator. It runs with Python only: no Node.js or npm.
It uses the team's site list (`../data/sites.json`), the same ranking idea (unbroken sunlight and Earth
contact) and the same lens colour rules (`src/surface/lenses.js`).

## What it does

- **Moon:** a 3D Moon lit by the real Sun direction, with a latitude/longitude grid. Hover to read latitude,
  longitude and elevation. Click a spot to look around there or add it as a site.
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
- **Learning game:** missions with XP, NASA facts with their source pages, and a quiz on why sites are chosen.

## Start (Windows PowerShell)

```powershell
cd lunar-planner
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe build_terrain.py
copy lunar_keys.example.json lunar_keys.json
.\.venv\Scripts\python.exe lunar_server.py
```

Then open http://127.0.0.1:8002.

- `build_terrain.py` downloads NASA LOLA `ldem_16.tif` (66 MB) once into `lunar-planner/data/` (git-ignored).
- Put your own keys in `lunar_keys.json` (git-ignored). Never commit it.
  - **Cesium ion token:** for the Surface view. For "Cesium Moon 3D", add **Cesium Moon** to your ion assets.
  - **Google key:** enable **Maps JavaScript API** for it, and restrict it to `http://127.0.0.1:8002/*`.

## Data and what the numbers leave out

| What | Source | Leaves out |
| --- | --- | --- |
| Sun and Earth az/el | NASA/JPL Horizons, airless, observer `coord@301` | Terrain horizon in the ranking (smooth Moon) |
| Terrain | NASA LRO LOLA `ldem_16`, SVS CGI Moon Kit | Detail finer than about 1.9 km |
| Surface photo | NASA Moon Trek, LRO WAC global mosaic (WMTS) | |
| Temperature | Our estimate: radiative equilibrium, albedo 0.12, emissivity 0.95, 100 K night floor | Thermal inertia, real Diviner data |
| Earth photo | NASA EPIC (DSCOVR) | |
| Sun photos | NASA SDO, latest images | |
| Facts | science.nasa.gov fact pages (Moon, Sun, Earth), paraphrased | |

## Files

| File | What |
| --- | --- |
| `lunar_server.py` | Flask: Horizons queries and analysis, terrain tiles, NASA EPIC, keys |
| `build_terrain.py` | Downloads and prepares LOLA terrain |
| `public/lunar.js` | Moon globe, heatmaps, ranking, timeline, wiring |
| `public/lunar-surface.js` | CesiumJS surface view |
| `public/lunar-bodies.js` | Earth (Street View, EPIC) and Sun (SDO) views |
| `public/lunar-game.js` | Missions, XP, facts, quiz |
| `public/vendor/three/` | three.js r180 (MIT, see LICENSE) |
