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

## Next: the site-recommendation demo

| # | What | Notes | Who | Status |
| --- | --- | --- | --- | --- |
| 1 | **Terrain data pipeline** | A script in `tools/` that reads LOLA (`lola-south-80s-80m`) and writes small per-site files to `data/derived/`. Everything below marked (T) needs it. | | not started |
| 2 | **Real horizons** (T) | For each site, how high the terrain rises in each compass direction. Sunlight and Earth criteria then compare against that instead of a flat horizon. Biggest accuracy gain, and the heart of the challenge. | | not started |
| 3 | **Landing terrain** (T) | Slope and roughness at the site. Planned criterion `slope`. | | not started |
| 4 | **Travel paths** (T) | Ground a rover can reach without crossing slopes over a limit. Planned criterion `traverse`. | | not started |
| 5 | **Water ice access** | Distance to permanently shadowed ground. Planned criterion `water`. Needs a shadow map (can be derived in step 2) or published ice detections. | | not started |
| 6 | **Temperature** | "Base conditions" from the kickoff. Planned criterion `thermal`. Diviner data, or a simple model from Sun elevation, labelled as an estimate. | | not started |
| 7 | **Better site list** | CLPS targets, Artemis III candidate regions, other countries' targets, each with a source. Today's south-pole entries are crater centres, not landing sites. | | not started |
| 8 | **Side-by-side comparison** | Pick two or three sites: numbers and timelines next to each other, pros and cons. | | not started |
| 9 | **Date comparison** | Same site, different landing dates ("what if we slip two weeks?"). The challenge stresses this. | | not started |
| 10 | **Must-haves, not just weights** | "At least 100 h of unbroken sunlight", "Earth in view at landing": sites that fail are filtered out, not just scored lower. | | not started |

## Later, and stretch

- **Sky view** ("Street View"): look around from the site, see the horizon, the Sun and Earth's paths; step
  through time. Camera or eye height belongs here.
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
