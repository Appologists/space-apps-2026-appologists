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
import { encodeRasters } from '../src/finder/wire.js';
import { encodePatch } from '../src/terrain/polar-grid.js';
import { searchLanding } from './landing-search.mjs';
import { samplePolarPatch } from './lola-polar.mjs';
import { createTerrainStore } from './terrain-sources.mjs';

export function terrainApi({ root = process.cwd() } = {}) {
  const store = createTerrainStore(root);

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
  async function terrainFor(res, lat, sourceId) {
    const found = await store.demFor(lat, sourceId || 'auto');
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
        const found = await terrainFor(res, lat, url.searchParams.get('source'));
        if (!found) return undefined;
        const patch = samplePolarPatch(found.dem, lat, lon);
        if (!patch) return json(res, 404, { error: `No terrain data at this point: "${found.source.label}" covers ${found.source.coverage}.` });
        return binary(res, encodePatch({ ...patch, sourceLabel: found.source.label }));
      }
      if (url.pathname === '/landing-search' && req.method === 'POST') {
        const params = JSON.parse(await readBody(req));
        if (!Number.isFinite(params?.center?.lat) || !Number.isFinite(params?.center?.lon) || !params.start || !(params.durationHours > 0)) {
          return json(res, 400, { error: 'center, start and durationHours are required' });
        }
        const found = await terrainFor(res, params.center.lat, params.source);
        if (!found) return undefined;
        const result = searchLanding(found.dem, params);
        if (!result) return json(res, 404, { error: `No terrain data at the centre of the search: "${found.source.label}" covers ${found.source.coverage}.` });
        result.header.sourceLabel = found.source.label;
        return binary(res, encodeRasters(result.header, result.rasters));
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
