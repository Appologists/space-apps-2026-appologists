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

/** Pick a sampling step that keeps a window to roughly 1,000–2,200 samples (whole hours past about 90 days). */
export function stepMinutesFor(durationHours) {
  if (durationHours <= 24) return 5;
  if (durationHours <= 7 * 24) return 10;
  if (durationHours <= 14 * 24) return 15;
  if (durationHours <= 31 * 24) return 30;
  if (durationHours <= 92 * 24) return 60;
  return Math.ceil(durationHours / 2200) * 60; // a year: 4 h
}

// ---- Mission length on a slider, 1 hour to 1 year ----------------------------------------------------------
// The "clean" lengths sit evenly along the slider, and between two of them the length grows by the same factor
// for every step (a logarithmic scale per stretch). So each clean length gets the same room, and an hour is as
// easy to set at the short end as a week is at the long end.

/** The clean lengths: evenly spaced on the slider, each a big tap target. */
export const DURATION_MARKS = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '1 day' },
  { hours: 7 * 24, label: '1 wk' },
  { hours: 14 * 24, label: '2 wk' },
  { hours: 28 * 24, label: '4 wk' },
  { hours: 182.5 * 24, label: '6 mo' },
  { hours: 365 * 24, label: '1 yr' },
];

/** Length in hours at a slider position from 0 to 1. Not rounded. */
export function durationAt(position) {
  const last = DURATION_MARKS.length - 1;
  const x = Math.min(Math.max(position, 0), 1) * last;
  const i = Math.min(Math.floor(x), last - 1);
  const a = DURATION_MARKS[i].hours;
  const b = DURATION_MARKS[i + 1].hours;
  return a * (b / a) ** (x - i);
}

/** The reverse: slider position (0 to 1) of a length in hours. */
export function positionOf(hours) {
  const marks = DURATION_MARKS;
  const last = marks.length - 1;
  if (hours <= marks[0].hours) return 0;
  if (hours >= marks[last].hours) return 1;
  let i = 0;
  while (hours > marks[i + 1].hours) i++;
  return (i + Math.log(hours / marks[i].hours) / Math.log(marks[i + 1].hours / marks[i].hours)) / last;
}

/**
 * A length picked on the slider, made tidy: a clean length when within `snap` of one (as a share of the slider),
 * otherwise whole hours up to three days and whole days beyond.
 */
export function tidyDuration(position, snap = 0.025) {
  const last = DURATION_MARKS.length - 1;
  const near = DURATION_MARKS.find((_, i) => Math.abs(position - i / last) <= snap);
  if (near) return near.hours;
  const hours = durationAt(position);
  return hours <= 72 ? Math.max(1, Math.round(hours)) : Math.round(hours / 24) * 24;
}

/** A mission length in plain words: "5 hours", "3 days", "2 weeks", "6 months", "1 year", "45 days". */
export function formatDuration(hours) {
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (Math.abs(hours - 365 * 24) < 1e-6) return '1 year';
  if (Math.abs(hours - 182.5 * 24) < 1e-6) return '6 months';
  if (Math.abs(hours - LUNAR_DAY_HOURS) < 1e-3) return '29.5 days (one lunar day)';
  if (hours < 24 || (hours < 72 && hours % 24 !== 0)) return plural(Math.round(hours * 10) / 10, 'hour');
  if (hours % 168 === 0 && hours <= 4 * 168) return plural(hours / 168, 'week');
  return plural(Math.round((hours / 24) * 10) / 10, 'day');
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
