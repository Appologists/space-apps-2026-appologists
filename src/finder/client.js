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

/** A time step that keeps a mission to about 340 Sun/Earth checks, and never finer than an hour. */
export function finderStepMinutes(durationHours) {
  return Math.max(60, Math.ceil((durationHours * 60) / 340 / 30) * 30);
}
