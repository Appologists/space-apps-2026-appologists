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
 * @returns {string} for the address, without the leading "#"
 */
export function encodeFlow({ step, profile, start, durationHours, values, region, startAt, targets }) {
  const q = new URLSearchParams();
  q.set('step', String(step));
  if (profile) q.set('profile', profile);
  q.set('t', start.toISOString().slice(0, 16));
  q.set('d', String(Math.round(durationHours * 1000) / 1000));
  q.set('f', VALUE_KEYS.map((key) => (BOOLEAN.has(key) ? (values[key] ? 1 : 0) : Number(values[key]))).join(','));
  if (region) q.set('region', region);
  if (startAt) q.set('from', point(startAt));
  if (targets?.length) q.set('to', targets.map(point).join(';'));
  return q.toString();
}

/**
 * The reverse. Anything missing or unreadable is left out, so a damaged address gives a normal start.
 * @returns {{step?: number, profile?: string, start?: Date, durationHours?: number, values?: Object, region?: string,
 *            startAt?: {lat: number, lon: number}, targets?: {lat: number, lon: number}[]}}
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
  return out;
}
