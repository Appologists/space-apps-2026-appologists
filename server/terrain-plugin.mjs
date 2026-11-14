// Dev-server plugin that serves terrain to the app from the big files in data/raw/.
//
//   GET /api/terrain/info                    is terrain data installed, and what does it cover?
//   GET /api/terrain/polar?lat=-89.5&lon=0   the ground around a point, as a polar grid (binary; see
//                                            encodePatch/decodePatch in src/terrain/polar-grid.js)
//   POST /api/terrain/landing-search         the landing-site finder (JSON in: see src/finder/types.js;
//                                            rasters out: src/finder/wire.js). Takes several seconds.
//
// Like the Horizons proxy, this only exists while `npm run dev` or `npm run preview` is running.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { encodePatch } from '../src/terrain/polar-grid.js';
import { encodeRasters } from '../src/finder/wire.js';
import { searchLanding } from './landing-search.mjs';
import { openLolaPolar, samplePolarPatch } from './lola-polar.mjs';

const DATASET = 'lola-south-80s-80m';
const FETCH_HINT = `npm run data:fetch -- ${DATASET}`;

export function terrainApi({ root = process.cwd() } = {}) {
  const dir = path.join(root, 'data', 'raw', DATASET);
  const files = { imgPath: path.join(dir, 'ldem_80s_80m.img'), lblPath: path.join(dir, 'ldem_80s_80m.lbl') };
  const installed = () => existsSync(files.imgPath) && existsSync(files.lblPath);
  let demPromise = null; // loaded on first use and kept in memory (115 MB)
  const dem = () => (demPromise ??= openLolaPolar({ ...files, id: DATASET }).catch((e) => ((demPromise = null), Promise.reject(e))));

  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
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

  async function handle(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/info') {
        if (!installed()) return json(res, 200, { available: false, dataset: DATASET, hint: FETCH_HINT });
        const { label } = await dem();
        return json(res, 200, { available: true, dataset: DATASET, pixelM: label.scaleM, coversSouthOfLat: label.edgeLat });
      }
      if (url.pathname === '/polar') {
        const lat = parseFloat(url.searchParams.get('lat'));
        const lon = parseFloat(url.searchParams.get('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json(res, 400, { error: 'lat and lon are required' });
        if (!installed()) return json(res, 404, { error: 'Terrain data is not downloaded yet.', hint: FETCH_HINT });
        const patch = samplePolarPatch(await dem(), lat, lon);
        if (!patch) return json(res, 404, { error: 'No terrain data at this point. The 80 m data covers 80° S to the south pole.' });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(Buffer.from(encodePatch(patch)));
      }
      if (url.pathname === '/landing-search' && req.method === 'POST') {
        if (!installed()) return json(res, 404, { error: 'Terrain data is not downloaded yet.', hint: FETCH_HINT });
        const params = JSON.parse(await readBody(req));
        if (!Number.isFinite(params?.center?.lat) || !Number.isFinite(params?.center?.lon) || !params.start || !(params.durationHours > 0)) {
          return json(res, 400, { error: 'center, start and durationHours are required' });
        }
        const found = searchLanding(await dem(), params);
        if (!found) return json(res, 404, { error: 'No terrain data at the centre of the search. The 80 m data covers 80° S to the south pole.' });
        res.statusCode = 200;
        res.setHeader('content-type', 'application/octet-stream');
        return res.end(Buffer.from(encodeRasters(found.header, found.rasters)));
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
