// The terrain datasets the app can use, which of them are downloaded, and which serves a given spot.
// Node only (dev server and tools). To add a dataset: add it to data/catalog.json so it can be downloaded,
// then add an entry here saying how to open it and what it covers.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openEquirect } from './equirect.mjs';
import { openLolaPolar } from './lola-polar.mjs';

/**
 * Finest first: "best available" tries them in this order.
 * `southOfLat`: the dataset covers latitudes at or below this; null means the whole Moon.
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

/** @param {string} root the project folder (the one holding data/raw) */
export function createTerrainStore(root) {
  const dirOf = (source) => path.join(root, 'data', 'raw', source.id);
  const installed = (source) => source.files.every((file) => existsSync(path.join(dirOf(source), file)));
  const opened = new Map(); // id -> Promise of the loaded data; each dataset is read once and kept in memory
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
    list: () => SOURCES.map(({ open: _open, files: _files, ...meta }) => ({ ...meta, installed: installed(SOURCES.find((s) => s.id === meta.id)) })),

    /**
     * The terrain to use at a latitude.
     * @param {number} lat
     * @param {string} [sourceId] a dataset id, or 'auto' for the best available
     * @returns {Promise<{dem: object, source: object} | {missing: object} | {outside: object}>}
     *   `missing`: that dataset is not downloaded. `outside`: it does not cover the latitude.
     */
    async demFor(lat, sourceId = 'auto') {
      if (sourceId && sourceId !== 'auto') {
        const source = SOURCES.find((s) => s.id === sourceId);
        if (!source) throw new Error(`Unknown terrain data "${sourceId}"`);
        if (!installed(source)) return { missing: source };
        if (!covers(source, lat)) return { outside: source };
        return { dem: await open(source), source };
      }
      const usable = SOURCES.filter(installed);
      if (usable.length === 0) return { missing: SOURCES[0] };
      const primary = usable.find((source) => covers(source, lat));
      if (!primary) return { outside: usable[0] };
      // Best available: the finest dataset covering the spot. If that one has edges (the polar grid stops at
      // 80° S), the finest whole-Moon dataset fills in beyond them, so far horizons are not cut off.
      const filler = primary.southOfLat == null ? null : usable.find((source) => source.southOfLat == null);
      if (!filler) return { dem: await open(primary), source: primary };
      const sources = await Promise.all([open(primary), open(filler)]);
      return { dem: { kind: 'composite', id: `${primary.id}+${filler.id}`, pixelM: primary.pixelM, sources }, source: primary };
    },
  };
}
