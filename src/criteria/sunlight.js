import { horizonDipDeg, visibilityStats } from '../astro/sky.js';
import { formatHours } from '../format.js';

/** @type {import('./types.js').Criterion} */
export default {
  id: 'sunlight',
  label: 'Uninterrupted sunlight',
  description:
    'Longest unbroken stretch with the Sun above the horizon during the mission. Six hours in one piece beats seven hours with a gap, because every gap is a night the lander has to survive.',
  status: 'ready',
  defaultWeight: 1,
  evaluate(site, ctx) {
    const { mission } = ctx;
    const threshold = mission.minSunElevationDeg - horizonDipDeg(mission.panelHeightM);
    const stats = visibilityStats(ctx.sky(site).sunEl, threshold, ctx.stepHours);
    return {
      score: stats.windowHours > 0 ? stats.longestRunHours / stats.windowHours : null,
      value: stats.longestRunHours,
      unit: 'h',
      summary: `${formatHours(stats.longestRunHours)} unbroken sunlight, lit ${Math.round(stats.fraction * 100)}% of the time`,
      facts: {
        longestRunHours: stats.longestRunHours,
        longestRunStartHours: stats.longestRunStartHours,
        litFraction: stats.fraction,
        interruptions: stats.interruptions,
        sunUpAtLanding: stats.upAtStart,
        hoursUntilSunChange: stats.hoursUntilChange,
      },
      caveats: ['Smooth-sphere horizon: shadows from ridges and crater rims are not included yet.'],
    };
  },
};
