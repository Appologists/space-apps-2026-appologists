// Browser side of the terrain service (server/terrain-plugin.mjs).
import { decodePatch } from './polar-grid.js';

let infoPromise = null;

/** Which terrain datasets exist and which are downloaded on this machine. Asked once and remembered. */
export function terrainInfo() {
  // The hosted website has no server: it reads what the searches used from a saved copy (tools/export-static.mjs).
  const saved = () => fetch('/static/terrain-info.json').then((r) => (r.ok ? r.json() : { available: false, sources: [], hint: null }));
  infoPromise ??= fetch('/api/terrain/info')
    .then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : saved()))
    .catch(() => ({ available: false, sources: [], hint: null }));
  return infoPromise;
}

/** The downloaded datasets a choice stands for: one dataset, or all of them for 'auto' (best available). */
const usable = (info, sourceId) => (info?.sources ?? []).filter((s) => s.installed && (!sourceId || sourceId === 'auto' || s.id === sourceId));

/** True if the chosen terrain data covers this latitude. */
export const terrainCovers = (info, lat, sourceId = 'auto') => usable(info, sourceId).some((s) => s.southOfLat == null || lat <= s.southOfLat);

/** What the chosen terrain data covers, in words. */
export function coverageText(info, sourceId = 'auto') {
  const list = usable(info, sourceId);
  if (list.length === 0) return 'nothing yet';
  if (list.some((s) => s.southOfLat == null)) return 'the whole Moon';
  return `${Math.abs(Math.max(...list.map((s) => s.southOfLat)))}° S to the south pole`;
}

/** The name a saved spot goes by on the hosted website (tools/export-static.mjs): its place to 5 decimals, about a metre. */
export const savedSpot = (lat, lon) => `${Number(lat).toFixed(5)}_${Number(lon).toFixed(5)}`;

/** True if this is the terrain service's answer, not a missing address or a host's stand-in page. */
const fromService = (response) => !!response && ![404, 405, 501].includes(response.status) && !response.headers.get('content-type')?.includes('text/html');

/**
 * Terrain around a point.
 * @param {string} [sourceId] a dataset id, or 'auto' for the best available
 * @returns {Promise<import('./polar-grid.js').TerrainPatch>}
 */
export function fetchTerrainPatch(lat, lon, sourceId = 'auto') {
  // Kept for a while: the landing-date scan, the drive's start and the surface view often ask for the same spot.
  const key = `${(+lat).toFixed(5)},${(+lon).toFixed(5)},${sourceId}`;
  if (patchCache.has(key)) {
    const kept = patchCache.get(key);
    patchCache.delete(key); // most recently used goes to the back
    patchCache.set(key, kept);
    return kept;
  }
  const promise = loadPatch(lat, lon, sourceId).catch((error) => {
    patchCache.delete(key);
    throw error;
  });
  patchCache.set(key, promise);
  while (patchCache.size > PATCH_CACHE_SIZE) patchCache.delete(patchCache.keys().next().value);
  return promise;
}

const PATCH_CACHE_SIZE = 24; // about 2 MB each
const patchCache = new Map();

/** Forget the kept terrain (for tests). */
export const forgetTerrainPatches = () => patchCache.clear();

async function loadPatch(lat, lon, sourceId) {
  let response = await fetch(`/api/terrain/polar?lat=${lat}&lon=${lon}&source=${encodeURIComponent(sourceId)}`).catch(() => null);
  if (!fromService(response)) {
    // The hosted website has no server: it reads the ground saved ahead of time at each region's first landing
    // sites (tools/export-static.mjs), which is where the ride starts unless the start was moved.
    const saved = await fetch(`/static/polar/${savedSpot(lat, lon)}.bin`).catch(() => null);
    if (!saved?.ok || saved.headers.get('content-type')?.includes('text/html')) {
      throw new Error('The ground around this spot is not saved on the website. It is saved at each region\'s first landing sites; for any other spot, run the app on a computer (npm run dev).');
    }
    response = saved;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error([body.error ?? `Terrain request failed (HTTP ${response.status})`, body.hint ? `Run: ${body.hint}` : ''].filter(Boolean).join(' '));
  }
  return decodePatch(await response.arrayBuffer());
}
