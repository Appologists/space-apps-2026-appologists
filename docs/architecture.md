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
