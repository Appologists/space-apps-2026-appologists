import { horizonDipDeg, visibilityStats } from '../astro/sky.js';
import { formatHours } from '../format.js';

/** @type {import('./types.js').Criterion} */
export default {
  id: 'earthComms',
  label: 'Direct-to-Earth communication',
  description:
    'Share of the mission with Earth above the horizon. While it is, a direct link without a relay satellite is possible (antennas and station schedules are not checked).',
  status: 'ready',
  defaultWeight: 0.7,
  evaluate(site, ctx) {
    const { mission } = ctx;
    const threshold = mission.minEarthElevationDeg - horizonDipDeg(mission.antennaHeightM);
    const stats = visibilityStats(ctx.sky(site).earthEl, threshold, ctx.stepHours);
    const pct = Math.round(stats.fraction * 100);
    return {
      score: stats.fraction,
      value: stats.fraction * 100,
      unit: '%',
      summary:
        pct === 100
          ? 'Earth in view for the whole mission'
          : pct === 0
            ? 'Earth never in view: no direct contact, a relay satellite would be needed'
            : `Earth in view ${pct}% of the time, longest pass ${formatHours(stats.longestRunHours)}`,
      facts: {
        visibleFraction: stats.fraction,
        longestPassHours: stats.longestRunHours,
        passes: stats.runs.length,
        earthUpAtLanding: stats.upAtStart,
        hoursUntilEarthChange: stats.hoursUntilChange,
      },
      caveats: ['Smooth-sphere horizon: terrain blocking the view of Earth is not included yet.'],
    };
  },
};
