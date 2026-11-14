# Decisions

Newest at the bottom. One entry per decision: what, when, why. If a decision changes, add a new entry that
says so; do not rewrite history.

## Made by the team

| # | Date | Decision | Why |
| --- | --- | --- | --- |
| 1 | 2026-11-13 | A web app that runs locally in the browser, using public data and APIs. | Quick to build, easy to demo. |
| 2 | 2026-11-13 | Minimum features: location, Sun and Earth position, base conditions such as temperature. Terrain next. A "Street View" of the sky is a stretch goal. | Covers the core of the challenge first. |
| 3 | 2026-11-13 | What makes us different: rank sites by *uninterrupted* sunlight. Six hours in one piece beats seven hours with a gap. | A gap is a night the lander must survive. |
| 4 | 2026-11-13 | Earth visibility is a criterion, so landers can send data home. | Direct-to-Earth communication, as in the challenge. |
| 5 | 2026-11-13 | Heights are user inputs: camera or eye, antenna, solar panel. | Height changes what is above the horizon. |
| 6 | 2026-11-14 | First demo: recommend landing sites from chosen characteristics (sunlight, terrain, travel paths, possibly water in the regolith). | Something judges can use end to end. |
| 7 | 2026-11-14 | Large datasets are not stored in git. The repo holds a catalog and a download script. | Keeps the repo small and clones fast. |

## Scaffold defaults, for the team to confirm or change

These were chosen to get a working skeleton. None is settled until the team says so.

| # | Default | Why | If you disagree |
| --- | --- | --- | --- |
| A | **Compute Sun and Earth positions in the browser** (Astronomy Engine) and use JPL Horizons as the check, not as the live source. The kickoff plan was to call Horizons directly. | Ranking 23 sites over 14 days needs about 30,000 positions; Horizons answers one site and one body per request and cannot be called from a browser without a proxy. Our numbers agree with Horizons to 0.004°. | `src/astro/horizons.js` already talks to Horizons; a criterion could use it instead, at the cost of speed. |
| B | **Vite, plain JavaScript modules, three.js, Vitest.** No UI framework. | Few moving parts; every AI tool and teammate can read it. | React or similar can be added without touching `src/astro`, `src/criteria` or `src/scoring`. |
| C | **Score = weighted average of 0–1 scores. Missing data is left out, never counted as zero.** | Honest about what we do not know. | Change `rankSites` in `src/scoring/rank.js`. |
| D | **"Sun up" means the centre of the Sun's disc is above the horizon**, lowered a little for panel height. | Simple and standard. The Sun's disc is 0.53° wide, which matters at the poles. | `minSunElevationDeg` in `src/mission.js`. |
| E | **Default mission: lands now, lasts 14 Earth days, panel and antenna at 2 m.** | Placeholders. | `defaultMission` in `src/mission.js`. |
| F | **The 2.6 MB Moon map stays in git.** | The app must start after `npm install` with nothing else to download. | Move it to the catalog. |
| G | **Terrain is served on demand by the dev server**, as a polar grid around the point: 720 compass directions, about 660 distances out to 300 km. | Lets you stand anywhere the data covers without preparing files first, and the same samples draw the ground and give the horizon. | Needs `npm run dev` and the 115 MB download. For a hosted demo, precompute patches for chosen sites into `data/derived/`. |
| H | **In the surface view, ground in shadow is drawn dark grey, not black.** | So you can see its shape. Real shadowed ground gets only faint light bounced from sunlit slopes. | `SHADOW_FILL` in `src/surface/surface-view.js`. |

## Open questions

- Which licence for the repo?
- Which sites should be on the list for the demo? (See plan, item 7.)
- How much terrain can we do in the time left: slope only, or real horizons?
