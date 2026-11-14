// The "mission" is the set of user choices every criterion is judged against: when you land, how long you
// stay, and how high your solar panel and antenna sit. Add new user constraints here.

/**
 * @typedef {Object} Mission
 * @property {Date}   start                 landing time (UTC)
 * @property {number} durationHours         length of the window to assess
 * @property {number} stepMinutes           sampling step for Sun/Earth positions
 * @property {number} panelHeightM          solar panel height above the ground
 * @property {number} antennaHeightM        antenna height above the ground
 * @property {number} minSunElevationDeg    Sun counts as "up" above this elevation (centre of the disc)
 * @property {number} minEarthElevationDeg  Earth counts as "visible" above this elevation
 */

export const LUNAR_DAY_HOURS = 29.530589 * 24; // one synodic month: sunrise to sunrise on the Moon

export const DURATIONS = [
  { hours: 24, label: '1 Earth day' },
  { hours: 7 * 24, label: '7 Earth days' },
  { hours: 14 * 24, label: '14 Earth days' },
  { hours: LUNAR_DAY_HOURS, label: 'One lunar day (29.5 Earth days)' },
  { hours: 90 * 24, label: '90 Earth days' },
];

/** Pick a sampling step that keeps a window to roughly 1,000–2,200 samples. */
export function stepMinutesFor(durationHours) {
  if (durationHours <= 24) return 5;
  if (durationHours <= 7 * 24) return 10;
  if (durationHours <= 14 * 24) return 15;
  if (durationHours <= 31 * 24) return 30;
  return 60;
}

/** @returns {Mission} */
export function defaultMission(now = new Date()) {
  const start = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000); // round down to the hour
  const durationHours = 14 * 24;
  return {
    start,
    durationHours,
    stepMinutes: stepMinutesFor(durationHours),
    panelHeightM: 2,
    antennaHeightM: 2,
    minSunElevationDeg: 0,
    minEarthElevationDeg: 0,
  };
}
