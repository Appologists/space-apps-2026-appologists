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
export async function fetchTerrainPatch(lat, lon, sourceId = 'auto') {
  const response = await fetch(`/api/terrain/polar?lat=${lat}&lon=${lon}&source=${encodeURIComponent(sourceId)}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error([body.error ?? `Terrain request failed (HTTP ${response.status})`, body.hint ? `Run: ${body.hint}` : ''].filter(Boolean).join(' '));
  }
  return decodePatch(await response.arrayBuffer());
}
