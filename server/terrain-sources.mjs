// The terrain datasets the app can use, which of them are downloaded, and which serve a given spot.
// Node only (dev server and tools). To add a dataset: add it to data/catalog.json so it can be downloaded,
// then add an entry here saying how to open it and what it covers.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { makeComposite } from './composite.mjs';
import { openEquirectTiles, tilesOnDisk } from './equirect-tiles.mjs';
import { openEquirect } from './equirect.mjs';
import { heightAt, openLolaPolar } from './lola-polar.mjs';

/**
 * Best first: where two datasets both have data and nothing says otherwise, the earlier one is used.
 * `southOfLat`: the dataset covers latitudes at or below this; null means the whole Moon.
 * `tiles`: for a dataset that comes in tiles and works with only some of them, a function that says which
 * are on disk. Such a dataset counts as downloaded once one tile is complete.
 */
export const SOURCES = [
  {
    id: 'lola-south-80s-80m',
    label: 'South pole, 80 m',
    coverage: '80° S to the south pole',
    southOfLat: -80,
    pixelM: 80,
    sizeText: '115 MB',
    files: ['ldem_80s_80m.img', 'ldem_80s_80m.lbl'],
    fetch: 'npm run data:fetch -- lola-south-80s-80m',
    open: (dir, id) => openLolaPolar({ imgPath: path.join(dir, 'ldem_80s_80m.img'), lblPath: path.join(dir, 'ldem_80s_80m.lbl'), id }),
  },
  {
    id: 'lola-global-512',
    label: 'Whole Moon, 59 m',
    coverage: 'the whole Moon',
    southOfLat: null,
    pixelM: 59,
    sizeText: '34 GB in 16 tiles',
    fetch: 'npm run data:fetch -- lola-global-512 --large',
    note: 'Read from disk a piece at a time, so it uses under 300 MB of memory. Chosen by itself it is slow for far horizons; "Best available" uses it near you and coarser data far away.',
    tiles: (dir) => tilesOnDisk(dir),
    open: (dir, id) => openEquirectTiles({ dir, id }),
  },
  {
    id: 'ldem-64',
    label: 'Whole Moon, 470 m',
    coverage: 'the whole Moon',
    southOfLat: null,
    pixelM: 474,
    sizeText: '1.06 GB',
    files: ['ldem_64.tif'],
    fetch: 'npm run data:fetch -- ldem-64 --large',
    note: 'Uses about 1 GB of memory while the app runs.',
    open: (dir, id) => openEquirect({ path: path.join(dir, 'ldem_64.tif'), id }),
  },
  {
    id: 'ldem-16',
    label: 'Whole Moon, 1.9 km',
    coverage: 'the whole Moon',
    southOfLat: null,
    pixelM: 1895,
    sizeText: '66 MB',
    files: ['ldem_16.tif'],
    fetch: 'npm run data:fetch -- ldem-16',
    open: (dir, id) => openEquirect({ path: path.join(dir, 'ldem_16.tif'), id }),
  },
];

const covers = (source, lat) => source.southOfLat == null || lat <= source.southOfLat;
// A regional grid joins "best available" when the spot is within this many degrees of its edge: the surface
// view reaches 300 km (9.9°) and the landing search about as far.
const REACH_DEG = 11;

/** @param {string} root the project folder (the one holding data/raw) */
export function createTerrainStore(root) {
  const dirOf = (source) => path.join(root, 'data', 'raw', source.id);
  const installed = (source) =>
    source.tiles ? source.tiles(dirOf(source)).present.length > 0 : source.files.every((file) => existsSync(path.join(dirOf(source), file)));
  /** What the app is told about a dataset, including how much of it is on this computer. */
  const describe = (source) => {
    const { open: _open, files: _files, tiles, ...meta } = source;
    if (!tiles) return { ...meta, installed: installed(source) };
    const { present, total } = tiles(dirOf(source));
    if (present.length === 0 || present.length === total) return { ...meta, installed: present.length > 0 };
    return {
      ...meta,
      installed: true,
      incomplete: true,
      coverage: `${meta.coverage}, but only ${present.length} of its ${total} tiles are downloaded`,
      note: `Places in the missing tiles have no data from it. ${meta.note ?? ''}`.trim(),
    };
  };
  const opened = new Map(); // id -> Promise of the opened dataset; each is opened once and kept
  const open = (source) => {
    if (!opened.has(source.id)) {
      opened.set(
        source.id,
        Promise.resolve()
          .then(() => source.open(dirOf(source), source.id))
          .catch((error) => {
            opened.delete(source.id);
            throw error;
          }),
      );
    }
    return opened.get(source.id);
  };

  return {
    /** Every known dataset, for the app's picker. */
    list: () => SOURCES.map(describe),

    /**
     * The terrain to use at a point.
     * @param {number} lat
     * @param {string} [sourceId] a dataset id, or 'auto' for the best available
     * @param {number} [lon] with it, "best available" can name the dataset that really has data at the point
     * @returns {Promise<{dem: object, source: object} | {missing: object} | {outside: object}>}
     *   `missing`: that dataset is not downloaded. `outside`: it does not cover the latitude.
     */
    async demFor(lat, sourceId = 'auto', lon = null) {
      if (sourceId && sourceId !== 'auto') {
        const source = SOURCES.find((s) => s.id === sourceId);
        if (!source) throw new Error(`Unknown terrain data "${sourceId}"`);
        if (!installed(source)) return { missing: source };
        if (!covers(source, lat)) return { outside: source };
        return { dem: await open(source), source: describe(source) };
      }
      const usable = SOURCES.filter(installed);
      if (usable.length === 0) return { missing: SOURCES[0] };
      if (!usable.some((source) => covers(source, lat))) return { outside: usable[0] };
      // Best available: every downloaded whole-Moon dataset, plus regional grids near enough to matter.
      // server/composite.mjs picks among them sample by sample.
      const used = usable.filter((source) => source.southOfLat == null || lat <= source.southOfLat + REACH_DEG);
      const dems = await Promise.all(used.map(open));
      // The result is labelled with the best dataset that has data at the spot itself (a tiled dataset may
      // lack the tile). Without a longitude, or with no data there at all, the best that covers the latitude.
      const here = used.map((source, i) => covers(source, lat) && (lon == null || !Number.isNaN(heightAt(dems[i], lat, lon))));
      let primary = here.indexOf(true);
      if (primary < 0) primary = used.findIndex((source) => covers(source, lat));
      if (used.length === 1) return { dem: dems[0], source: describe(used[0]) };
      const entries = used.map((source, i) => ({ dem: dems[i], pixelM: source.pixelM, regional: source.southOfLat != null }));
      const id = [used[primary].id, ...used.filter((_, i) => i !== primary).map((source) => source.id)].join('+');
      return { dem: makeComposite(entries, { id, pixelM: used[primary].pixelM }), source: describe(used[primary]) };
    },
  };
}
