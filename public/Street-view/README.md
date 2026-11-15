# Lunar Street View (real data)

The team's street view, same look and controls, now standing on NASA elevation data with real Sun and Earth
positions. A static site: no server code, no keys. Works on Netlify as is.

## Run it

It loads files from `data/`, so open it through a web server, not by double-clicking:

```
npx serve .            # or: python3 -m http.server 8000
```

To publish: drag this folder onto Netlify Drop, or point a Netlify site at it (no build command).

## What is real and what is filled in

| On screen | Where it comes from |
|---|---|
| Ground within 1 km of you (5 m grid) | NASA GSFC PGDA "High-Resolution LOLA Topography for Lunar South Pole Sites" 5 m maps (Barker et al. 2021), https://pgda.gsfc.nasa.gov/products/78 |
| Height ± number | Same product's height-error map |
| Hills and mountains out to 60 km | LRO LOLA polar elevation `LDEM_80S_80M` (PDS) |
| Skyline from 60 to 200 km (blocks Sun and Earth) | Same 80 m map, worked out ahead of time per site |
| Sun and Earth position, every hour for a year from 14 Nov 2026 | Team repo's `src/astro/` (Astronomy Engine, checked against NASA JPL Horizons) |
| Shadows, "is the rover in sun?", the week strip and stats | Worked out in the page from the real heights above (Moon's curvature included) |
| Starting view | Each site opens at the hour of the chosen week when the Sun is highest. The original's hills and view direction are turned to sit around that real Sun the way they sat around the original's made-up one. Shackleton and the ridge start on the highest drawn ground within 300 m of NASA's spot; Malapert starts on its real summit |
| Where you stand | Shackleton rim and Connecting ridge: centres of NASA's best-lit regions in that product. Malapert: our pick, the summit in the 5 m map |
| Smoothness of the ground you see | The drawn surface is the 5 m map smoothed over ~35 m (its cells carry ~0.4 m of noise, which flickers in low sunlight). Every number uses the unsmoothed map |
| Big smooth hills (Shackleton, ridge), craters (3-230 m), rolling relief, fine bumps, rocks, dust texture | **Added for looks**, using the original prototype's recipe and hill list, layered on top of the real ground. Malapert gets no made-up hills: it is a real 5 km mountain. On screen, shadows come from the big shapes only and are kept soft, like the original. The numbers (height, slope, sunlight, Earth in view) use NASA data only |
| Apollo 11 ground | **Illustrative.** No 5 m map baked for it yet; the page says so. Its Sun and Earth are real |
| Earth's appearance | Illustrative texture |
| Globe | NASA SVS CGI Moon Kit (LROC colour, LOLA relief) |

## Rebuilding the data

`tools/bake_terrain.py` cuts `data/<site>/near.bin`, `err.bin`, `far.bin` and `meta.json` from the NASA files
(the repo's `data/raw/`; get the PGDA files from the link above). `tools/bake_sky.mjs` writes `sky.bin` using the
repo's astro code. Both scripts explain their inputs at the top.

```
python3 tools/bake_terrain.py <repo>/data/raw data
node tools/bake_sky.mjs <repo> data
```

## Hooking it up to part one (site filters)

The page exposes a small `StreetView` object for the other half of the app:

```js
StreetView.goTo('malapert')        // open a site directly: shackleton, ridge, malapert, apollo11
StreetView.setSummary({            // fill the bottom-left box with whatever part one picked
  title: 'Why this site',
  items: [ { value: '82', unit: '%', label: 'Sunlight, Jan 2027' }, { value: '3.1', unit: '°', label: 'Average slope' } ]
})
StreetView.clearSummary()          // back to this week's sunlight numbers
```
