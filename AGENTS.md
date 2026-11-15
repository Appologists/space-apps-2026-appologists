# Guide for AI coding tools (and new teammates)

This is a hackathon project: NASA Space Apps 2026, "Lunar Landing Site Navigator". Read `README.md` for
what it is, `docs/plan.md` for what to build next and `docs/architecture.md` for how it fits together.

## Commands

**Setting up a machine to show the demo:** follow [`docs/demo-runbook.md`](docs/demo-runbook.md) step by step
(terrain, `npm run data:light`, `npm run demo:warm`). Tell the person if a step has not been done.

- `npm run dev` runs the app. `npm test` must pass before you say a change is done.
- `npm run check:horizons` compares our Sun/Earth maths with NASA JPL Horizons. Run it after touching
  `src/astro/`.
- `npm run data:light` (once, after downloading terrain; about 5 minutes) stores which ground sees the Sun and
  Earth, hour by hour, for the seven mission regions from 14 Nov 2026 to 15 Jan 2027 (`data/raw/light/`, not in
  git). A search there then answers in about a second, for any landing limits and any whole-hour landing time
  in that stretch. Rerun it after changing the code listed in `server/light-store.mjs`; `npm run check:light`
  checks that stored and computed answers are the same.
- `npm run demo:warm` (with the app running) asks every search the ready-made missions need, so they are kept
  and the steps open at once. Run it before showing the app to anyone.
- `npm run check:landing` after changing the landing search; `npm run check:tiles` after changing how the
  59 m whole-Moon tiles are read (it compares them with the other terrain datasets you have downloaded).

## Where a change goes

- A new way to score sites: one new file in `src/criteria/`, registered in `src/criteria/index.js`.
  Follow `docs/adding-a-criterion.md`. Do not put scoring logic in the UI or the globe.
- A new user input (a constraint, a height, a limit): add it to `src/mission.js`, then a field in
  `src/ui/panel.js`.
- A new site: `data/sites.json`. A new large dataset: `data/catalog.json`.
- A script that prepares data: `tools/`, with small results written to `data/derived/`.
- Anything that reads the big files in `data/raw/` while the app runs: `server/` (it runs inside the dev
  server; see `server/terrain-plugin.mjs`). The browser asks it for small pieces.
- The view from the ground: `src/surface/`. Terrain maths shared by browser and server: `src/terrain/`.
- The landing-site finder: rules and scoring in `src/finder/score.js`, the search itself in
  `server/landing-search.mjs`, the map in `src/finder/map-view.js`. Its data contract is `src/finder/types.js`.
  After changing the search, run `npm run check:landing`.
- The drive planner: the rover's rules and the step-by-step replay in `src/finder/schedule.js`, the search in
  `src/finder/planner.js`, its words in `src/finder/plan-text.js`. All three are pure (no browser code) and
  tested; `tests/finder-planner.test.js` checks the search against an exhaustive one on small maps.
- The mission steps (the five views in the left panel): `src/ui/flow.js` says which view is on the stage and
  runs the playback clock; it computes nothing. A new ready-made mission or region: `data/missions.json`, each
  number with a source. What the address keeps: `src/ui/flow-state.js`. Credits: `data/credits.json`.
- The education page (`/learn`): `education/`. `npm run dev` serves it with its data through
  `server/learn-plugin.mjs` (no Python); the Python app in `lunar-planner/` serves it too. The plugin also
  pulls origin/main every minute on branch `main` (live sync; `LUNAR_SYNC=0` turns it off).
- A new lens (a way to colour the ground in the surface view): one entry in `src/surface/lenses.js`, which
  also states the colour rules every lens follows. The switch and legend appear by themselves.

## Rules

1. **Never invent data.** If a criterion has no data for a site, return `score: null`. The ranking leaves it
   out; it is never counted as zero and never guessed. Estimates are fine when the result says so in `caveats`.
2. **Every site, dataset and number has a source.** Sites name one in `data/sites.json`. Science claims in
   the UI or docs need a source or the words "our estimate".
3. **Say what a number leaves out.** Today that is terrain: every sunlight and Earth result carries a caveat
   that the horizon is a smooth sphere. Keep caveats honest when you add things.
4. **No large files in git.** Anything over about 5 MB goes in `data/catalog.json` and is downloaded with
   `npm run data:fetch`. `data/raw/` is git-ignored.
5. **One coordinate convention.** Moon-fixed mean-Earth/polar-axis frame, latitude north-positive, longitude
   east-positive in (-180, 180], degrees. Many datasets use 0–360° E: convert at the edge with `wrapLon`.
   The 3D mesh uses a different axis order; only `src/globe/globe.js` knows about it.
6. **Keep `src/astro/`, `src/criteria/`, `src/scoring/`, `src/terrain/polar-grid.js` and
   `src/surface/shadows.js` free of browser and three.js code** so they run in tests and in Node scripts.
   `server/` is the opposite: Node only, never imported by the browser.
7. **Build the page with the `h()` helper in `src/ui/dom.js`, not `innerHTML`.**
8. **Add a test with each criterion or maths change.** Tests live in `tests/` and run in Node.
9. Plain words in the UI and docs. Times are UTC and say so.

## Keeping the team in sync

- When you finish or start something, update its row in `docs/plan.md`.
- When the team settles a question, add it to `docs/decisions.md` with the date and the reason.
- Pull before you start and before you push. Keep commits small and say what changed and why.
