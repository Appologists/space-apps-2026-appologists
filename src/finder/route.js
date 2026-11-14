// Reach and route for the landing-site finder: which ground a rover can reach from a start cell within a slope
// limit and a range, and the shortest drivable path to a destination. Pure: no DOM, no three.js.
import { FAIL } from './score.js';

const NEIGHBOURS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [-1, 1], [1, -1], [1, 1],
];

function drivableMask(result, maxSlopeDeg) {
  const size = result.n * result.n;
  const ok = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    ok[i] = !Number.isNaN(result.elevation[i]) && !(result.fail[i] & FAIL.OUTSIDE) && result.slope[i] <= maxSlopeDeg ? 1 : 0;
  }
  return ok;
}

/** Binary min-heap of (key, value) pairs on typed arrays; grows as needed. */
function createHeap(capacity = 4096) {
  let keys = new Float64Array(capacity);
  let vals = new Int32Array(capacity);
  let size = 0;
  return {
    get size() { return size; },
    push(key, val) {
      if (size === keys.length) {
        const k = new Float64Array(size * 2);
        k.set(keys);
        keys = k;
        const v = new Int32Array(size * 2);
        v.set(vals);
        vals = v;
      }
      let i = size++;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= key) break;
        keys[i] = keys[p];
        vals[i] = vals[p];
        i = p;
      }
      keys[i] = key;
      vals[i] = val;
    },
    /** Removes the smallest entry; read it afterwards from `topKey` / `topVal`. */
    pop() {
      this.topKey = keys[0];
      this.topVal = vals[0];
      size--;
      if (size > 0) {
        const key = keys[size];
        const val = vals[size];
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= size) break;
          if (c + 1 < size && keys[c + 1] < keys[c]) c++;
          if (keys[c] >= key) break;
          keys[i] = keys[c];
          vals[i] = vals[c];
          i = c;
        }
        keys[i] = key;
        vals[i] = val;
      }
    },
    topKey: 0,
    topVal: 0,
  };
}

/** @returns {{ n, cellM, start: number, rangeM, maxSlopeDeg, dist: Float32Array, prev: Int32Array }} */
export function reachFrom(result, start, { maxSlopeDeg, rangeM }) {
  const { n, cellM, elevation } = result;
  const size = n * n;
  const ok = drivableMask(result, maxSlopeDeg);
  const d = new Float64Array(size).fill(Infinity);
  const prev = new Int32Array(size).fill(-1);
  const s = start.row * n + start.col;
  const inGrid = start.row >= 0 && start.col >= 0 && start.row < n && start.col < n;
  if (inGrid && ok[s]) {
    d[s] = 0;
    const heap = createHeap();
    heap.push(0, s);
    const diag = cellM * Math.SQRT2;
    while (heap.size > 0) {
      heap.pop();
      const di = heap.topKey;
      const i = heap.topVal;
      if (di > d[i]) continue;
      const row = (i / n) | 0;
      const col = i - row * n;
      for (let k = 0; k < 8; k++) {
        const nr = row + NEIGHBOURS[k][0];
        const nc = col + NEIGHBOURS[k][1];
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const j = nr * n + nc;
        if (!ok[j]) continue;
        let horizontal = cellM;
        if (k >= 4) {
          if (!ok[row * n + nc] || !ok[nr * n + col]) continue; // no cutting corners
          horizontal = diag;
        }
        const dz = elevation[j] - elevation[i];
        const nd = di + Math.sqrt(horizontal * horizontal + dz * dz);
        if (nd > rangeM || nd >= d[j]) continue;
        d[j] = nd;
        prev[j] = i;
        heap.push(nd, j);
      }
    }
  }
  return { n, cellM, start: s, rangeM, maxSlopeDeg, dist: Float32Array.from(d), prev };
}

/** @returns {number[]|null} cell indices from the start to the target inclusive, or null if not reachable */
export function pathTo(reach, target) {
  const { n, dist, prev, start } = reach;
  if (target.row < 0 || target.col < 0 || target.row >= n || target.col >= n) return null;
  const t = target.row * n + target.col;
  if (!Number.isFinite(dist[t])) return null;
  const path = [t];
  let i = t;
  while (i !== start) {
    i = prev[i];
    if (i < 0) return null;
    path.push(i);
  }
  return path.reverse();
}

/** @returns {{ distanceM, hours, steepestDeg, climbM, descentM, longestDarkH, minSunFraction, minEarthFraction }} */
export function pathStats(result, path, { speedMPerHour }) {
  const { n, cellM, elevation } = result;
  let distanceM = 0;
  let climbM = 0;
  let descentM = 0;
  let steepestDeg = 0;
  let longestDarkH = 0;
  let minSunFraction = Infinity;
  let minEarthFraction = Infinity;
  for (let p = 0; p < path.length; p++) {
    const i = path[p];
    steepestDeg = Math.max(steepestDeg, result.slope[i]);
    longestDarkH = Math.max(longestDarkH, result.longestDarkH[i]);
    minSunFraction = Math.min(minSunFraction, result.sunFraction[i]);
    minEarthFraction = Math.min(minEarthFraction, result.earthFraction[i]);
    if (p === 0) continue;
    const a = path[p - 1];
    const dr = Math.abs(((i / n) | 0) - ((a / n) | 0));
    const dc = Math.abs((i % n) - (a % n));
    const horizontal = dr && dc ? cellM * Math.SQRT2 : cellM;
    const dz = elevation[i] - elevation[a];
    distanceM += Math.sqrt(horizontal * horizontal + dz * dz);
    if (dz > 0) climbM += dz;
    else descentM -= dz;
  }
  if (!path.length) minSunFraction = minEarthFraction = 0;
  return { distanceM, hours: distanceM / speedMPerHour, steepestDeg, climbM, descentM, longestDarkH, minSunFraction, minEarthFraction };
}
