// Where someone is in the mission steps, as a short piece of text for the page's address. A reload, or a
// bookmark made before a talk, comes back to the same step with the same mission, region and drive.
// Pure: no browser code. src/ui/flow.js decides when to write it and how to act on what it reads.

/** The finder's values in a fixed order; the ones in BOOLEAN travel as 1 or 0. */
const VALUE_KEYS = [
  'radiusKm',
  'ellipseRadiusM',
  'maxLandingSlopeDeg',
  'maxDarknessHours',
  'needSunAtLanding',
  'needEarthAtLanding',
  'roverMaxSlopeDeg',
  'roverSpeedMPerHour',
  'roverRangeKm',
  'roverNeedsEarthToDrive',
];
const BOOLEAN = new Set(['needSunAtLanding', 'needEarthAtLanding', 'roverNeedsEarthToDrive']);

/** The three route choices (src/finder/route-options.js); the first is what the app opens on. */
const ROUTE_CHOICES = ['safest', 'fastest', 'shortest'];

const point = (p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
function readPoint(text) {
  const [lat, lon] = String(text).split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * @param {Object} state
 * @param {number} state.step                1 to 5
 * @param {string|null} state.profile        id of the chosen mission profile
 * @param {Date} state.start                 landing time
 * @param {number} state.durationHours
 * @param {Object} state.values              the finder's values (src/finder/score.js defaultFinder)
 * @param {string|null} [state.region]       id of the region on the map
 * @param {{lat: number, lon: number}|null} [state.startAt]   where the rover starts
 * @param {{lat: number, lon: number}[]} [state.targets]      its destinations, in the order added
 * @param {string} [state.routeChoice]       'safest' (the default, left out), 'fastest' or 'shortest'
 * @returns {string} for the address, without the leading "#"
 */
export function encodeFlow({ step, profile, start, durationHours, values, region, startAt, targets, routeChoice }) {
  const q = new URLSearchParams();
  q.set('step', String(step));
  if (profile) q.set('profile', profile);
  q.set('t', start.toISOString().slice(0, 16));
  q.set('d', String(Math.round(durationHours * 1000) / 1000));
  q.set('f', VALUE_KEYS.map((key) => (BOOLEAN.has(key) ? (values[key] ? 1 : 0) : Number(values[key]))).join(','));
  if (region) q.set('region', region);
  if (startAt) q.set('from', point(startAt));
  if (targets?.length) q.set('to', targets.map(point).join(';'));
  if (targets?.length && ROUTE_CHOICES.includes(routeChoice) && routeChoice !== ROUTE_CHOICES[0]) q.set('route', routeChoice);
  return q.toString();
}

/**
 * The reverse. Anything missing or unreadable is left out, so a damaged address gives a normal start.
 * @returns {{step?: number, profile?: string, start?: Date, durationHours?: number, values?: Object, region?: string,
 *            startAt?: {lat: number, lon: number}, targets?: {lat: number, lon: number}[], routeChoice?: string}}
 */
export function decodeFlow(text) {
  const q = new URLSearchParams(String(text ?? '').replace(/^#/, ''));
  const out = {};
  const step = Number(q.get('step'));
  if (Number.isInteger(step) && step >= 1 && step <= 5) out.step = step;
  if (q.get('profile')) out.profile = q.get('profile');
  const start = new Date(`${q.get('t')}Z`);
  if (q.get('t') && !Number.isNaN(start.getTime())) out.start = start;
  const hours = Number(q.get('d'));
  if (q.get('d') && Number.isFinite(hours) && hours > 0) out.durationHours = hours;
  const numbers = (q.get('f') ?? '').split(',').map(Number);
  if (numbers.length === VALUE_KEYS.length && numbers.every((v) => Number.isFinite(v) && v >= 0)) {
    out.values = Object.fromEntries(VALUE_KEYS.map((key, i) => [key, BOOLEAN.has(key) ? numbers[i] === 1 : numbers[i]]));
  }
  if (q.get('region')) out.region = q.get('region');
  const startAt = q.get('from') ? readPoint(q.get('from')) : null;
  if (startAt) out.startAt = startAt;
  const targets = (q.get('to') ?? '').split(';').filter(Boolean).map(readPoint).filter(Boolean);
  if (targets.length) out.targets = targets;
  if (targets.length && ROUTE_CHOICES.includes(q.get('route'))) out.routeChoice = q.get('route');
  return out;
}

// ---- The front's tabs (ui/shell.js) and the mission steps they stand for --------------------------------------
/** The step a tab opens. The street view is its own page, not a step. */
export const TAB_STEPS = { moon: 2, site: 3, ride: 5 };

/**
 * The tab that is on screen at a step, or null before the first search (step 1: the "Plan a mission" pop-up).
 * Step 4, the old Surface step, has no tab of its own and can only come from an old saved address; it shows
 * the ride's view standing still, so it counts as Ride.
 */
export function tabOfStep(step) {
  if (!(step >= 2)) return null;
  return step >= 4 ? 'ride' : step === 3 ? 'site' : 'moon';
}
