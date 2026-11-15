// Where the rover is at any moment of a plan, for playing a drive back on the map and in the surface view.
// Pure: no DOM. It reads the planner's replay (schedule.js) and adds no result of its own: the replay says
// where the rover is at the end of each time step, and between two steps this draws a straight blend.
import { cellOffset } from './grid.js';
import { STATE, hopLength } from './schedule.js';

/**
 * @param {object} result  a FinderResult (see types.js)
 * @param {object} plan    from planMission(): needs `path` and `drive`
 * @returns {null | {
 *   at: (hours: number) => {east: number, north: number, elevationM: number, headingDeg: number, distanceM: number, step: number, state: number, lit: boolean, earth: boolean, darkH: number},
 *   points: {east: number, north: number}[], lengthM: number, startHours: number, endHours: number, arrivalHours: number|null,
 *   changes: number[], milestones: {hours: number, state: number|null, destination?: number}[], nextChange: (hours: number) => number|null}}
 *   null without a route. `east`/`north` are metres from the middle of the search area. `startHours` to
 *   `endHours` is the stretch from the first step it drives in to the end of the last one. `darkH` is the
 *   unbroken time in the dark so far; `changes` are the hours at which the rover starts doing something else;
 *   `milestones` is touchdown (state null) at 0 h, the state it starts in, then one entry per change and per
 *   arrival at a destination (those carry `destination`, the destination's index).
 */
export function createTrack(result, plan) {
  const path = plan?.path;
  const drive = plan?.drive;
  if (!path?.length || !drive) return null;
  const { n, stepHours: H, steps, elevation } = result;
  const points = path.map((cell) => cellOffset(result, Math.floor(cell / n), cell % n));
  const cum = new Float64Array(path.length);
  for (let p = 1; p < path.length; p++) cum[p] = cum[p - 1] + hopLength(result, path[p - 1], path[p]);
  const lengthM = cum[path.length - 1];

  let first = -1;
  let last = -1;
  for (let s = 0; s < steps; s++) {
    if (drive.timeline[s] !== STATE.DRIVING) continue;
    if (first < 0) first = s;
    last = s;
  }

  // Unbroken hours in the dark at the end of each step, counted the way the replay counts them (schedule.js),
  // and the hours at which the rover starts doing something else. From Khiem's drive story (PR #7).
  const darkH = new Float32Array(steps);
  for (let s = 0, run = 0; s < steps; s++) {
    run = drive.lit[s] ? 0 : run + H;
    darkH[s] = run;
  }
  const changes = [];
  for (let s = 1; s < steps; s++) if (drive.timeline[s] !== drive.timeline[s - 1]) changes.push(s * H);

  /** Metres along the route at a time: the replay's value at each step's end, blended in between. */
  function along(hours) {
    const f = Math.min(Math.max(hours / H, 0), steps);
    const k = Math.min(Math.floor(f), steps - 1);
    const before = k === 0 ? 0 : drive.positionM[k - 1];
    return before + (drive.positionM[k] - before) * Math.min(f - k, 1);
  }

  function at(hours) {
    const distanceM = Math.min(along(hours), lengthM);
    // The stretch of the route that holds this distance.
    let lo = 0;
    let hi = Math.max(path.length - 2, 0);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cum[mid] <= distanceM) lo = mid;
      else hi = mid - 1;
    }
    const a = points[lo];
    const b = points[Math.min(lo + 1, path.length - 1)];
    const span = cum[Math.min(lo + 1, path.length - 1)] - cum[lo];
    const t = span > 0 ? Math.min(Math.max((distanceM - cum[lo]) / span, 0), 1) : 0;
    const za = elevation[path[lo]];
    const zb = elevation[path[Math.min(lo + 1, path.length - 1)]];
    const step = Math.min(Math.max(Math.floor(hours / H), 0), steps - 1);
    return {
      east: a.east + (b.east - a.east) * t,
      north: a.north + (b.north - a.north) * t,
      elevationM: za + (zb - za) * t,
      headingDeg: ((Math.atan2(b.east - a.east, b.north - a.north) * 180) / Math.PI + 360) % 360,
      distanceM,
      step,
      state: drive.timeline[step],
      lit: drive.lit[step] === 1,
      earth: drive.earth[step] === 1,
      darkH: darkH[step],
    };
  }

  // The drive's timeline: touchdown, then every time the rover starts doing something else, and every arrival at
  // a destination (named by `destination`, its index). The last arrival is the change to "arrived" itself.
  const stops = (plan.stops ?? []).filter((stop) => stop.arrivalHours != null && stop.arrivalHours > 0);
  const lastStop = stops.at(-1) ?? null;
  const milestones = [
    { hours: 0, state: null },
    { hours: 0, state: drive.timeline[0] },
    ...changes.map((c) => {
      const state = drive.timeline[Math.round(c / H)];
      return state === STATE.ARRIVED && lastStop ? { hours: c, state, destination: lastStop.destination } : { hours: c, state };
    }),
    ...stops.slice(0, -1).map((stop) => ({ hours: stop.arrivalHours, state: STATE.ARRIVED, destination: stop.destination })),
  ].sort((a, b) => a.hours - b.hours);

  /** The first change of what the rover does after `hours`, or null if nothing changes again. */
  const nextChange = (hours) => changes.find((c) => c > hours + 1e-6) ?? null;

  return {
    at,
    points,
    lengthM,
    startHours: first < 0 ? 0 : first * H,
    endHours: first < 0 ? 0 : (last + 1) * H,
    arrivalHours: drive.arrived ? drive.arrivalHours : null,
    changes,
    milestones,
    nextChange,
  };
}
