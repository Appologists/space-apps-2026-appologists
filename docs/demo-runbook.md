# Runbook: setting up a machine to show the demo

Do this once on any machine that will show the app, in this order. About 15 minutes, most of it waiting.
Large files go to `data/raw/` and are never committed.

| # | Step | Command | Takes | Check |
| --- | --- | --- | --- | --- |
| 1 | Node.js 22.12 or newer, then the packages | `npm install` | 1 min | `node --version` |
| 2 | South-pole terrain (needed) | `npm run data:fetch -- lola-south-80s-80m` | 115 MB | `npm run data:list` shows it |
| 3 | Whole-Moon terrain for far mountains (recommended) | `npm run data:fetch -- ldem-16` | 66 MB | `npm run data:list` shows it |
| 4 | Sunlight and Earth maps for the seven regions | `npm run data:light` | 5 min, 344 MB | `npm run check:light` ends "Same answer, number for number." |
| 5 | Start the app | `npm run dev` | seconds | It prints the address (normally http://localhost:5173) |
| 6 | Ask the ready-made missions' searches in advance (second terminal, app running) | `npm run demo:warm` (add `-- --port 5190` if the app is on another port) | 30 s | Every region says "already kept" or "searched and kept"; none says FAILED or NOT kept |
| 7 | Walk the tabs once in the browser: "Find regions that fit", then Moon, Site, Street view, Ride | | 2 min | Best regions lists 5 of 7 with sites for the Pre-set mission; Ride plays and the credits roll |

Step 4 is what makes a search in the seven regions take about a second instead of 10 to 20. Without it the app
still works, just slowly: a minute or two before the Regions step has all seven regions.

## When to redo a step

- **After pulling changes to the search code** (the files listed in `server/light-store.mjs`, or
  `LIGHT_VERSION` in `server/landing-search.mjs`): redo step 4, then step 6. The app does not use stale maps; it
  quietly computes instead, so searches turn slow again. `npm run check:light` says so.
- **After downloading more terrain:** redo step 4. Regions near 85° S read far mountains from whatever is
  downloaded, so the stored maps must match it.
- **Landing dates outside 14 Nov 2026 to 15 Jan 2027:** run step 4 with your own stretch, for example
  `npm run data:light -- --from 2027-02-01 --to 2027-03-15`.
- **Before each talk:** step 6 is enough if the app was only restarted (kept answers stay on disk).

## If a search is slow

- `npm run check:light` with the app's region and date (`-- --region malapert --start 2026-12-24T00:00Z`):
  "No stored maps cover..." means step 4 has not been run for that region and date, or needs redoing.
- A landing time that is not on the hour (from the date picker's minutes) cannot use the stored hourly maps.
  Use the "−1 hour" / "+1 hour" buttons to set the time.
- Missions longer than two weeks are checked in steps longer than an hour. Steps of a whole number of hours
  read the stored maps (if the stretch covers the whole mission); others, such as 90 minutes, compute.
