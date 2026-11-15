// Three ways to drive to the same destinations, like the route choices in a road map: the fastest, the safest
// and the shortest. Built on the drive planner (planner.js) and the replay (schedule.js); it does not change
// either. Pure: no DOM.
//
//  - Fastest:  the planner as it is (earliest arrival).
//  - Safest:   the planner again with stricter limits (gentler slopes, a margin on darkness), trying the
//              strictest first and loosening step by step until a plan works.
//  - Shortest: the shortest drivable path (no thought for sunlight), driven as soon as the rules allow.
//              It can get the rover lost in the dark, which is why the planner exists; the panel says so.
//
// The slope bands and the darkness margin are our estimate (see docs/decisions.md, decision R).
import { planMission } from './planner.js';
import { pathTo, reachFrom } from './route.js';
import { STATE, simulatePlan } from './schedule.js';

import { SLOPE_BANDS, slopeBand } from './slope-bands.js';
export { SLOPE_BANDS, slopeBand }; // moved to slope-bands.js; still exported from here for existing callers

/** The safest route keeps this share of the darkness limit in reserve (0.3 = it must survive 30% longer). */
export const DARK_MARGIN = 0.3;
/** Slope limits the safest route tries, gentlest first. Only those below the rover's own limit are used. */
export const SAFE_SLOPES_DEG = Object.freeze([10, 12]);

const WAITING = new Set([STATE.WAIT_SUN, STATE.WAIT_EARTH, STATE.HOLD]);

export const ROUTE_KINDS = Object.freeze([
  { id: 'safest', label: 'Safest', blurb: 'gentle slopes, spare time in the dark' },
  { id: 'fastest', label: 'Fastest', blurb: 'earliest arrival' },
  { id: 'shortest', label: 'Shortest', blurb: 'fewest kilometres, ignores sunlight' },
]);

/** Numbers for a route card. Null fields mean "not known" (no drive). */
export function routeSummary(result, plan, rover) {
  if (!plan?.path || !plan.drive) return null;
  const { slope } = result;
  let steepestDeg = 0;
  const bandM = Object.fromEntries(SLOPE_BANDS.map((b) => [b.id, 0]));
  for (let p = 1; p < plan.path.length; p++) {
    const a = plan.path[p - 1];
    const b = plan.path[p];
    const deg = Math.max(slope[a], slope[b]);
    steepestDeg = Math.max(steepestDeg, deg);
    bandM[slopeBand(deg).id] += hopMetres(result, a, b);
  }
  const { drive } = plan;
  const end = drive.arrivalHours ?? result.windowHours;
  const until = Math.min(drive.timeline.length, Math.ceil(end / result.stepHours));
  let earthSteps = 0;
  for (let s = 0; s < until; s++) earthSteps += drive.earth[s];
  return {
    ok: !!plan.ok,
    arrived: !!drive.arrived,
    survived: !!drive.survived,
    lostAtHours: drive.lostAtHours,
    arrivalHours: drive.arrived ? drive.arrivalHours : null,
    distanceM: plan.distanceM,
    steepestDeg,
    bandM,
    longestDarkH: drive.longestDarkH,
    darkSpareH: Number.isFinite(rover.maxDarknessHours) ? rover.maxDarknessHours - drive.longestDarkH : null,
    earthFraction: until > 0 ? earthSteps / until : null,
    waitHours: drive.waitingHours,
  };
}

function hopMetres(result, a, b) {
  const { n, cellM, elevation } = result;
  const diagonal = ((a / n) | 0) !== ((b / n) | 0) && a % n !== b % n;
  const horizontal = diagonal ? cellM * Math.SQRT2 : cellM;
  const dz = elevation[b] - elevation[a];
  return Math.sqrt(horizontal * horizontal + dz * dz);
}

/**
 * The safest workable plan: the gentlest slope limit and, if possible, a darkness margin. Tries
 * (gentlest slope, with margin) → … → (rover's slope, with margin) → (gentlest slope, no margin) → …
 * Fewer tries when there are many destinations, because each try then takes longer.
 * @returns {{ plan, limits: { maxSlopeDeg, maxDarknessHours, margin: boolean } } | null}
 */
export function safestPlan(result, start, destinations, rover, baseline = null) {
  const slopes = [...SAFE_SLOPES_DEG.filter((deg) => deg < rover.maxSlopeDeg), rover.maxSlopeDeg];
  const tried = destinations.length > 2 ? [slopes[0], rover.maxSlopeDeg] : slopes;
  const darkWithMargin = Number.isFinite(rover.maxDarknessHours) ? rover.maxDarknessHours * (1 - DARK_MARGIN) : Infinity;
  const darks = Number.isFinite(rover.maxDarknessHours) ? [darkWithMargin, rover.maxDarknessHours] : [Infinity];
  for (const maxDarknessHours of darks) {
    for (const maxSlopeDeg of [...new Set(tried)]) {
      const limits = { ...rover, maxSlopeDeg, maxDarknessHours };
      const plan = planMission(result, start, destinations, limits, { explain: false });
      if (!plan.ok) continue;
      // The planner goes for the earliest arrival, so a stricter run can still sit longer in the dark than the
      // baseline (usually the fastest plan). If the baseline keeps to the same limits with less darkness, use it.
      const better = baseline?.ok && fitsLimits(result, baseline, maxSlopeDeg, maxDarknessHours) && darkness(baseline) < darkness(plan);
      return { plan: better ? baseline : plan, limits: { maxSlopeDeg, maxDarknessHours, margin: maxDarknessHours < rover.maxDarknessHours } };
    }
  }
  return null;
}

const darkness = (plan) => plan.drive?.longestDarkH ?? Infinity;
function fitsLimits(result, plan, maxSlopeDeg, maxDarknessHours) {
  if (!plan.path || darkness(plan) > maxDarknessHours + 1e-9) return false;
  return plan.path.every((cell) => result.slope[cell] <= maxSlopeDeg);
}

/**
 * The shortest drivable route through the destinations in the given order (no thought for sunlight), driven
 * as soon as the rules allow. Returns a plan shaped like planMission's, so the panel and the map can show it.
 */
export function shortestPlan(result, start, destinations, rover, order) {
  const { n } = result;
  let from = start;
  let path = [start.row * n + start.col];
  const ends = []; // [path index, destination]
  let used = 0;
  for (const d of order) {
    const reach = reachFrom(result, from, { maxSlopeDeg: rover.maxSlopeDeg, rangeM: (rover.rangeM ?? Infinity) - used });
    const leg = pathTo(reach, destinations[d]);
    if (!leg) return null;
    used += reach.dist[leg[leg.length - 1]];
    path = path.concat(leg.slice(1));
    ends.push([path.length - 1, d]);
    from = destinations[d];
  }
  const drive = simulatePlan(result, path, {
    departHours: rover.departHours ?? 0,
    speedMPerHour: rover.speedMPerHour,
    maxDarknessHours: rover.maxDarknessHours,
    needEarthToDrive: !!rover.needEarthToDrive,
    surviveAfterArrival: !!rover.surviveAfterArrival,
  });
  const H = result.stepHours;
  const stops = ends.map(([pathIndex, destination]) => {
    const reached = drive.reachHours[pathIndex];
    return {
      destination,
      row: (path[pathIndex] / n) | 0,
      col: path[pathIndex] % n,
      pathIndex,
      arrivalHours: Number.isNaN(reached) ? null : Math.min(Math.ceil((reached - 1e-7) / H) * H, result.windowHours),
    };
  });
  const waits = [];
  for (let s = 0; s < drive.timeline.length; s++) {
    if (!WAITING.has(drive.timeline[s])) continue;
    const prev = waits[waits.length - 1];
    if (prev && prev.state === drive.timeline[s] && prev.pathIndex === drive.cellIndex[s] && Math.abs(prev.fromHours + prev.hours - s * H) < 1e-9) prev.hours += H;
    else {
      const cell = path[drive.cellIndex[s]];
      waits.push({ row: (cell / n) | 0, col: cell % n, pathIndex: drive.cellIndex[s], fromHours: s * H, hours: H, state: drive.timeline[s] });
    }
  }
  const ok = drive.arrived && drive.survived;
  return {
    ok,
    status: ok ? 'ok' : drive.arrived ? 'lost-after-arrival' : 'no-plan',
    order: [...order],
    path,
    leave: null,
    stops,
    waits,
    drive,
    distanceM: drive.distanceM,
    shortestM: order.length === 1 ? drive.distanceM : null,
    reasons: [], // the panel explains a failed shortest route itself (see finder-mode.js)
    selfCheck: true,
    computeMs: 0,
  };
}

const samePath = (a, b) => !!a && !!b && a.length === b.length && a.every((cell, i) => cell === b[i]);

/**
 * All three routes. `fastest` may be passed in when the caller already has the planner's plan.
 * @returns {{ fastest, safest, shortest }} each { plan, summary, sameAs?: string, limits? } or null
 */
export function routeOptions(result, start, destinations, rover, { fastest = null } = {}) {
  const fast = fastest ?? planMission(result, start, destinations, rover);
  const safe = safestPlan(result, start, destinations, rover, fast);
  const order = fast.order?.length === destinations.length ? fast.order : destinations.map((_, i) => i);
  const short = shortestPlan(result, start, destinations, rover, order);
  const wrap = (plan, extra = {}) => (plan?.path ? { plan, summary: routeSummary(result, plan, rover), ...extra } : null);
  const out = {
    fastest: wrap(fast),
    safest: safe ? wrap(safe.plan, { limits: safe.limits }) : null,
    shortest: wrap(short),
  };
  for (const id of ['safest', 'shortest']) {
    if (!out[id] || !out.fastest || !samePath(out[id].plan.path, out.fastest.plan.path)) continue;
    out[id].sameAs = 'fastest';
    out[id].otherDarkH = out.fastest.plan.drive.longestDarkH;
    out[id].otherArrivalH = out.fastest.summary.arrivalHours;
  }
  return out;
}
