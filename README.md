# Moon rover

A Moon rover simulation, starting from an interactive globe of the Moon.

## What's here

| Path | What |
| --- | --- |
| `globe/index.html` | **Lunar Coordinate Globe.** Drag to turn the Moon, click for selenographic latitude/longitude, colour-coded poles, near/far side tint, sunlight and Earth position from a date. |
| `globe/moon-texture.js` | The Moon map wrapped as a `data:` URL, so the page works opened straight from disk. Rebuild it with `tools/make-texture-js.sh`. |
| `assets/lroc_color_poles_4k.jpg` | NASA LRO/LROC colour Moon map, 4096×2048, equirectangular, centred on 0° longitude, east to the right. |
| `tools/make-texture-js.sh` | Regenerates `globe/moon-texture.js` from a map JPEG. |

## Running the globe

Open `globe/index.html` in a browser. It needs an internet connection for two libraries loaded from jsDelivr:
three.js 0.160.0 and Astronomy Engine 2.1.19.

## Coordinates and conventions

- **Selenographic frame:** X toward 0° longitude (mean sub-Earth point), Y toward 90° E, Z toward the north pole.
  Longitude is east-positive, shown both as ±180° and 0–360° E.
- **three.js mapping:** the Moon mesh's local axes are `x = X`, `y = Z` (north up), `z = −Y`. This matches
  `THREE.SphereGeometry`'s UVs for a map centred on 0° longitude. `latLonToLocal` / `localToLatLon` in
  `globe/index.html` are the single place this conversion lives.
- **Moon orientation:** IAU (WGCCRE) rotation model via Astronomy Engine's `RotationAxis(Body.Moon)`, which
  approximates the mean-Earth/polar-axis frame used by LRO maps. Good to well under a kilometre on the ground.
  For rover-grade accuracy, switch to JPL's DE440 lunar orientation kernels (`MOON_ME` frame) through SPICE or
  Skyfield.
- **Sun and Earth:** Astronomy Engine `GeoMoon` and `GeoVector(Sun)`, about 1′ accuracy. Checked against
  Astronomy Engine's own `Libration()`: the sub-Earth point agreed within 0.02° on four dates in 2026–27.
- **Elevations** of the Sun and Earth at a clicked point ignore terrain (crater rims, mountains).

## Sources and credits

- Moon map: NASA's Scientific Visualization Studio, CGI Moon Kit (https://svs.gsfc.nasa.gov/4720/), built from
  LRO LROC data. NASA imagery is public domain; credit NASA's Scientific Visualization Studio.
- three.js (MIT), Astronomy Engine by Don Cross (MIT).
