// Browser side of the terrain service (server/terrain-plugin.mjs).
import { decodePatch } from './polar-grid.js';

let infoPromise = null;

/** Which terrain datasets exist and which are downloaded on this machine. Asked once and remembered. */
export function terrainInfo() {
  infoPromise ??= fetch('/api/terrain/info')
    .then((r) => (r.ok ? r.json() : { available: false, sources: [], hint: null }))
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

async function loadPatch(lat, lon, sourceId) {
  const response = await fetch(`/api/terrain/polar?lat=${lat}&lon=${lon}&source=${encodeURIComponent(sourceId)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error([body.error ?? `Terrain request failed (HTTP ${response.status})`, body.hint ? `Run: ${body.hint}` : ''].filter(Boolean).join(' '));
  }
  return decodePatch(await response.arrayBuffer());
}
