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
| Starting view | Each site opens at the hour of the chosen week when the Sun is highest, facing the same way from that real Sun each time. Shackleton, the ridge and Malapert start on the highest real ground within 300 m of the spot; a spot from the finder starts exactly on it |
| Where you stand | Shackleton rim and Connecting ridge: centres of NASA's best-lit regions in that product. Malapert: our pick, the summit in the 5 m map |
| Smoothness of the ground you see | The drawn surface is the 5 m map smoothed over ~35 m (its cells carry ~0.4 m of noise, which flickers in low sunlight). Every number uses the unsmoothed map |
| Craters under 30 m across, fine bumps, rocks, dust texture | **Added for looks**, on top of the real ground: smaller than NASA's map can show. Nothing bigger is made up (no hills, no rolling ground, no big craters; team decision 9), so the hills and the skyline are the real ones. The hover text of the "You are standing at" card says this, and so does the wrist panel in VR (it is no longer drawn over the picture: decision 10). The numbers (height, slope, sunlight, Earth in view) use the real map only |
| Apollo 11 ground | **Made up.** No 5 m map baked for it yet; the hover text says so. Its Sun and Earth are real |
| Earth's appearance; size of the Sun and Earth | Illustrative texture. Both discs are drawn larger than life (Sun 2.4 times, Earth 1.6 times) so they can be seen; the label says so. The numbers use their true sizes |
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

## VR (Meta Quest)

The street view has an **Enter VR** button (top right). It uses WebXR, so it runs in the Meta Quest's built-in
browser: open the page's https link (Netlify), go to a site, press Enter VR.

| In the headset | Does |
|---|---|
| Left stick | Walk where you are looking (hold left grip to go faster) |
| Right stick | Turn in 30° steps |
| Right trigger | Point at the ground, let go to teleport there |
| A | Play / pause time |
| B / X | Time +6 h / −6 h |
| Y | Leave VR |
| Left wrist | Raise it to your face like a watch to see the live readouts (Sun, Earth, in sun?, call home?, height, slope). Click the left stick to pin it on |

In VR the page uses lighter settings (fewer shadow steps, smaller shadow map) so the Quest can keep up.
It has only been tested in an emulator so far; check speed and comfort on a real headset.

**Trying it without a headset**
- Install Meta's free **Immersive Web Emulator** extension in Chrome, open the page, pick a site, press Enter VR.
  The extension's panel moves the virtual headset and controllers.
- Or add `?vr-test` to the address (e.g. `index.html?vr-test`): the page loads the same emulator by itself, no
  install. Don't use `?vr-test` together with the extension.
- WebXR needs https or localhost. On a Quest without deploying: enable developer mode, connect USB, run
  `adb reverse tcp:8000 tcp:8000`, start a local server on port 8000 and open `localhost:8000` in the Quest browser.

