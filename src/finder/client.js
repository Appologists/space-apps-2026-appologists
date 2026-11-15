// Browser side of the landing-site finder (server/landing-search.mjs, served by server/terrain-plugin.mjs).
import { decodeRasters } from './wire.js';

/**
 * Ask the dev server to search an area. Takes roughly 5–20 seconds.
 * @param {import('./types.js').FinderParams} params
 * @returns {Promise<import('./types.js').FinderResult>}
 */
export async function searchLanding(params) {
  const response = await fetch('/api/terrain/landing-search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
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
 * @param {{lat: number, lon: number}} q.center
 * @param {Object} q.values     the finder's values (score.js defaultFinder)
 * @param {{start: Date, durationHours: number, panelHeightM: number, antennaHeightM: number}} q.mission
 * @param {Object<string, number>} q.weights
 * @param {string} [q.source]   terrain dataset id, or 'auto'
 * @returns {import('./types.js').FinderParams}
 */
export function searchQuestion({ center, values, mission, weights, source = 'auto' }) {
  const landing = Object.fromEntries(Object.entries(values).filter(([key]) => !key.startsWith('rover')));
  return {
    ...landing,
    source,
    center: { lat: center.lat, lon: center.lon },
    start: mission.start.toISOString(),
    durationHours: mission.durationHours,
    stepMinutes: finderStepMinutes(mission.durationHours),
    panelHeightM: mission.panelHeightM,
    antennaHeightM: mission.antennaHeightM,
    weights: { sunlight: weights.sunlight ?? 1, earthComms: weights.earthComms ?? 0 },
  };
}

/** A time step that keeps a mission to about 340 Sun/Earth checks, and never finer than an hour. */
export function finderStepMinutes(durationHours) {
  return Math.max(60, Math.ceil((durationHours * 60) / 340 / 30) * 30);
}
