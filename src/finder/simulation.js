// A drive plan replayed frame by frame for the simulation: where the rover is at each time step, what it is
// doing, whether it is lit, and how long it has been in the dark. Pure: no DOM. Everything comes from the
// plan's replay (simulatePlan in schedule.js), so the animation shows exactly what the plan says.
import { STATE } from './schedule.js';

export const STATE_TEXT = Object.freeze({
  [STATE.PARKED]: 'Parked at the landing site',
  [STATE.DRIVING]: 'Driving',
  [STATE.WAIT_SUN]: 'Waiting in the dark for sunlight',
  [STATE.WAIT_EARTH]: 'Waiting for Earth to come into view',
  [STATE.HOLD]: 'Waiting in sunlight for the way ahead to light up',
  [STATE.ARRIVED]: 'Arrived',
  [STATE.LOST]: 'Lost: in the dark for longer than it survives',
});

export const STATE_COLOUR = Object.freeze({
  [STATE.PARKED]: '#8d96a6',
  [STATE.DRIVING]: '#5fe0c0',
  [STATE.WAIT_SUN]: '#8fa8ff',
  [STATE.WAIT_EARTH]: '#5aa8ff',
  [STATE.HOLD]: '#ffd36b',
  [STATE.ARRIVED]: '#7bd88f',
  [STATE.LOST]: '#e04848',
});

/** Precompute what every frame needs. */
export function prepareSimulation(result, plan) {
  const { path, drive } = plan ?? {};
  if (!path?.length || !drive) return null;
  const { n, cellM, elevation } = result;
  const cum = new Float64Array(path.length);
  for (let p = 1; p < path.length; p++) {
    const a = path[p - 1];
    const b = path[p];
    const diagonal = ((a / n) | 0) !== ((b / n) | 0) && a % n !== b % n;
    const horizontal = diagonal ? cellM * Math.SQRT2 : cellM;
    const dz = elevation[b] - elevation[a];
    cum[p] = cum[p - 1] + Math.sqrt(horizontal * horizontal + dz * dz);
  }
  const steps = drive.timeline.length;
  const darkRun = new Float32Array(steps); // hours of unbroken darkness at the end of each step
  let run = 0;
  for (let s = 0; s < steps; s++) {
    run = drive.lit[s] ? 0 : run + result.stepHours;
    darkRun[s] = run;
  }
  return { result, plan, path, cum, steps, darkRun };
}

/**
 * The rover at time step `s`.
 * @returns {{ step, hours, row, col, state, text, colour, lit, earth, darkRunH, distanceM, pathIndex, trail: number }}
 *   row/col are fractional grid coordinates (for drawing between cell centres); trail is the distance driven.
 */
export function frameAt(sim, s) {
  const { result, plan, path, cum, steps, darkRun } = sim;
  const step = Math.max(0, Math.min(steps - 1, Math.round(s)));
  const { drive } = plan;
  const { n } = result;
  const distanceM = drive.positionM[step];
  let p = drive.cellIndex[step];
  // Interpolate between path[p] and path[p + 1] by distance.
  let row = (path[p] / n) | 0;
  let col = path[p] % n;
  if (p < path.length - 1 && distanceM > cum[p] + 1e-6) {
    const f = Math.min(1, (distanceM - cum[p]) / (cum[p + 1] - cum[p]));
    const r2 = (path[p + 1] / n) | 0;
    const c2 = path[p + 1] % n;
    row += (r2 - row) * f;
    col += (c2 - col) * f;
  }
  const state = drive.timeline[step];
  const reached = (plan.stops ?? []).filter((stop) => stop.arrivalHours != null && stop.arrivalHours <= (step + 1) * result.stepHours + 1e-9);
  return {
    step,
    hours: step * result.stepHours,
    row,
    col,
    state,
    text: STATE_TEXT[state] ?? '',
    colour: STATE_COLOUR[state] ?? '#ffffff',
    lit: !!drive.lit[step],
    earth: !!drive.earth[step],
    darkRunH: darkRun[step],
    distanceM,
    pathIndex: p,
    reached: reached.map((stop) => stop.destination),
  };
}

/** Steps worth stopping at when jumping through the drive: every change of state. */
export function keySteps(sim) {
  const out = [0];
  const t = sim.plan.drive.timeline;
  for (let s = 1; s < t.length; s++) if (t[s] !== t[s - 1]) out.push(s);
  return out;
}
