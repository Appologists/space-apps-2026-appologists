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

Step 2 does not exist yet. It is the first job under "Next" in `docs/plan.md`.

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
