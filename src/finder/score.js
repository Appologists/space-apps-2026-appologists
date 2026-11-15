// The landing-site finder's rules: why a cell fails, how a passing cell is scored, and how the best
// sites are chosen. Shared by the server and the browser: no Node or browser APIs.

/** Reasons a cell fails. A cell's `fail` value is the sum of the ones that apply; 0 means it passes. */
export const FAIL = Object.freeze({ SLOPE: 1, NO_SUN_AT_LANDING: 2, DARK_TOO_LONG: 4, NO_EARTH_AT_LANDING: 8, OUTSIDE: 16 });

const FAIL_TEXT = [
  [FAIL.OUTSIDE, 'outside the search area, or no terrain data'],
  [FAIL.SLOPE, 'ground too steep somewhere in the landing area'],
  [FAIL.NO_SUN_AT_LANDING, 'no sunlight at touchdown'],
  [FAIL.DARK_TOO_LONG, 'darkness lasts too long'],
  [FAIL.NO_EARTH_AT_LANDING, 'Earth not in view at touchdown'],
];

/** The reasons behind a `fail` value, in plain words. Empty when the cell passes. */
export const describeFail = (bits) => FAIL_TEXT.filter(([bit]) => bits & bit).map(([, text]) => text);

/** Starting values for the finder's form. They are placeholders for the planner to change. */
export function defaultFinder() {
  return {
    radiusKm: 10,
    ellipseRadiusM: 500,
    maxLandingSlopeDeg: 10,
    maxDarknessHours: 50, // NASA's VIPER planning papers aim for under 50 hours of shadow
    needSunAtLanding: true,
    needEarthAtLanding: true,
    // The rover, for reach and routes (stage 2). Also placeholders.
    roverMaxSlopeDeg: 15,
    roverSpeedMPerHour: 200,
    roverRangeKm: 0, // longest total drive; 0 means no limit (Daniel, 2026-11-14: real rovers have no single range figure)
    roverNeedsEarthToDrive: false,
  };
}

/**
 * Score of a cell that passes every check, 0–1. Same idea and weights as the ranked list:
 * unbroken sunlight as a share of the mission, and the share of time with Earth in view.
 */
export function cellScore(longestLitH, windowHours, earthFraction, weights) {
  const wSun = Math.max(weights?.sunlight ?? 1, 0);
  const wEarth = Math.max(weights?.earthComms ?? 0, 0);
  if (wSun + wEarth === 0) return 0;
  return (wSun * Math.min(longestLitH / windowHours, 1) + wEarth * earthFraction) / (wSun + wEarth);
}

/**
 * The best-scoring cells, kept at least `minSeparationM` apart so the list is not ten neighbours.
 * Ties go to the gentler landing ellipse.
 * @returns {{row: number, col: number, index: number}[]}
 */
export function pickSites({ n, cellM, score, ellipseSlope }, { count = 10, minSeparationM = 1000 } = {}) {
  const candidates = [];
  for (let i = 0; i < score.length; i++) if (!Number.isNaN(score[i])) candidates.push(i);
  candidates.sort((a, b) => score[b] - score[a] || ellipseSlope[a] - ellipseSlope[b] || a - b);
  const minCellsSquared = (minSeparationM / cellM) ** 2;
  const picked = [];
  for (const index of candidates) {
    const row = Math.floor(index / n);
    const col = index % n;
    if (picked.every((p) => (p.row - row) ** 2 + (p.col - col) ** 2 >= minCellsSquared)) {
      picked.push({ row, col, index });
      if (picked.length === count) break;
    }
  }
  return picked;
}
