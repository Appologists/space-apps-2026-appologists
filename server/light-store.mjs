// Sunlight and Earth maps computed in advance for the mission regions (tools/precompute-light.mjs), so a
// landing search there reads them instead of sweeping shadows hour by hour, which is most of its time.
//
// One file per region in data/raw/light/ (git-ignored): an 8-byte lead ("LUNL" and the header's length), a JSON
// header, then the Sun bits and the Earth bits for every hour of the stored window, one row of `maskStride`
// bytes per hour (the layout of a search's sunMask and earthMask). A stored map stands in for a computed one
// only when everything it depends on matches: the place, the search radius, the panel and antenna heights, the
// terrain data and the code that computes it (`key`). The search then takes the rows for its own hours.
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LIGHT_VERSION } from './landing-search.mjs';

const MAGIC = 'LUNL';
const FAR_MARGIN_KM = 150; // how far beyond its area a search reads terrain (FAR_MARGIN_M in landing-search.mjs)
/** The code the maps depend on: a change to any of these makes stored maps stale. */
const LIGHT_CODE = [
  'server/landing-search.mjs#LIGHT_VERSION',
  'server/lola-polar.mjs',
  'server/composite.mjs',
  'server/equirect.mjs',
  'server/equirect-tiles.mjs',
  'src/surface/shadows.js',
  'src/finder/grid.js',
  'src/astro/ephemeris.js',
  'src/astro/sky.js',
  'src/astro/coords.js',
];

export const lightDir = (root) => path.join(root, 'data', 'raw', 'light');

/** A short fingerprint of the code above (file contents, not dates, so a fresh checkout matches). */
export function lightCodeKey(root) {
  const hash = createHash('sha1').update(`v${LIGHT_VERSION}`);
  for (const file of LIGHT_CODE) {
    if (file.includes('#')) continue; // landing-search.mjs counts through LIGHT_VERSION, not its whole text
    try {
      hash.update(readFileSync(path.join(root, file)));
    } catch {
      hash.update(`missing:${file}`);
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/**
 * Which downloaded terrain an answer depends on. A search wholly inside a regional grid (its far ground too)
 * reads nothing else; one whose own area is inside it reads other data only for far ground, from a complete
 * whole-Moon map when one is there; anything else may read whatever is downloaded, tile by tile.
 * Shared with the kept answers in terrain-plugin.mjs.
 */
export function terrainDataKey(store, params, found) {
  const { center, radiusKm = 10 } = params;
  const edge = found.source.southOfLat;
  const sources = store.list();
  const inside = (km) => edge != null && center.lat <= edge - (km / 30.3 + 0.2);
  const wholeMoonFar = sources.some((s) => s.installed && !s.incomplete && s.southOfLat == null && s.pixelM <= 500);
  return inside(radiusKm + FAR_MARGIN_KM)
    ? found.source.id
    : inside(radiusKm) && wholeMoonFar
      ? sources.map((s) => `${s.id}:${s.installed && !s.incomplete}`)
      : sources.map((s) => `${s.id}:${s.installed}:${s.coverage}`);
}

/** Everything a stored map must match, as one string. `p` is a search's full parameters. */
export function lightKey(p, { dataKey, codeKey }) {
  return JSON.stringify([p.center.lat, p.center.lon, p.radiusKm, p.panelHeightM, p.antennaHeightM, dataKey, codeKey]);
}

/** Write one region's maps. `start` is the first stored hour (ISO time); masks hold `hours` rows each. */
export function writeLight(file, { key, regionId, start, hours, maskStride }, sunMask, earthMask) {
  const header = { version: LIGHT_VERSION, key, regionId, start, hours, maskStride };
  let json = Buffer.from(JSON.stringify(header));
  const pad = (8 - ((8 + json.length) % 8)) % 8;
  json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
  const lead = Buffer.alloc(8);
  lead.write(MAGIC, 0, 'ascii');
  lead.writeUInt32LE(json.length, 4);
  const bytes = (mask) => Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength);
  writeFileSync(file, Buffer.concat([lead, json, bytes(sunMask), bytes(earthMask)]));
}

function readHeader(file) {
  const fd = openSync(file, 'r');
  try {
    const lead = Buffer.alloc(8);
    if (readSync(fd, lead, 0, 8, 0) < 8 || lead.toString('ascii', 0, 4) !== MAGIC) return null;
    const length = lead.readUInt32LE(4);
    const json = Buffer.alloc(length);
    readSync(fd, json, 0, length, 8);
    const header = JSON.parse(json.toString('utf8'));
    const rows = header.hours * header.maskStride;
    return { ...header, sunAt: 8 + length, earthAt: 8 + length + rows };
  } finally {
    closeSync(fd);
  }
}

/**
 * @param {string} dir  where the region files are (lightDir(root))
 * @returns {{find: (p: object, keys: {dataKey: any, codeKey: string}, series: {samples: any[]}) => ({sunMask: Uint8Array, earthMask: Uint8Array}|null), count: () => number}}
 */
export function createLightStore(dir) {
  let files = new Map(); // file -> { mtimeMs, header }
  let checkedAt = -Infinity;

  function refresh() {
    if (performance.now() - checkedAt < 2000) return; // a new or rewritten file is noticed within two seconds
    checkedAt = performance.now();
    const next = new Map();
    let names = [];
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.bin'));
    } catch {
      // No stored maps yet.
    }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        const { mtimeMs } = statSync(file);
        const known = files.get(file);
        const header = known && known.mtimeMs === mtimeMs ? known.header : readHeader(file);
        if (header?.version === LIGHT_VERSION) next.set(file, { mtimeMs, header });
      } catch {
        // A file being written, or not ours: skip it.
      }
    }
    files = next;
  }

  /** The rows for exactly the search's times, or null when no stored map matches or covers them. */
  function find(p, keys, series) {
    refresh();
    if (!(p.stepMinutes > 0) || p.stepMinutes % 60 !== 0) return null; // stored hourly; a 90-minute step cannot be read
    const every = p.stepMinutes / 60;
    const key = lightKey(p, keys);
    const startMs = Date.parse(p.start);
    const steps = series.samples.length;
    for (const [file, { header }] of files) {
      if (header.key !== key) continue;
      const first = (startMs - Date.parse(header.start)) / 3_600_000;
      if (!Number.isInteger(first) || first < 0 || first + (steps - 1) * every >= header.hours) continue;
      const stride = header.maskStride;
      const sunMask = new Uint8Array(steps * stride);
      const earthMask = new Uint8Array(steps * stride);
      const fd = openSync(file, 'r');
      try {
        if (every === 1) {
          readSync(fd, sunMask, 0, steps * stride, header.sunAt + first * stride);
          readSync(fd, earthMask, 0, steps * stride, header.earthAt + first * stride);
        } else {
          for (let i = 0; i < steps; i++) {
            const row = first + i * every;
            readSync(fd, sunMask, i * stride, stride, header.sunAt + row * stride);
            readSync(fd, earthMask, i * stride, stride, header.earthAt + row * stride);
          }
        }
      } finally {
        closeSync(fd);
      }
      return { sunMask, earthMask };
    }
    return null;
  }

  return {
    find,
    count: () => {
      refresh();
      return files.size;
    },
  };
}
