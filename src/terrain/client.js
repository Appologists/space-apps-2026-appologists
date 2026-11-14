// Browser side of the terrain service (server/terrain-plugin.mjs).
import { decodePatch } from './polar-grid.js';

let infoPromise = null;

/** Is terrain data installed on this machine, and what does it cover? Asked once and remembered. */
export function terrainInfo() {
  infoPromise ??= fetch('/api/terrain/info')
    .then((r) => (r.ok ? r.json() : { available: false, hint: null }))
    .catch(() => ({ available: false, hint: null }));
  return infoPromise;
}

/** True if the installed data covers this latitude (the 80 m grid reaches from 80° S to the pole). */
export const terrainCovers = (info, lat) => !!info?.available && lat <= info.coversSouthOfLat;

/**
 * Terrain around a point.
 * @returns {Promise<import('./polar-grid.js').TerrainPatch>}
 */
export async function fetchTerrainPatch(lat, lon) {
  const response = await fetch(`/api/terrain/polar?lat=${lat}&lon=${lon}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error([body.error ?? `Terrain request failed (HTTP ${response.status})`, body.hint ? `Run: ${body.hint}` : ''].filter(Boolean).join(' '));
  }
  return decodePatch(await response.arrayBuffer());
}
