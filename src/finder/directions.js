// A drive plan as step-by-step directions, like a road map's, and the height profile along the route.
// Pure: no DOM. Directions use the map's grid: up is north (rows grow southward, columns eastward).
import { formatHours } from '../format.js';
import { destinationName } from './plan-text.js';
import { STATE } from './schedule.js';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
/** Compass heading of a hop from cell a to cell b on an n-by-n grid. */
export function heading(n, a, b) {
  const dr = ((b / n) | 0) - ((a / n) | 0);
  const dc = (b % n) - (a % n);
  const deg = (Math.atan2(dc, -dr) * 180) / Math.PI; // 0 = north, 90 = east
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

function hopMetres(result, a, b) {
  const { n, cellM, elevation } = result;
  const diagonal = ((a / n) | 0) !== ((b / n) | 0) && a % n !== b % n;
  const horizontal = diagonal ? cellM * Math.SQRT2 : cellM;
  const dz = elevation[b] - elevation[a];
  return Math.sqrt(horizontal * horizontal + dz * dz);
}

/** Height and slope along the path: [{ distM, elevM, slopeDeg, pathIndex }]. */
export function profile(result, path) {
  const out = [];
  let distM = 0;
  for (let p = 0; p < (path?.length ?? 0); p++) {
    if (p) distM += hopMetres(result, path[p - 1], path[p]);
    out.push({ distM, elevM: result.elevation[path[p]], slopeDeg: result.slope[path[p]], pathIndex: p });
  }
  return out;
}

const km = (m) => (m < 950 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);

/**
 * Split the hops between two path indices into legs of one heading. Short wiggles (under `minHops` hops)
 * are folded into the leg before them, so the list reads like directions rather than every grid step.
 */
function legs(result, path, from, to, minHops = 3) {
  const { n } = result;
  const runs = [];
  for (let p = from + 1; p <= to; p++) {
    const dir = heading(n, path[p - 1], path[p]);
    const last = runs[runs.length - 1];
    if (last && last.dir === dir) last.to = p;
    else runs.push({ dir, from: p - 1, to: p });
  }
  const merged = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && (run.to - run.from < minHops || last.dir === run.dir)) last.to = run.to;
    else merged.push({ ...run });
  }
  // A short first leg folds into the next one.
  if (merged.length > 1 && merged[0].to - merged[0].from < minHops) {
    merged[1].from = merged[0].from;
    merged.shift();
  }
  return merged;
}

function legText(result, path, leg) {
  let distM = 0;
  let climbM = 0;
  let descentM = 0;
  let steepest = 0;
  for (let p = leg.from + 1; p <= leg.to; p++) {
    const a = path[p - 1];
    const b = path[p];
    distM += hopMetres(result, a, b);
    const dz = result.elevation[b] - result.elevation[a];
    if (dz > 0) climbM += dz;
    else descentM -= dz;
    steepest = Math.max(steepest, result.slope[a], result.slope[b]);
  }
  const net = climbM - descentM;
  const verb = net > 15 ? 'Climb' : net < -15 ? 'Descend' : 'Drive';
  const height = Math.abs(net) > 15 ? ` (${net > 0 ? 'up' : 'down'} ${Math.round(Math.abs(net))} m)` : '';
  const slope = steepest >= 10 ? `, slopes up to ${steepest.toFixed(0)}°` : '';
  return { text: `${verb} ${km(distM)} ${leg.dir}${height}${slope}`, distM, steepestDeg: steepest };
}

const WAIT_TEXT = {
  [STATE.WAIT_SUN]: 'in the dark, for sunlight to return',
  [STATE.WAIT_EARTH]: 'for Earth to come into view',
  [STATE.HOLD]: 'in sunlight, until the way ahead is lit',
};

/**
 * Directions for a plan: [{ kind: 'depart'|'drive'|'wait'|'arrive'|'lost', text, atHours, pathIndex }].
 * Times are hours after landing, taken from the plan's replay.
 */
export function directions(result, plan) {
  const { path, drive } = plan ?? {};
  if (!path?.length || !drive) return [];
  const H = result.stepHours;
  const steps = [];
  const firstDrive = drive.timeline.indexOf(STATE.DRIVING);
  steps.push({ kind: 'depart', pathIndex: 0, atHours: firstDrive < 0 ? null : firstDrive * H, text: firstDrive <= 0 ? 'Leave the landing site at touchdown' : `Leave the landing site ${formatHours(firstDrive * H)} after landing` });

  // Points where the drive pauses: planned and forced waits on the way, and arrivals at destinations.
  const marks = new Map(); // pathIndex → [events]
  const add = (pathIndex, event) => marks.set(pathIndex, [...(marks.get(pathIndex) ?? []), event]);
  for (const w of plan.waits ?? []) if (w.pathIndex > 0 && WAIT_TEXT[w.state]) add(w.pathIndex, { kind: 'wait', w });
  for (const s of plan.stops ?? []) if (s.pathIndex > 0) add(s.pathIndex, { kind: 'arrive', s });
  const lastReached = drive.survived ? path.length - 1 : Math.max(0, ...Array.from(drive.cellIndex));
  const breaks = [...new Set([...marks.keys(), lastReached])].filter((p) => p <= lastReached).sort((a, b) => a - b);

  let from = 0;
  for (const to of breaks) {
    if (to > from) {
      for (const leg of legs(result, path, from, to)) {
        const t = legText(result, path, leg);
        steps.push({ kind: 'drive', pathIndex: leg.from, atHours: drive.reachHours[leg.from], text: t.text, distM: t.distM, steepestDeg: t.steepestDeg });
      }
    }
    const at = (e) => (e.kind === 'wait' ? e.w.fromHours : e.s.arrivalHours ?? Infinity);
    for (const event of (marks.get(to) ?? []).sort((x, y) => at(x) - at(y))) {
      if (event.kind === 'wait') {
        steps.push({ kind: 'wait', pathIndex: to, atHours: event.w.fromHours, hours: event.w.hours, text: `Wait ${formatHours(event.w.hours)} ${WAIT_TEXT[event.w.state]}` });
      } else {
        const name = (plan.stops?.length ?? 0) > 1 || plan.order?.length > 1 ? `destination ${destinationName(event.s.destination)}` : 'the destination';
        steps.push({ kind: 'arrive', pathIndex: to, atHours: event.s.arrivalHours, text: event.s.arrivalHours == null ? `Does not reach ${name}` : `Arrive at ${name}, ${formatHours(event.s.arrivalHours)} after landing` });
      }
    }
    from = to;
  }
  if (!drive.survived) steps.push({ kind: 'lost', pathIndex: lastReached, atHours: drive.lostAtHours, text: `Lost in the dark ${formatHours(drive.lostAtHours)} after landing` });
  // A drive leg starts when the waits before it at the same spot are over.
  for (let k = 1; k < steps.length; k++) {
    const prev = steps[k - 1];
    if (steps[k].kind === 'drive' && prev.kind === 'wait' && prev.pathIndex === steps[k].pathIndex) steps[k].atHours = Math.max(steps[k].atHours ?? 0, prev.atHours + prev.hours);
  }
  return compress(result, path, steps);
}

export const SHORT_WAIT_H = 6; // waits shorter than this, between short legs, are summed up
export const SHORT_LEG_M = 500;

/**
 * Fold long runs of short legs and short waits (the rover edging along behind moving shadows) into one line,
 * so the list stays readable. Long waits and long legs stay as they are.
 */
export function compress(result, path, steps) {
  const small = (s) => (s.kind === 'drive' && s.distM < SHORT_LEG_M) || (s.kind === 'wait' && s.hours < SHORT_WAIT_H);
  const out = [];
  let k = 0;
  while (k < steps.length) {
    let j = k;
    while (j < steps.length && small(steps[j])) j++;
    const group = steps.slice(k, j);
    const waits = group.filter((s) => s.kind === 'wait');
    if (waits.length >= 3) {
      const drives = group.filter((s) => s.kind === 'drive');
      const first = drives[0]?.pathIndex ?? group[0].pathIndex;
      const lastStep = group[group.length - 1];
      const end = steps[j]?.pathIndex ?? lastStep.pathIndex;
      const distM = drives.reduce((sum, d) => sum + d.distM, 0);
      const waitH = waits.reduce((sum, w) => sum + w.hours, 0);
      const steepest = Math.max(0, ...drives.map((d) => d.steepestDeg ?? 0));
      const dir = end > first ? heading(result.n, path[first], path[end]) : '';
      out.push({
        kind: 'creep',
        pathIndex: group[0].pathIndex,
        atHours: group[0].atHours,
        distM,
        hours: waitH,
        text: `Edge ${km(distM)} ${dir} between moving shadows: ${waits.length} short stops, ${formatHours(waitH)} of waiting in all${steepest >= 10 ? `, slopes up to ${steepest.toFixed(0)}°` : ''}`,
      });
    } else out.push(...group);
    if (j < steps.length) out.push(steps[j]);
    k = j + 1;
  }
  return out;
}
