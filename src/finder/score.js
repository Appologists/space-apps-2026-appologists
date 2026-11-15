// The landing-site finder's rules: why a cell fails, how much room to miss a passing cell has, and how the
// best sites are chosen. Shared by the server and the browser: no Node or browser APIs.

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
 * Room to miss, the measure passing ground is ranked by (Daniel, 2026-11-14; it replaces a 0–1 score): for every
 * cell, the distance in metres from its centre to the centre of the nearest cell that fails a check on its own
 * (too steep, no Sun or no Earth at touchdown, dark for too long) or has no terrain data. It is the landing
 * accuracy at which that spot would stop passing, so it needs no weights. Ground beyond the raster's edge counts
 * as failing, because nothing is known about it. Measured between cell centres, so it moves in steps of about a
 * cell, and it knows nothing of hazards smaller than a cell.
 * Exact distances by Felzenszwalb and Huttenlocher's two-pass method (Theory of Computing 8, 2012), so the time
 * grows only with the number of cells.
 * @param {Uint8Array} pointFail  n * n; non-zero where the cell itself fails
 * @returns {Float32Array} n * n, metres; 0 where the cell itself fails
 */
export function roomToMiss(pointFail, n, cellM) {
  const FAR = 1e12;
  const squared = new Float64Array(n * n);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  // One line of the transform: d[q] = min over p of (q - p)^2 + f[p].
  const line = () => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s;
      for (;;) {
        const p = v[k];
        s = (f[q] + q * q - (f[p] + p * p)) / (2 * q - 2 * p);
        if (s > z[k]) break;
        k--;
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let col = 0; col < n; col++) {
    for (let row = 0; row < n; row++) f[row] = pointFail[row * n + col] ? 0 : FAR;
    line();
    for (let row = 0; row < n; row++) squared[row * n + col] = d[row];
  }
  const room = new Float32Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) f[col] = squared[row * n + col];
    line();
    for (let col = 0; col < n; col++) {
      const toEdge = Math.min(row + 1, col + 1, n - row, n - col); // the nearest cell beyond the raster
      room[row * n + col] = Math.min(Math.sqrt(d[col]), toEdge) * cellM;
    }
  }
  return room;
}

/**
 * The passing cells with the most room to miss, kept at least `minSeparationM` apart so the list is not ten
 * neighbours. Ties go to the shorter longest darkness, then to the gentler landing area (our choice of order).
 * @param {{n: number, cellM: number, fail: Uint8Array, room: Float32Array, longestDarkH: Float32Array, ellipseSlope: Float32Array}} rasters
 * @returns {{row: number, col: number, index: number}[]}
 */
export function pickSites({ n, cellM, fail, room, longestDarkH, ellipseSlope }, { count = 10, minSeparationM = 1000 } = {}) {
  const candidates = [];
  for (let i = 0; i < fail.length; i++) if (fail[i] === 0) candidates.push(i);
  candidates.sort((a, b) => room[b] - room[a] || longestDarkH[a] - longestDarkH[b] || ellipseSlope[a] - ellipseSlope[b] || a - b);
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
