# Plan

The team's working list. Update a row when you start or finish something. "Who" is whoever picked it up.

## Works now

| What | Where |
| --- | --- |
| Rank sites by weighted criteria; move sliders to re-rank | `src/scoring/`, `src/ui/panel.js` |
| Uninterrupted sunlight (longest unbroken stretch, share of time lit) | `src/criteria/sunlight.js` |
| Direct-to-Earth communication (share of time Earth is up, longest pass) | `src/criteria/earth-comms.js` |
| Sun and Earth: elevation, compass direction, rises or sets in how long | `src/astro/sky.js`, `src/ui/detail.js` |
| Solar panel and antenna height change the horizon | `src/mission.js`, `horizonDipDeg` |
| 3D Moon: sites, your own point by click or coordinates, day and night for any time | `src/globe/` |
| Time slider and Play across the mission | `src/main.js` |
| Check against JPL Horizons, in the app and from the command line | `src/astro/horizons.js`, `tools/check-horizons.mjs` |
| Large-dataset catalog and download | `data/catalog.json`, `tools/fetch-data.mjs` |
| **Surface view** ("Street View"), 80° S to the pole: stand at a site or any clicked point, look around, real terrain and cast shadows, Sun and Earth with their paths over the mission, eye height | `src/surface/`, `src/ui/surface-mode.js` |
| Real horizon at the viewed point, and what it does to the mission's sunlight and Earth contact (shown in the surface view only) | `src/terrain/polar-grid.js` |
| Terrain service: the dev server cuts terrain around any point from the 115 MB LOLA file | `server/` |
| **Reach and route** (stage 2 of the mission wizard): on the finder's map, the ground a rover can reach from a start within its slope limit and range, and the shortest drivable path to a destination with distance, driving time, steepest slope, climb, and the worst darkness and Earth link along the way. Computed in the browser, so changing the rover updates it at once | `src/finder/route.js`, `src/ui/finder-mode.js` |
| **Landing-site finder** (stage 1 of the mission wizard): give the landing accuracy, slope limit, longest darkness survived and whether Earth and Sun are needed at touchdown; it searches 10–40 km round the selected point (about 10 s) and maps where every point of the landing ellipse passes, lists the best sites, and has layers for sunlight share, longest darkness, Earth link and slope | `server/landing-search.mjs`, `src/finder/`, `src/ui/finder-mode.js` |
| Surface-view lenses: colour the ground by **elevation** or **slope**, with a legend, height contour lines and distance rings; point at any spot to read its height, slope and distance | `src/surface/lenses.js`, `src/surface/ground-grain.js` |

## Next: the site-recommendation demo

| # | What | Notes | Who | Status |
| --- | --- | --- | --- | --- |
| 1 | **Terrain data pipeline** | Reading LOLA works (`server/lola-polar.mjs`), served on demand by the dev server. Still to do for (T) items: a script in `tools/` that writes small per-site files to `data/derived/`, so criteria can use terrain without the dev server. | | partly done |
| 2 | **Real horizons in the ranking** (T) | The surface view already computes the real horizon for the point you stand on (`horizonProfile`, `terrainVisibility`). Next: do it for every site and have the sunlight and Earth criteria use it, so the ranked list stops assuming a smooth Moon. Biggest accuracy gain, and the heart of the challenge. | | half done |
| 3 | **Landing terrain** (T) | Slope and roughness at the site. Planned criterion `slope`. | | not started |
| 4 | **Travel paths** (T) | Ground a rover can reach without crossing slopes over a limit. Planned criterion `traverse`. | | not started |
| 5 | **Water ice access** | Distance to permanently shadowed ground. Planned criterion `water`. Needs a shadow map (can be derived in step 2) or published ice detections. | | not started |
| 6 | **Temperature** | "Base conditions" from the kickoff. Planned criterion `thermal`. Diviner data, or a simple model from Sun elevation, labelled as an estimate. | | not started |
| 7 | **Better site list** | CLPS targets, Artemis III candidate regions, other countries' targets, each with a source. Today's south-pole entries are crater centres, not landing sites. | | not started |
| 8 | **Side-by-side comparison** | Pick two or three sites: numbers and timelines next to each other, pros and cons. | | not started |
| 9 | **Date comparison** | Same site, different landing dates ("what if we slip two weeks?"). The challenge stresses this. | | not started |
| 14 | **Mission wizard, stage 3: schedule** | A route with arrival and departure times that stays in sunlight and Earth contact and waits out shadows; several targets in a sensible order. Shadows move while the rover drives, so this finds a workable plan, not the best one. Stage 2's route ignores time: it reports the worst darkness and Earth link along the path over the whole mission, not at the hour the rover passes. | | not started |
| 15 | **Finder follow-ups** | Use the finder's terrain-aware numbers in the ranked list (today the list still assumes a smooth Moon, so found sites are listed separately). Compare landing dates. Run the search off the dev server's main thread so the page stays responsive. | | not started |
| 11 | **Lenses over time** | The surface view can already tell, for any moment, which ground is in sunlight (`src/surface/shadows.js`). Run it across a lunar day (about 120 steps, roughly 10 s) and colour the ground by: share of time sunlit (never-lit ground in its own colour), longest unbroken darkness, and share of time with Earth in view. These answer "where can a rover survive and talk?" better than a single moment does. **Done as map layers in the landing-site finder; not yet as lenses in the surface view.** Note the season matters: the Sun's height at the poles swings by about ±1.5° over a year. | | not started |
| 12 | **Solar panel model** | "Sunlit" is only the first half of power. Add the panel: tracking the Sun, fixed and facing one way, or flat. At the poles a flat panel gets a few percent of what a Sun-facing one does. | | not started |
| 10 | **Must-haves, not just weights** | "At least 100 h of unbroken sunlight", "Earth in view at landing": sites that fail are filtered out, not just scored lower. | | not started |

## Later, and stretch

- **Surface view, next steps:** it works from 80° S to the pole. Ideas: finer terrain near the pole (the 20 m
  and 5 m LOLA files), coverage elsewhere (global LOLA is 0.5–2 km per pixel), a photo or texture on the
  ground, Earth drawn as a real globe, day marks along the Sun's path, walking or driving, and speed (each
  time step costs roughly 50–90 ms because the shadows are recomputed).
- **Power estimate:** Sun elevation and Sun distance to watts for a given panel. Sun distance is already in
  the ephemeris (`sunDistanceAU`).
- **Polar map for close-ups:** the colour map is blurry at the poles. A LOLA shaded-relief layer would fix it.
- **Shaded "good zones" on the globe:** score a grid of points, not just named sites.
- **2D polar map** beside the globe.
- **Explain mode** for the public: why the south pole, why a few metres of height matter.
- **Publish it:** the app is static after `npm run build`, except the Horizons check, which needs the dev server.

## Before we submit

- Choose a licence for the repo and check the Space Apps rules on open source.
- Check every source in `data/sites.json` against a primary source (some are from Wikipedia).
- Credits, and a statement on our use of AI tools if the Space Apps submission form asks for one.
- Try the app on someone outside the team.
