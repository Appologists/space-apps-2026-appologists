# Data

## What is in git, and what is not

| Where | In git? | What |
| --- | --- | --- |
| `data/sites.json` | yes | The curated sites. Small, hand-edited, every entry has a source. |
| `data/catalog.json` | yes | The list of large datasets: address, size, format, licence. |
| `data/derived/` | yes, if small | Small files we compute from the large ones (a slope grid for the sites, a horizon profile per site). Keep each under about 5 MB and say in the file or beside it which script made it. |
| `data/raw/` | **no** | The large downloads themselves. Git-ignored. |
| `public/textures/` | yes | The 2.6 MB Moon map the globe needs to start. |

## Getting a dataset

```bash
npm run data:list
```

```bash
npm run data:fetch -- lola-south-80s-80m
```

Files land in `data/raw/<id>/`. A download is written to a `.part` file first and only renamed when its size
matches the catalog, so a broken download is never mistaken for a complete one. Anything over 500 MB needs
`--large`. `npm run data:check` asks the servers whether every file is still there, without downloading.

## Terrain the app can use

`server/terrain-sources.mjs` lists the elevation datasets the app knows how to read. The app's "Terrain data"
section shows them, marks the ones you have downloaded, and lets you choose one or "Best available".

| Dataset | Covers | Detail | Size |
| --- | --- | --- | --- |
| `lola-south-80s-80m` | 80° S to the south pole | 80 m | 115 MB |
| `lola-global-512` | the whole Moon, in 16 tiles | about 59 m | 34 GB on disk; under 300 MB of memory, because it is read a piece at a time |
| `ldem-64` | the whole Moon | about 470 m | 1.06 GB (and about 1 GB of memory while the app runs) |
| `ldem-16` | the whole Moon | about 1.9 km | 66 MB |

"Best available" uses the finest downloaded data near the spot and coarser data for ground far away, where
the view or the search samples it sparsely anyway (the rule is in `server/composite.mjs`). The south-pole grid
stays first wherever it covers. Far horizons are never cut off while a whole-Moon dataset is downloaded.

`lola-global-512` is sixteen tiles of 2.1 GB (90° of longitude by 45° of latitude each). It works with
whatever tiles are complete: the app says how many are here, places in the missing tiles simply have no 59 m
data, and tiles that finish downloading are picked up without a restart. Get it with
`npm run data:fetch -- lola-global-512 --large` (finished tiles are skipped if you run it again), and check
what you have against the other datasets with `npm run check:tiles`. Chosen by itself instead of "Best
available" it also reads 59 m data for far horizons, which takes seconds and about 100 MB of reading per view.

## Adding a dataset

Add an entry to `data/catalog.json`:

```json
{
  "id": "short-name",
  "title": "What it is, with resolution",
  "description": "What we use it for",
  "format": "File format, projection, units, and what zero means",
  "sourcePage": "https://… the page that documents it",
  "license": "Licence and the credit line to use",
  "files": [{ "url": "https://…", "bytes": 12345 }]
}
```

Run `npm run data:check` to confirm the address and size, and `npm test` to check the format. Add
`"sha256"` to a file if you want the download verified byte for byte; the fetch script prints it.

## From raw data to something the app can use

The browser cannot load a 100 MB elevation file. The pattern is:

1. `npm run data:fetch -- <id>` puts the raw file in `data/raw/`.
2. A script in `tools/` reads it and writes something small to `data/derived/`: for example, slope and a
   360-point horizon profile for each site in `data/sites.json`.
3. A criterion in `src/criteria/` imports the derived file.

Step 2 does not exist yet for criteria. It is the first job under "Next" in `docs/plan.md`.

There is a second pattern, already working, for things that need terrain at any point the user clicks: the
dev server reads the raw file itself and hands the browser just the piece it asks for.
`server/terrain-plugin.mjs` does this for the surface view (`GET /api/terrain/polar?lat=…&lon=…`), using
`lola-south-80s-80m`. If the file is not downloaded, the app says which command to run.

## The datasets in the catalog

- **CGI Moon Kit** (NASA SVS): global colour map and LOLA elevation at 4, 16 and 64 pixels per degree.
  Elevation is 32-bit float TIFF, kilometres relative to a 1737.4 km sphere, equirectangular, centred on
  0° longitude. Easiest place to start.
- **LOLA polar elevation** (NASA PDS Geosciences Node): south polar stereographic grids from 120 m down to
  5 m per pixel. Raw 16-bit integers; height in metres = value × 0.5. The `.lbl` file beside each image
  gives the size and projection.

Other sources worth a look, not yet in the catalog (addresses not checked by us): LROC NAC elevation models
for individual sites at 2–5 m, SLDEM2015 (LOLA plus Kaguya, 60° S to 60° N), LRO Diviner temperature maps,
and maps of permanently shadowed regions. NASA Moon Trek and LROC QuickMap, both listed on the challenge's
Resources tab, are the quickest way to browse them.
