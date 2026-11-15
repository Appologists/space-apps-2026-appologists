# How it fits together

```
 mission (src/mission.js)        sites (data/sites.json + your own point)
        │                                   │
        ▼                                   ▼
 ephemeris for the window ──▶ sky at each site ──▶ criteria ──▶ ranking ──▶ panel, globe, site card
 (src/astro/ephemeris.js)     (src/astro/sky.js)  (src/criteria) (src/scoring)   (src/ui, src/globe)
```

1. **Mission.** When you land, for how long, how high the panel and antenna are.
2. **Ephemeris.** Where the Sun and Earth are relative to the Moon at every time step. Computed once per
   mission, because it does not depend on the site.
3. **Sky.** For one site, turn those positions into elevation above the horizon and compass direction.
   Cached per site.
4. **Criteria.** Each one turns a site and the mission into a score from 0 to 1, a headline number and a
   one-line summary. They do not know about each other, the weights or the screen.
5. **Ranking.** Weighted average of the scores.
6. **Screen.** `src/main.js` holds the state and tells the panel, globe and site card what to draw.

What triggers what: changing the mission reruns steps 2–5. Moving a weight reruns step 5 only. Moving the
time slider only changes what the globe and site card show.

## The rule that keeps this workable

`src/astro`, `src/criteria` and `src/scoring` contain no browser or 3D code. They run in Node, so they can be
tested and reused by scripts in `tools/`. The globe knows nothing about scoring; it is told where the Sun
is and which markers to draw, and reports clicks.

## Coordinates

One frame everywhere: the Moon's mean-Earth / polar-axis frame, as used by LRO maps and by JPL Horizons
(`MEAN_ME`). +X through 0° N 0° E (the middle of the near side), +Y through 90° E, +Z through the north
pole. Latitude north-positive, longitude east-positive in (-180°, 180°]. Heights are relative to a sphere
of radius 1737.4 km.

Azimuth is clockwise from north, like a compass. Elevation is above the horizon of a smooth sphere.

## Assumptions, and how good the numbers are

- **Positions:** Astronomy Engine for the Sun and Moon; the IAU rotation model for which way the Moon
  faces. Against JPL Horizons over 28 days at three sites, the largest difference was 0.004° in elevation or
  azimuth. Rerun with `npm run check:horizons`.
- **Horizon:** a smooth sphere. **No terrain.** A site in a crater and a site on a ridge at the same
  coordinates get the same answer. This is the main thing to fix.
- **Height above ground:** lowers the horizon by `acos(R / (R + h))`: 0.09° at 2 m, 0.19° at 10 m.
- **"Up"** means the centre of the body is above the horizon. The Sun's disc is 0.53° wide and Earth's about
  1.9°, so "partly up" lasts hours at the poles.
- **No atmosphere:** no refraction, no twilight.
- **Time steps:** 5 to 60 minutes depending on mission length (`stepMinutesFor`). Rise and set times are
  good to one step.
- **Light travel time and aberration** are applied to the Sun (they shift it by about 0.006°).

## Where terrain will plug in

A per-site horizon profile: for each compass direction, the elevation angle of the highest terrain. Then in
`visibilityStats` the flat threshold becomes "the horizon's elevation at the body's azimuth". `skySeries`
already returns azimuth for this reason. Slope, travel paths and shadowed regions come from the same
elevation data. See `data/README.md` for where derived files go.

## Terrain and the surface view

```
 data/raw/lola-south-80s-80m  ──▶  server/lola-polar.mjs  ──▶  /api/terrain/polar  ──▶  src/terrain/client.js
 (115 MB, not in git)              (dev server, Node)          (one patch per point)          │
                                                                                               ▼
                         horizonProfile() ──▶ real sunlight and Earth numbers        src/surface/surface-view.js
                         (src/terrain/polar-grid.js)                                  ground mesh, shadows, sky
```

- **The patch.** Terrain around the viewer on a polar grid: a spoke every 0.5° of compass direction, rings
  from 2 m to 300 km (close together nearby, 1 km apart far away). About 480,000 heights, 2 MB.
- **Curvature.** Each sample is placed where it really is relative to the viewer, on a Moon of radius
  1737.4 km: ground 50 km away sits 720 m below your level. This is why far mountains can hide behind a
  nearby rise, and why a peak can show from 130 km.
- **The real horizon.** For each spoke, the highest elevation angle any ring reaches (`horizonProfile`).
  A body is visible when its elevation is above the horizon at its azimuth (`terrainVisibility`).
- **Shadows.** The ground heights are resampled to two square grids (500 m cells for the whole patch, 30 m
  cells within 12 km). One pass across each grid, starting from the Sun's side, carries the shadow line
  downwind (`src/surface/shadows.js`). It is redone every time the Sun moves.
- **The sky.** The Sun and Earth are drawn at their computed direction and true angular size; the terrain
  hides them when it is in the way. Earth is a plain blue ball lit from the Sun's side, so its phase is right.

Checks we ran (2026-11-14):

- Crater floors sit at the catalogued crater centres (Shackleton −2,788 m, Shoemaker −3,932 m), and the
  mirror image of Shackleton is high ground, so east and west are not swapped.
- From Shackleton's floor the rim stands 20–24° above level all the way round. The Sun never climbs past
  about 1.6° there, so the floor is never lit: a permanently shadowed crater, as expected.
- Same method as Mazarico et al. (2011, Icarus 211), who built horizon profiles from 240 m LOLA maps and
  report a spot near Shackleton's rim that is sunlit for 240 days in a row each year, with a few metres of
  height making a large difference. At 89.45° S, 222.69° E (a rim location; coordinates from memory of that
  paper, not checked against it) we get, for 2026: lit 80% of the time at 2 m and 93% at 10 m, longest
  unbroken stretch 154 days. Same character, not a reproduction: we use 80 m data, the Sun's centre rather
  than any part of its disc, and one year rather than 18.6.

- **Lenses.** Instead of sunlight, the ground can be coloured by elevation or by slope
  (`src/surface/lenses.js`). Slope is computed by the server from the four terrain pixels around each sample,
  so it is steepness over 80 m. In a lens the shader also draws height contour lines (every 10 m and 100 m)
  and rings of equal distance from the viewer. Pointing at the ground walks along the line of sight until it
  meets the terrain and reads the height, slope and distance there.

The fine grain on the ground is decoration generated in the shader (`src/surface/ground-grain.js`), at scales
below 80 m only. It is not data.

What is missing: real detail finer than the data (80 m at the south pole, 59 m elsewhere with
`lola-global-512`), light bounced into shadow. Where no downloaded dataset has data within 300 km of the
viewer, the ground beyond is drawn flat and blue-grey, and the app says so.

### Which dataset answers a sample

```
 server/terrain-sources.mjs   the list of datasets, which are downloaded, and "best available" for a spot
        │ opens each with its reader, once
        ├─ server/lola-polar.mjs      south-pole grid, in memory (115 MB)
        ├─ server/equirect.mjs        whole-Moon float TIFFs, in memory (66 MB, 1 GB)
        └─ server/equirect-tiles.mjs  whole Moon at 59 m, sixteen 2.1 GB tiles, read from disk on demand
 server/composite.mjs         "best available": picks among them for each sample
 heightAt / sampleAt (server/lola-polar.mjs)   the two entry points everything else calls
```

- **The tiled reader.** The sixteen tiles are treated as one grid of 184,320 by 92,160 pixels, cut into
  blocks of 1024 by 128 pixels (256 kB). A block is read the first time a sample falls in it and kept in a
  cache capped at 1024 blocks (268 MB); when the cache is full, the quarter used longest ago is dropped. Only
  complete tiles are opened (the size must match, so a `.part` download is ignored), a missing tile gives no
  data, and the folder is looked at again every 15 s for tiles that have arrived.
- **How fine.** `heightAt(dem, lat, lon, wantM)` and `sampleAt(dem, lat, lon, out, wantM)` take the detail the
  caller needs, in metres per pixel. Only "best available" uses it: regional grids first where they cover,
  then the coarsest whole-Moon dataset that is still that fine, then finer ones, then coarser ones. The
  surface view's rings ask for the gap to the next ring; the finder's two grids ask for their cell size.
  Choosing one dataset in the picker bypasses all this and reads that dataset everywhere.
- **What it costs.** At Apollo 11 with every dataset downloaded, a surface view reads 23 blocks (6 MB) of
  59 m data and the rest from memory. With the 59 m data chosen by itself the same view reads 382 blocks
  (100 MB) and takes about 3 s the first time.

Check we ran (2026-11-14, `npm run check:tiles`, all 16 tiles): 3,000 points per tile against the 470 m
whole-Moon map gave correlations of 0.9998 to 1.0000, mean differences of at most 2.1 m and a spread of
13–23 m (the two maps differ in detail, not in place). The four southern tiles against the 80 m south-pole
grid between 80° and 88° S: correlation 1.0000, mean difference at most 0.1 m, spread 1.8–3.2 m.

## The landing-site finder

```
 form (src/ui/finder-form.js) ──▶ POST /api/terrain/landing-search ──▶ server/landing-search.mjs
                                                                              │ rasters (src/finder/wire.js)
 list of best sites, map with layers (src/finder/map-view.js) ◀──────────────┘
```

- **Grids.** A fine raster over the search area (80–200 m cells, at most about 400 across) and a coarse one
  (500 m cells) reaching 150 km further, both laid out flat around the search centre with the Moon's
  curvature in the heights. The fine raster is a small flat map, north up; `src/finder/grid.js` converts
  cells to latitude and longitude.
- **Time.** For each time step, the shadow sweep from the surface view gives the height of the lowest
  unblocked sunbeam above every cell. A panel standing above that height is lit. The same sweep with
  Earth's direction gives the Earth link for the antenna. About 340 steps per search.
- **Checks.** Slope at the cell, Sun and Earth at touchdown, longest run of darkness. Then every cell takes
  the worst result found anywhere within the landing accuracy, because the lander may come down anywhere
  in that circle.
- **Room to miss and sites.** Each cell's room to miss is its distance to the nearest ground that fails a check on its own; the ten passing cells with the most room, kept apart, are listed (decision Z).

Check we ran (2026-11-14, `npm run check:landing`): at 16 places round Shackleton's rim, over 14 days, the
finder and the slower point-by-point horizon method agreed to within 0.012 on the share of time sunlit,
0.033 on the share of time with Earth in view, and 5 hours on the longest darkness. The two methods share
the ephemeris, so this checks the terrain handling, not the Sun and Earth positions (those are checked
against JPL Horizons).

Known limits: the search blocks the dev server while it runs (about 10 s); darkness that starts before
landing or runs past the end of the mission is counted only inside the window; at marginal spots the
finder and the surface view can differ by a few percent, because they sample time and terrain differently.

**Reach and route** run in the browser on the finder's rasters (`src/finder/route.js`): a shortest-path search
over cells whose slope is within the rover's limit, stopping at the rover's range. A 400 by 400 raster takes
about 70 ms, so it is redone whenever the start, the destination or the rover changes.

## The drive planner

```
 start, destinations, rover ──▶ planMission() ──▶ plan: route, order, when to leave each cell
 (src/ui/finder-mode.js)        (src/finder/planner.js)      │
                                                             ▼
        map: route, stops, waits ◀── simulatePlan() replays it step by step ──▶ strip and words
        (src/finder/map-view.js)     (src/finder/schedule.js)                   (src/ui/finder-schedule.js, src/finder/plan-text.js)
```

It runs in the browser on the finder's rasters and the two per-step masks (`sunMask`, `earthMask`).

- **The rules** live in `schedule.js` (decision O): the rover leaves a cell only while that cell is sunlit (and
  sees Earth, if required), checked on the hour and at every cell it reaches; darkness is counted at the end of
  each step for the cell it last reached; too long a run of darkness and it is lost.
- **The search** is over place and time. For every cell the masks are first turned into its unbroken stretches
  of sunlight (once per search result). A state is "on this cell during this stretch": waiting inside a stretch
  costs nothing, so only the earliest moment the rover can be there is kept (plus, rarely, a slightly later one
  with less darkness behind it). From a state the rover can hop to a neighbour at once; wait and hop so that it
  arrives as the neighbour's next stretch of sunlight begins, or in the last dark hour before it; or stay
  through the dark until its own cell is lit again. States are taken in time order, so the first way found to
  each is the earliest.
- **Several destinations:** one such search per set of destinations already visited, each started from every
  way the smaller sets ended, so every order is covered (at most five destinations, 31 searches). A first quick
  pass in "nearest next" order gives a finishing time that lets the full pass stop early.
- **Distance and range:** every state remembers how far the rover has driven; ways that could no longer reach
  the remaining destinations within the range are dropped. After the earliest arrival is known, a second pass
  that also keeps shorter ways looks for a drive arriving in the same hour with less driving.
- **The replay is the judge.** The plan is a route plus, for each cell, the earliest time to leave it.
  `simulatePlan` drives it by the rules, and what the map, the strip and the text show is that replay. If the
  two ever disagree the plan carries `selfCheck: false` and the panel says so.
- **When nothing works** the planner tries again with one limit lifted at a time (darkness, range, Earth) and,
  for several destinations, each destination alone, and `plan-text.js` puts the result into words.

Simplifications, all on the safe side: the rover pauses only on cell centres; it starts a hop only when the
whole hop fits in one stretch of light; times are good to one step of the search (an hour for missions up to
14 days). It finds a workable plan and prefers the earliest arrival; it does not promise the best plan, and it
does not look for the safest one.

Checks we ran (2026-11-14): on 8,182 random maps of 16 to 25 cells an exhaustive search of every allowed drive
agreed with the planner on whether a plan exists and on the arrival hour, every time (400 of these run in
`npm test`). On a real search at Shackleton's rim (89.45° S, 137.31° W, 250 by 250 cells of 80 m, 337 hourly
steps) one destination took 35 to 290 ms and tours of three to five stops 0.5 to 3 s; every plan's replay
matched. Not checked: other sites, the coarser whole-Moon terrain, missions longer than 14 days.

## The mission steps

`src/ui/flow.js` is the walk-through in the left panel: Mission, Regions, Drive, Surface, Ride. It computes
nothing itself. It decides which view is on the stage and passes values between the pieces that do the work:

| Step | What does the work |
| --- | --- |
| 1 Mission | Fills the finder's values and the mission from a profile in `data/missions.json`, or from the big custom choices |
| 2 Regions | One landing search per region (`searchQuestion` in `src/finder/client.js` builds each question); the 3D Moon stays on the stage, turned to the chosen region, with every region marked by its result (`setRegions` in `src/globe/globe.js`); the finder's flat map comes in at step 3 |
| 3 Drive | The finder's reach, route and drive planner, unchanged. `src/finder/playback.js` turns a plan into "where is the rover at hour t" |
| 4 Surface | The surface view, opened at the rover's start |
| 5 Ride | The same surface view with `setPosition()` moving the viewpoint along the route |

Sections of `index.html` carry `data-steps="2 3"`; the flow shows the ones that list the current step.

**One clock.** Playback keeps hours after landing. It moves the app's time slider (so the globe and the
surface view's Sun follow), tells the map which time step's sunlight to draw (`setTime`, the `now` layer in
`map-layers.js`) and where the rover is (`setRover`). Moving the app's own slider feeds back into it. In the
ride the Sun steps three times a second, because each step redraws every shadow; the viewpoint moves every frame.

**The address.** `src/ui/flow-state.js` writes the step, profile, date, limits, region, start and destinations
into the part of the address after `#`, and reads them back on load. The flow then replays the steps up to
the saved one; with kept searches that takes about two seconds.

**Kept searches.** `server/terrain-plugin.mjs` keeps each search answer under a key made of the question
(keys sorted), the terrain data the search can read, and the modified dates of the search code. Answers live
in memory and in `node_modules/.cache/landing-search` (about 7 MB each, never committed). `npm run demo:warm`
asks every profile's seven searches of a running app, so a talk starts with them all kept.

**Stored sunlight and Earth maps.** Most of a search's time is the shadow sweep: which cells see the Sun and
which see Earth at every time step (`lightMaps` in `server/landing-search.mjs`). That depends only on the place,
the radius, the panel and antenna heights, the terrain and the times, not on any landing limit. `npm run
data:light` (`tools/precompute-light.mjs`) computes it hourly for every mission region over a stretch of dates
and writes one file per region to `data/raw/light/` (`server/light-store.mjs` has the layout). A search whose
place, radius, heights, terrain data and code fingerprint match, and whose times fall on whole hours inside the
stretch, reads its rows from there instead (the answer's header says `lightStored`), and computes everything
after the maps exactly as before. `npm run check:light` runs one region both ways and compares every number.
