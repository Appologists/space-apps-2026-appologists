// Cast shadows for the surface view: which ground is hidden from the Sun by other ground.
//
// Works in the surface view's own flat frame (metres; x east, y up, z south), where the Moon's curvature is
// already built into every height and sunlight travels in straight parallel lines. Terrain heights are
// resampled onto a square grid; one pass across the grid, starting from the edge nearest the Sun, carries
// the "shadow line" downwind:
//
//   shadowLine(cell) = max(terrain, shadowLine) one step toward the Sun, minus how far a ray falls in a step
//
// Ground below its shadow line is in shadow. One pass costs a few operations per cell, so it can be redone
// every time the Sun moves. No browser APIs here, so it runs in tests.

const NONE = -1e9; // "no terrain, no shadow": far below everything

/**
 * @typedef {Object} ShadowGrid
 * @property {number} n           cells per side
 * @property {number} cellM       cell size
 * @property {number} halfSizeM   the grid spans −halfSize…+halfSize in x and z, centred on the viewer
 * @property {Float32Array} Y     terrain height per cell (index = iz * n + ix)
 * @property {Float32Array} S     shadow line height per cell, filled by sweepShadows
 * @property {Float32Array} M     max(Y, S), what the next cell downwind sees
 * @property {number} dropM       how far a sunbeam falls crossing one cell, set by sweepShadows
 */

/**
 * @param {number} halfSizeM
 * @param {number} cellM
 * @param {(x: number, z: number) => number} heightAt  terrain height at a horizontal position; NaN where there is none
 * @returns {ShadowGrid}
 */
export function buildShadowGrid(halfSizeM, cellM, heightAt) {
  const n = Math.round((2 * halfSizeM) / cellM);
  const Y = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    const z = -halfSizeM + (iz + 0.5) * cellM;
    for (let ix = 0; ix < n; ix++) {
      const y = heightAt(-halfSizeM + (ix + 0.5) * cellM, z);
      Y[iz * n + ix] = Number.isNaN(y) ? NONE : y;
    }
  }
  return { n, cellM, halfSizeM, Y, S: new Float32Array(n * n).fill(NONE), M: new Float32Array(n * n), dropM: 0 };
}

/** Bilinear lookup of one of a grid's fields at a horizontal position; NaN outside the grid. */
export function sampleGrid(grid, field, x, z) {
  const { n, cellM, halfSizeM } = grid;
  const fx = (x + halfSizeM) / cellM - 0.5;
  const fz = (z + halfSizeM) / cellM - 0.5;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  if (ix < 0 || iz < 0 || ix >= n - 1 || iz >= n - 1) return NaN;
  const tx = fx - ix;
  const tz = fz - iz;
  const i = iz * n + ix;
  return (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - tz) + (field[i + n] * (1 - tx) + field[i + n + 1] * tx) * tz;
}

/**
 * Fill grid.S (and grid.M) for a Sun direction.
 * @param {ShadowGrid} grid
 * @param {{x: number, y: number, z: number}} sun  unit vector pointing at the Sun
 * @param {(x: number, z: number) => number} [beyond]  max(terrain, shadow line) outside this grid, for a fine
 *        grid nested inside a coarse one; without it nothing outside the grid casts a shadow
 */
export function sweepShadows(grid, sun, beyond) {
  const { n, cellM, halfSizeM, Y, S, M } = grid;
  const alongX = Math.abs(sun.x) >= Math.abs(sun.z); // march along whichever axis the sunlight follows more closely
  const major = alongX ? sun.x : sun.z;
  const minor = alongX ? sun.z : sun.x;
  if (Math.abs(major) < 1e-6) {
    // Sun straight overhead: nothing shadows anything.
    S.fill(NONE);
    M.set(Y);
    grid.dropM = Infinity;
    return;
  }
  const toSun = major > 0 ? 1 : -1; // step along the major axis that moves toward the Sun
  const shift = minor / Math.abs(major); // sideways shift, in cells, for one step toward the Sun
  const drop = (cellM * sun.y) / Math.abs(major); // height a ray loses over one step away from the Sun
  grid.dropM = drop;
  const position = (index) => -halfSizeM + (index + 0.5) * cellM;
  const stride = alongX ? 1 : n; // index step along the major axis
  const cross = alongX ? n : 1; // index step along the minor axis

  for (let a = toSun > 0 ? n - 1 : 0; a >= 0 && a < n; a -= toSun) {
    const up = a + toSun; // the row one step nearer the Sun, already finished
    for (let b = 0; b < n; b++) {
      const f = b + shift;
      const b0 = Math.floor(f);
      let upwind;
      if (up < 0 || up >= n || b0 < 0 || b0 >= n - 1) {
        upwind = beyond ? beyond(alongX ? position(up) : position(f), alongX ? position(f) : position(up)) : NONE;
        if (Number.isNaN(upwind)) upwind = NONE;
      } else {
        const t = f - b0;
        const i0 = up * stride + b0 * cross;
        upwind = M[i0] * (1 - t) + M[i0 + cross] * t;
      }
      const i = a * stride + b * cross;
      const line = upwind - drop;
      S[i] = line;
      M[i] = Y[i] > line ? Y[i] : line;
    }
  }
}

/**
 * How lit a point is, 0 (in shadow) to 1 (in full sun), from its height and the shadow line there.
 * The narrow ramp between stands in for the penumbra and hides the grid's grain.
 */
export function litFraction(height, shadowLine, dropM) {
  const ramp = Math.max(0.25 * dropM, 0.5);
  const f = (height - shadowLine) / ramp;
  return f <= 0 ? 0 : f >= 1 ? 1 : f;
}
