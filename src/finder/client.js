// Browser side of the landing-site finder (server/landing-search.mjs, served by server/terrain-plugin.mjs).
import { decodeRasters } from './wire.js';

/**
 * Ask the dev server to search an area. Takes roughly 5–20 seconds.
 * @param {import('./types.js').FinderParams} params
 * @returns {Promise<import('./types.js').FinderResult>}
 */
export async function searchLanding(params) {
  let response = await fetch('/api/terrain/landing-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => null);
  // The hosted website has no server: it reads the searches saved ahead of time (tools/export-static.mjs).
  if (!response || response.status === 404 || response.status === 405 || !response.headers.get('content-type')?.match(/octet|json/)) {
    const saved = await fetch(`/static/landing/${await staticKey(params)}.bin`).catch(() => null);
    if (!saved?.ok || saved.headers.get('content-type')?.includes('text/html')) {
      throw new Error('This mission is not saved on the website. The ready-made missions are; for your own settings, run the app on a computer (npm run dev).');
    }
    response = saved;
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error([body.error ?? `Search failed (HTTP ${response.status})`, body.hint ? `Run: ${body.hint}` : ''].filter(Boolean).join(' '));
  }
  const { header, rasters } = decodeRasters(await response.arrayBuffer());
  // `kept`: the server had already answered this exact question and sent the same answer again.
  return { ...header, ...rasters, kept: response.headers.get('x-landing-search') === 'kept' };
}

/**
 * The whole question for one search: where, the mission, and the landing limits. One place builds it, so the
 * app and tools/warm-demo.mjs ask in exactly the same words (the server keeps answers by question).
 * The rover's numbers are left out: they do not change which ground can take a landing.
 * @param {Object} q
 * @param {{lat: number, lon: number, searchRadiusKm?: number}} q.center  a region may bring its own search radius
 * @param {Object} q.values     the finder's values (score.js defaultFinder)
 * @param {{start: Date, durationHours: number, panelHeightM: number, antennaHeightM: number}} q.mission
 * @param {string} [q.source]   terrain dataset id, or 'auto'
 * @returns {import('./types.js').FinderParams}
 */
export function searchQuestion({ center, values, mission, source = 'auto' }) {
  const landing = Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('rover')));
  return {
    ...landing,
    radiusKm: center.searchRadiusKm ?? landing.radiusKm, // the crater regions search wider, to reach their rims
    source,
    center: { lat: center.lat, lon: center.lon },
    start: mission.start.toISOString(),
    durationHours: mission.durationHours,
    stepMinutes: finderStepMinutes(mission.durationHours),
    panelHeightM: mission.panelHeightM,
    antennaHeightM: mission.antennaHeightM,
  };
}

/** A time step that keeps a mission to about 340 Sun/Earth checks, and never finer than an hour. */
export function finderStepMinutes(durationHours) {
  return Math.max(60, Math.ceil((durationHours * 60) / 340 / 30) * 30);
}

/** The same value with every object's keys sorted, so the same question always reads the same. */
const inOrder = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, inOrder(value[key])]))
    : value;

/** File name of a saved search on the hosted website: SHA-1 of the question (browser and Node alike). */
export async function staticKey(params) {
  const bytes = new TextEncoder().encode(JSON.stringify(inOrder(params)));
  const hash = await globalThis.crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
