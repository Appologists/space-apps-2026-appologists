// Dev-server plugin that serves terrain to the app from the big files in data/raw/.
//
//   GET  /api/terrain/info                    which terrain datasets exist, and which are downloaded
//   GET  /api/terrain/polar?lat=&lon=&source= the ground around a point, as a polar grid (binary; see
//                                             encodePatch/decodePatch in src/terrain/polar-grid.js)
//   POST /api/terrain/landing-search          the landing-site finder (JSON in: see src/finder/types.js;
//                                             rasters out: src/finder/wire.js). Takes several seconds.
//
// `source` is a dataset id from server/terrain-sources.mjs, or "auto" (the default) for the best available.
// Like the Horizons proxy, this only exists while `npm run dev` or `npm run preview` is running.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeRasters } from '../src/finder/wire.js';
import { encodePatch } from '../src/terrain/polar-grid.js';
import { searchLanding } from './landing-search.mjs';
import { samplePolarPatch } from './lola-polar.mjs';
import { createTerrainStore } from './terrain-sources.mjs';

export function terrainApi({ root = process.cwd() } = {}) {
  const store = createTerrainStore(root);

  // ---- Kept answers ---------------------------------------------------------------------------------------
  // A search takes 10 to 20 seconds and the same question comes back whenever someone steps back or reloads,
  // so answers are kept: in memory, and on disk under node_modules/.cache (never committed). The key holds
  // everything the answer depends on: the question, the terrain data used, and the search code's own dates.
  const cacheDir = path.join(root, 'node_modules', '.cache', 'landing-search');
  const kept = new Map(); // key -> bytes, newest last
  const KEEP_IN_MEMORY = 16;
  const SEARCH_CODE = ['server/landing-search.mjs', 'server/lola-polar.mjs', 'server/composite.mjs', 'src/finder/score.js', 'src/finder/grid.js', 'src/surface/shadows.js'];
  const FAR_MARGIN_KM = 150; // how far beyond its area a search reads terrain (FAR_MARGIN_M in landing-search.mjs)
  function searchKey(params, found) {
    const code = SEARCH_CODE.map((file) => {
      try {
        return statSync(path.join(root, file)).mtimeMs;
      } catch {
        return 0;
      }
    });
    // Which downloads can change the answer? A search wholly inside a regional grid (its far ground too) reads
    // nothing else. One whose own area is inside it reads other data only for far ground, at 500 m: that comes
    // from a complete whole-Moon map when one is there, so a tile of finer data arriving changes nothing.
    // Anything else may read whatever is downloaded, tile by tile.
    const { center, radiusKm = 10 } = params;
    const edge = found.source.southOfLat;
    const sources = store.list();
    const inside = (km) => edge != null && center.lat <= edge - (km / 30.3 + 0.2);
    const wholeMoonFar = sources.some((s) => s.installed && !s.incomplete && s.southOfLat == null && s.pixelM <= 500);
    const data = inside(radiusKm + FAR_MARGIN_KM)
      ? found.source.id
      : inside(radiusKm) && wholeMoonFar
        ? sources.map((s) => `${s.id}:${s.installed && !s.incomplete}`)
        : sources.map((s) => `${s.id}:${s.installed}:${s.coverage}`);
    return createHash('sha1').update(JSON.stringify([params, data, code])).digest('hex');
  }
  function readKept(key) {
    if (kept.has(key)) return kept.get(key);
    try {
      const bytes = readFileSync(path.join(cacheDir, `${key}.bin`));
      remember(key, bytes);
      return bytes;
    } catch {
      return null;
    }
  }
  function remember(key, bytes) {
    kept.delete(key);
    kept.set(key, bytes);
    while (kept.size > KEEP_IN_MEMORY) kept.delete(kept.keys().next().value);
  }
  function keep(key, bytes) {
    remember(key, bytes);
    try {
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(path.join(cacheDir, `${key}.bin`), bytes);
    } catch {
      // No disk cache then; the answer is still kept in memory.
    }
  }

  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  };
  const binary = (res, bytes) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/octet-stream');
    res.end(Buffer.from(bytes));
  };
  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let text = '';
      req.on('data', (chunk) => {
        text += chunk;
        if (text.length > 100_000) reject(new Error('Request too large'));
      });
      req.on('end', () => resolve(text));
      req.on('error', reject);
    });

  /** The terrain for a request, or null after answering with the reason it cannot be served. */
  async function terrainFor(res, lat, lon, sourceId) {
    const found = await store.demFor(lat, sourceId || 'auto', lon);
    if (found.dem) return found;
    if (found.missing) json(res, 404, { error: `Terrain data "${found.missing.label}" is not downloaded yet.`, hint: found.missing.fetch });
    else json(res, 404, { error: `No terrain data at this point: "${found.outside.label}" covers ${found.outside.coverage}.` });
    return null;
  }

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/info') {
        const sources = store.list();
        return json(res, 200, { sources, available: sources.some((s) => s.installed), hint: sources[0].fetch });
      }
      if (url.pathname === '/polar') {
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: 'lat and lon are required' });
        const found = await terrainFor(res, lat, lon, url.searchParams.get('source'));
        if (!found) return undefined;
        const patch = samplePolarPatch(found.dem, lat, lon);
        if (!patch) return json(res, 404, { error: `No terrain data at this point: "${found.source.label}" covers ${found.source.coverage}.` });
        // With "best available", far rings are read from coarser data; the app's notes say so.
        const sourceNote = found.dem.detailVaries ? 'Ground far from you is read from coarser data, in step with how sparsely it is sampled.' : undefined;
        return binary(res, encodePatch({ ...patch, sourceLabel: found.source.label, sourceNote }));
      }
      if (url.pathname === '/landing-search' && req.method === 'POST') {
        const params = JSON.parse(await readBody(req));
        if (!Number.isFinite(params?.center?.lat) || !Number.isFinite(params?.center?.lon) || !params.start || !(params.durationHours > 0)) {
          return json(res, 400, { error: 'center, start and durationHours are required' });
        }
        const found = await terrainFor(res, params.center.lat, params.center.lon, params.source);
        if (!found) return undefined;
        const key = searchKey(params, found);
        const earlier = readKept(key);
        if (earlier) {
          res.setHeader('x-landing-search', 'kept'); // the browser says so beside the result
          return binary(res, earlier);
        }
        const result = searchLanding(found.dem, params);
        if (!result) return json(res, 404, { error: `No terrain data at the centre of the search: "${found.source.label}" covers ${found.source.coverage}.` });
        result.header.sourceLabel = found.source.label;
        if (found.dem.detailVaries) result.header.sourceNote = 'Mountains beyond the search area, which can block a low Sun, are read from coarser data (500 m cells).';
        const bytes = encodeRasters(result.header, result.rasters);
        keep(key, bytes);
        return binary(res, bytes);
      }
      return next();
    } catch (error) {
      return json(res, 500, { error: error.message });
    }
  }

  return {
    name: 'terrain-api',
    configureServer: (server) => void server.middlewares.use('/api/terrain', handle),
    configurePreviewServer: (server) => void server.middlewares.use('/api/terrain', handle),
  };
}
