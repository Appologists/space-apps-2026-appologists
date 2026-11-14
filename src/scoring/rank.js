// Turns criteria into a ranking: evaluate every site once, then combine the scores with the user's weights.
// Changing a weight only needs rankSites(); changing the mission needs evaluateSites() again.
import { ephemerisSeries } from '../astro/ephemeris.js';
import { skySeries } from '../astro/sky.js';

/**
 * Shared, cached inputs for one mission window.
 * @param {import('../mission.js').Mission} mission
 * @returns {import('../criteria/types.js').Context}
 */
export function createContext(mission) {
  const series = ephemerisSeries(mission.start, mission.durationHours, mission.stepMinutes);
  const cache = new Map();
  return {
    mission,
    series,
    stepHours: series.stepHours,
    sky(site) {
      const key = `${site.lat},${site.lon},${site.elevationM ?? 0}`;
      if (!cache.has(key)) cache.set(key, skySeries(site, series));
      return cache.get(key);
    },
  };
}

/** Run every ready criterion on every site. */
export function evaluateSites(sites, criteria, ctx) {
  const ready = criteria.filter((c) => c.status === 'ready');
  return sites.map((site) => ({
    site,
    results: Object.fromEntries(ready.map((c) => [c.id, c.evaluate(site, ctx)])),
  }));
}

/**
 * Weighted average of the 0–1 scores. A criterion with no data for a site is left out of that site's
 * average (never counted as zero), and `coverage` says how much of the requested weight had data.
 * @param {ReturnType<typeof evaluateSites>} evaluations
 * @param {Object<string, number>} weights
 */
export function rankSites(evaluations, weights) {
  const wanted = Object.values(weights).reduce((sum, w) => sum + Math.max(w, 0), 0);
  const scored = evaluations.map((ev) => {
    let weightSum = 0;
    let total = 0;
    for (const [id, result] of Object.entries(ev.results)) {
      const w = Math.max(weights[id] ?? 0, 0);
      if (w > 0 && result.score != null) {
        weightSum += w;
        total += w * result.score;
      }
    }
    return { ...ev, total: weightSum > 0 ? total / weightSum : null, coverage: wanted > 0 ? weightSum / wanted : 0 };
  });
  scored.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.site.name.localeCompare(b.site.name));
  let rank = 0;
  return scored.map((s) => ({ ...s, rank: s.total == null ? null : ++rank }));
}
