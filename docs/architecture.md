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

What is missing: real detail finer than 80 m, light bounced into shadow, any terrain north of 80° S (if the data
ends within 300 km of the viewer, the ground beyond is drawn flat and blue-grey, and the app says so).

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
- **Score and sites.** Passing cells are scored like the ranked list; the ten best, kept apart, are listed.

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
