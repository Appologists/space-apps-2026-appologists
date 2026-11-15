# Plan

The team's working list. Update a row when you start or finish something. "Who" is whoever picked it up.

## Works now

| What | Where |
| --- | --- |
| **Mission steps** (the demo's five views, in the left panel): 1 Mission (a ready-made profile with sourced numbers, or big custom choices), 2 Regions (seven candidate regions near the south pole, each searched on real terrain for that mission; the list says which can take the landing and why the others cannot; the 3D Moon turns to the chosen region and marks each region by its result), 3 Drive (start, destinations, "Suggest a drive", and the trip played back while the map shows which ground is sunlit hour by hour, with a timeline beside the map from touchdown, one row each time the rover starts doing something else, a bar for its time in the dark and "Next change"), 4 Surface (stand at the landing spot), 5 Ride (the surface view moves along the route, with credits). The older tools are off the page unless the address has `?tools`. The address keeps the step, mission, region and drive, so a reload or a bookmark comes back to it. Searches are kept by the dev server; `npm run demo:warm` asks them all in advance | `src/ui/flow.js`, `src/ui/flow-state.js`, `src/finder/playback.js`, `data/missions.json`, `data/credits.json`, `tools/warm-demo.mjs` |
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
| **Drive planner** (stage 3 of the mission wizard): click up to five destinations; it chooses the route, the visiting order and the waiting together for the earliest arrival. The rover leaves a spot only while it is sunlit there (and sees Earth, if required), may wait in sunlight for the way ahead to light up or take a longer way round, and must not sit in darkness longer than it survives. The map shows the route, the stops and where it waits; the panel says in words what happens, or why no drive works and which limit is in the way. "Leave no earlier than" and "Find the latest time to leave" replace the old departure hour (both off the demo page since 2026-11-14: the rover leaves at landing; `latestDeparture()` still exists). One destination plans in about 0.1 to 0.3 s, five in one to three | `src/finder/planner.js`, `src/finder/schedule.js`, `src/finder/plan-text.js`, `src/ui/finder-schedule.js` |
| **Route choices and directions** (on top of the drive planner): three cards like a road map's, **Safest** (gentler slopes and a 30% darkness margin), **Fastest** (the planner) and **Shortest** (ignores sunlight; often gets the rover lost, which shows why the planner is needed). The chosen route is coloured by slope on the map, the other two are dashed, and the 500 m landing area is circled. Below the cards: a height profile coloured by slope, and step-by-step directions (leave, drive 1.3 km S, wait 42 h for the way ahead to light up, edge 2.3 km between moving shadows, arrive). When no drive works, a warning box says why in plain words (destination too steep, walled in, beyond range, too long in the dark, or the rover freezes after arriving), with what to change and a button for the map layer that shows it; the spots in the way are ringed on the map and an ✕ marks where the sunlight-blind shortest route would get the rover lost. Its hour-by-hour drive story now lives in "Play the drive" (decision S): a bar for the unbroken time in the dark against what the rover survives, one sentence on what the rover is doing and why, and "Next change". The height profile and directions are folded under the cards so Play stays on screen | `src/finder/route-options.js`, `src/finder/directions.js`, `src/finder/why-not.js`, `src/ui/route-options-panel.js` |
| **Terrain data picker**: the app lists the terrain datasets it can read, which are downloaded and how to get the others; choose one, or "Best available". Whole-Moon data (470 m or 1.9 km) makes the surface view and the finder work anywhere, at coarser detail | `server/terrain-sources.mjs`, `server/equirect.mjs`, `src/ui/terrain-picker.js` |
| **Whole Moon at 59 m** (`lola-global-512`, 34 GB in 16 tiles): read a piece at a time from whatever tiles are downloaded, so it needs under 300 MB of memory. "Best available" uses it near the spot and coarser data far away; the south-pole grid stays first where it covers. At Apollo 11 the surface view opens in about 2 s and a 10 km search takes about 12 s, the same as with the other datasets | `server/equirect-tiles.mjs`, `server/composite.mjs`, `tools/check-tiles.mjs` |
| **Reach and route** (stage 2 of the mission wizard): on the finder's map, the ground a rover can reach from a start within its slope limit and range, and the shortest drivable path to a destination with distance, driving time, steepest slope, climb, and the worst darkness and Earth link along the way. Computed in the browser, so changing the rover updates it at once | `src/finder/route.js`, `src/ui/finder-mode.js` |
| **Landing-site finder** (stage 1 of the mission wizard): give the landing accuracy, slope limit, longest darkness survived and whether Earth and Sun are needed at touchdown; it searches 10–40 km round the selected point (about 10 s) and maps where every point of the landing ellipse passes, lists the best sites, and has layers for sunlight share, longest darkness, Earth link and slope | `server/landing-search.mjs`, `src/finder/`, `src/ui/finder-mode.js` |
| Surface-view lenses: colour the ground by **elevation** or **slope**, with a legend, height contour lines and distance rings; point at any spot to read its height, slope and distance | `src/surface/lenses.js`, `src/surface/ground-grain.js` |
| **Flask version, no npm** (`lunar-planner/`): live Horizons ranking with must-have and weights, CesiumJS surface on LOLA terrain with the Moon Trek photo, heatmaps (elevation, slope, temperature estimate), Earth and Sun views, missions and quiz | `lunar-planner/` |

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
| 14 | **Drive planner, next steps** | Done 2026-11-14: route, order and timing chosen together (see "Works now"); since decision U a drive succeeds on reaching its last destination. Still open: the rover stays at the last destination (no return trip, no "visit and come back"); it never crosses a shadow, however narrow (a battery model would allow short crossings); it goes for the earliest arrival, so a plan can use the whole darkness allowance (partly answered by the "Safest" route choice, decision R); darkness after the mission's end is not looked at; several destinations freeze the page for a second or two (move it to a worker); the timing is not animated on the map. | | first version done |
| 16 | **Whole Moon at 59 m, follow-ups** | Reading it works (see "Works now"). Left: the finder's cells are never finer than 80 m (`searchGrid`), so a search does not yet use the full 59 m. All 16 tiles are downloaded and pass `npm run check:tiles`, including against the 80 m south-pole grid. | | reading done |
| 15 | **Finder follow-ups** | Use the finder's terrain-aware numbers in the ranked list (today the list still assumes a smooth Moon, so found sites are listed separately). Compare landing dates. Run the search off the dev server's main thread so the page stays responsive. | | not started |
| 11 | **Lenses over time** | The surface view can already tell, for any moment, which ground is in sunlight (`src/surface/shadows.js`). Run it across a lunar day (about 120 steps, roughly 10 s) and colour the ground by: share of time sunlit (never-lit ground in its own colour), longest unbroken darkness, and share of time with Earth in view. These answer "where can a rover survive and talk?" better than a single moment does. **Done as map layers in the landing-site finder; not yet as lenses in the surface view.** Note the season matters: the Sun's height at the poles swings by about ±1.5° over a year. | | not started |
| 12 | **Solar panel model** | "Sunlit" is only the first half of power. Add the panel: tracking the Sun, fixed and facing one way, or flat. At the poles a flat panel gets a few percent of what a Sun-facing one does. | | not started |
| 17 | **Mission steps, follow-ups** | Open: region points for NASA's Artemis III candidate regions (NASA publishes names only, so two come from an LPSC 2024 abstract and five are crater centres: measuring centres from the USGS navigation grids would be better); the ride runs at about 18 frames a second and redraws shadows three times a second; the ride keeps the landing spot's sky and terrain (fine for a few km, not for a 20 km drive); a first search of seven regions takes about 80 s (search them in a worker, or in parallel). | | first version done |
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
