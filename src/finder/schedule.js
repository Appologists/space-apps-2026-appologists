// The rover's drive rules, hour by hour, against the Sun and Earth masks. Pure: no DOM.
//
// The rules (decisions N and O):
//  - The rover leaves a cell only while that cell is sunlit (and, if asked, in view of Earth). This is checked
//    at the start of every time step and again each time the rover reaches the next cell.
//  - Otherwise it waits where it is. Between two cells, the cell behind it decides the light.
//  - Darkness is counted at the end of every step for the cell it has last reached. If the unbroken darkness
//    is longer than it survives, it is lost.
// simulatePlan() replays a route with optional "do not leave before" times; the planner (planner.js) chooses
// those times and the route, and is checked against this replay.

export const maskBit = (mask, stride, step, cell) => (mask[step * stride + (cell >> 3)] >> (cell & 7)) & 1;

/** HOLD: waiting in sunlight because the plan says so (the way ahead is not ready yet). */
export const STATE = Object.freeze({ PARKED: 0, DRIVING: 1, WAIT_SUN: 2, WAIT_EARTH: 3, ARRIVED: 4, LOST: 5, HOLD: 6 });

/** Two times closer than this (hours) count as the same moment. Shared with the planner so both agree. */
export const TIME_TOL = 1e-7;

/** Ground distance between two neighbouring cells, including the height change. */
export function hopLength(result, a, b) {
  const { n, cellM, elevation } = result;
  const dr = Math.abs(((b / n) | 0) - ((a / n) | 0));
  const dc = Math.abs((b % n) - (a % n));
  const horizontal = dr && dc ? cellM * Math.SQRT2 : cellM;
  const dz = elevation[b] - elevation[a];
  return Math.sqrt(horizontal * horizontal + dz * dz);
}

/**
 * Replay a route step by step.
 * @param {object} result  a FinderResult (see types.js)
 * @param {number[]} path  cell indices, start first
 * @param {object} options
 * @param {number[]|null} [options.leave]  for each path index, the earliest time (hours after landing) the rover may
 *        leave that cell; missing entries mean "as soon as the rules allow"
 * @param {number} [options.departHours]   earliest time it may leave the start
 * @returns the drive: `timeline` (a STATE per step), `positionM`, `lit`, `earth`, `cellIndex` (path index of the
 *        cell last reached, per step), `reachHours` (when each path cell was reached; NaN if never), and totals.
 *        `arrivalHours` is the end of the step in which it arrived.
 */
export function simulatePlan(result, path, { leave = null, departHours = 0, speedMPerHour, maxDarknessHours, needSunToDrive = true, needEarthToDrive = false }) {
  const { steps, stepHours: H, windowHours, maskStride, sunMask, earthMask } = result;
  const last = path.length - 1;
  const hop = new Float64Array(Math.max(last, 0)); // hours of driving from path[p] to path[p + 1]
  const cum = new Float64Array(path.length);
  for (let p = 0; p < last; p++) {
    const lengthM = hopLength(result, path[p], path[p + 1]);
    hop[p] = lengthM / speedMPerHour;
    cum[p + 1] = cum[p] + lengthM;
  }
  const distanceM = path.length ? cum[last] : 0;
  const timeline = new Uint8Array(steps);
  const positionM = new Float32Array(steps);
  const lit = new Uint8Array(steps);
  const earth = new Uint8Array(steps);
  const cellIndex = new Int32Array(steps);
  const reachHours = new Float64Array(path.length).fill(NaN);
  if (path.length) reachHours[0] = 0;
  const departStep = Math.max(0, Math.ceil(departHours / H - 1e-9));
  const holdUntil = (p) => Math.max(leave?.[p] ?? 0, p === 0 ? departStep * H : 0);

  let idx = 0; // index into path of the last cell reached
  let rem = 0; // hours of driving left to the next cell; 0 = standing on path[idx]
  let moved = false;
  let arrived = last <= 0;
  let arrivalHours = arrived ? departHours : null;
  let drivingSteps = 0;
  let waitingSteps = 0;
  let parkedSteps = 0;
  let darkRun = 0;
  let longestDarkH = 0;
  let lostAtHours = null;
  let survived = true;

  for (let s = 0; s < steps; s++) {
    const t0 = s * H;
    const end = t0 + H;
    let state;
    if (arrived && arrivalHours <= t0 + 1e-9) state = STATE.ARRIVED;
    else if (last <= 0) state = STATE.PARKED;
    else {
      let t = t0;
      let drove = false;
      let sunOk = true;
      let earthOk = true;
      while (idx < last && t < end - TIME_TOL) {
        const here = path[idx];
        sunOk = !needSunToDrive || maskBit(sunMask, maskStride, s, here) === 1;
        earthOk = !needEarthToDrive || maskBit(earthMask, maskStride, s, here) === 1;
        if (rem === 0) {
          const hold = holdUntil(idx);
          if (hold >= end - TIME_TOL) break; // told to stay for the rest of this step
          if (hold > t + TIME_TOL) t = hold;
          if (!(sunOk && earthOk)) break;
          rem = hop[idx];
        } else if (!drove && !(sunOk && earthOk)) break; // stopped between two cells at the start of the step
        const available = end - t;
        if (rem <= available + TIME_TOL) {
          t += rem;
          rem = 0;
          idx++;
          reachHours[idx] = t;
        } else {
          rem -= available;
          t = end;
        }
        drove = true;
      }
      if (drove) {
        state = STATE.DRIVING;
        drivingSteps++;
        moved = true;
        if (idx === last) {
          arrived = true;
          arrivalHours = Math.min(end, windowHours);
        }
      } else {
        const atStart = idx === 0 && !moved;
        if (atStart && s < departStep) state = STATE.PARKED;
        else if (!sunOk) state = STATE.WAIT_SUN;
        else if (!earthOk) state = STATE.WAIT_EARTH;
        else state = atStart ? STATE.PARKED : STATE.HOLD;
        if (state === STATE.PARKED) parkedSteps++;
        else waitingSteps++;
      }
    }
    const cell = path[idx];
    const isLit = maskBit(sunMask, maskStride, s, cell);
    lit[s] = isLit;
    earth[s] = maskBit(earthMask, maskStride, s, cell);
    const pos = last > 0 && idx < last && rem > 0 ? cum[idx] + (hop[idx] - rem) * speedMPerHour : cum[idx] ?? 0;
    positionM[s] = pos;
    cellIndex[s] = idx;
    timeline[s] = state;
    if (isLit) darkRun = 0;
    else darkRun++;
    longestDarkH = Math.max(longestDarkH, darkRun * H);
    if (darkRun * H > maxDarknessHours + 1e-9) {
      survived = false;
      lostAtHours = s * H;
      if (state === STATE.DRIVING) drivingSteps--; // the dark step killed it before it moved on
      timeline.fill(STATE.LOST, s);
      positionM.fill(pos, s);
      cellIndex.fill(idx, s);
      for (let u = s + 1; u < steps; u++) {
        lit[u] = maskBit(sunMask, maskStride, u, cell);
        earth[u] = maskBit(earthMask, maskStride, u, cell);
      }
      break;
    }
  }
  return {
    arrived,
    survived,
    departHours,
    arrivalHours,
    drivingHours: drivingSteps * H,
    waitingHours: waitingSteps * H,
    parkedHours: parkedSteps * H,
    longestDarkH,
    lostAtHours,
    distanceM,
    timeline,
    positionM,
    lit,
    earth,
    cellIndex,
    reachHours,
  };
}

/** A fixed route driven as soon as the rules allow, leaving the start at `departHours`. */
export const simulateDrive = (result, path, options) => simulatePlan(result, path, options);
