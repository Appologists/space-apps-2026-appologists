// The mission questions: what a custom mission asks about the mission, the lander and the rover, and the
// controls that ask them. One definition, used in two places:
//   the Mission step in the left panel (flow.js), which applies each answer at once, and
//   the "Plan a mission" pop-up (shell.js), which keeps a draft until "Find regions that fit".
// Each control is given the value now and a function to call with a new one; it knows nothing else.
// The ready-made missions and their sources are in data/missions.json.
import { DURATION_MARKS, formatDuration, positionOf, tidyDuration } from '../mission.js';
import { h } from './dom.js';

export const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

// A few big choices each, instead of number boxes. `on` says which object holds the value: the mission (start,
// length) or the finder's values (the lander and the rover). An option's third entry is its source, shown on hover.
const yes = (when) => (v) => (v ? when[0] : when[1]);
const distance = (v) => (v >= 1000 ? `${v / 1000} km` : `${v} m`);
export const GROUPS = [
  {
    id: 'mission',
    title: 'Mission',
    date: true, // the landing time comes first, with its own row
    choices: [
      { on: 'mission', key: 'durationHours', label: 'Duration', slider: true, summary: (v) => `for ${formatDuration(v)}` },
    ],
  },
  {
    id: 'lander',
    title: 'Lander',
    choices: [
      // 100 m is NASA's figure for the Artemis lander (missions.json, hls-2024); 200 m and 2 km are our choices, the
      // last for an older-style lander (decision V). 50 m was dropped: the search's 80 m cells make it the same as
      // 100 m. On the seven demo regions 100 m finds 8.4 km² that can take a landing, 200 m 1.8 km², 2 km none.
      { on: 'finder', key: 'ellipseRadiusM', label: 'Landing accuracy', hint: 'How far from its target it may come down', options: [[100, '100 m', 'NASA: Artemis Human Landing System (2024)'], [200, '200 m', 'Our choice'], [2000, '2 km', 'Our choice: an older-style lander']], format: distance, summary: (v) => `within ${distance(v)}` },
      { on: 'finder', key: 'maxLandingSlopeDeg', label: 'Steepest ground it lands on', options: [[5, '5°'], [10, '10°'], [15, '15°']], format: (v) => `${v}°`, summary: (v) => `slopes up to ${v}°` },
      { on: 'finder', key: 'needEarthAtLanding', label: 'Earth in view at touchdown', options: [[true, 'Needed'], [false, 'Not needed']], summary: yes(['Earth in view', null]) },
      { on: 'finder', key: 'needSunAtLanding', label: 'Sunlight at touchdown', options: [[true, 'Needed'], [false, 'Not needed']], summary: yes(['in sunlight', null]) },
    ],
  },
  {
    id: 'rover',
    title: 'Rover',
    choices: [
      { on: 'finder', key: 'maxDarknessHours', label: 'Max darkness', options: [[24, '24 h'], [50, '50 h'], [100, '100 h']], format: (v) => `${v} h`, summary: (v) => `survives ${v} h dark` },
      { on: 'finder', key: 'roverMaxSlopeDeg', label: 'Max ground slope', options: [[10, '10°'], [15, '15°'], [20, '20°']], format: (v) => `${v}°`, summary: (v) => `slopes up to ${v}°` },
      { on: 'finder', key: 'roverSpeedMPerHour', label: 'Average speed', options: [[36, '36 m/hr'], [200, '200 m/hr'], [720, '720 m/hr']], format: (v) => `${v} m/hr`, summary: (v) => `${v} m/hr` },
      { on: 'finder', key: 'roverNeedsEarthToDrive', label: 'Earth in view to drive', options: [[true, 'Needed'], [false, 'Not needed']], summary: yes(['needs Earth to drive', null]) },
    ],
  },
];

/** A landing time in words: "21 Nov 2026, 00:00 UTC". */
export const landingText = (date) =>
  `${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${date.toISOString().slice(11, 16)} UTC`;

/**
 * A group's answers in a few words each, for a one-line summary. `valueOf(def)` reads an answer; `start` is the
 * landing time. A "not needed" says nothing.
 */
export function groupSummary(group, valueOf, start) {
  return [group.date ? landingText(start) : null, ...group.choices.map((def) => def.summary(valueOf(def)))].filter(Boolean);
}

/** A question's choices, with a button of its own for a value set elsewhere (the exact-number boxes under "More tools"). */
export function optionsWith(def, current) {
  return def.options.some(([value]) => same(value, current)) ? def.options : [...def.options, [current, def.format ? def.format(current) : String(current)]];
}

/** One question as a row of big buttons. */
export function choiceRow(def, current, set) {
  return h(
    'div',
    { class: 'choice' },
    h('div', { class: 'choice-label' }, def.label, def.hint ? h('small', {}, def.hint) : null),
    h(
      'div',
      { class: 'choice-options', role: 'group', 'aria-label': def.label },
      optionsWith(def, current).map(([value, text, source]) => h('button', { type: 'button', title: source ?? '', 'aria-pressed': String(same(value, current)), onClick: () => set(value) }, text)),
    ),
  );
}

/**
 * Mission length: a slider from 1 hour to 1 year with the clean lengths evenly spaced under it as big buttons
 * (the scale is in src/mission.js). Dragging shows the length; letting go applies it.
 */
export function durationRow(def, current, set) {
  const SCALE = 1000;
  const readout = h('span', { class: 'duration-value' }, formatDuration(current));
  const apply = (hours) => {
    if (!same(hours, current)) set(hours);
  };
  const marks = DURATION_MARKS.map((mark, i) =>
    h(
      'button',
      {
        type: 'button',
        class: 'duration-mark',
        style: `left: ${((100 * i) / (DURATION_MARKS.length - 1)).toFixed(3)}%`,
        'aria-pressed': String(same(mark.hours, current)),
        'aria-label': formatDuration(mark.hours),
        onClick: () => apply(mark.hours),
      },
      mark.label,
    ),
  );
  const slider = h('input', {
    type: 'range',
    class: 'duration-slider',
    min: '0',
    max: String(SCALE),
    step: '1',
    value: String(Math.round(positionOf(current) * SCALE)),
    'aria-label': def.label,
    'aria-valuetext': formatDuration(current),
    onInput: (e) => {
      const hours = tidyDuration(Number(e.target.value) / SCALE);
      readout.textContent = formatDuration(hours);
      e.target.setAttribute('aria-valuetext', formatDuration(hours));
      marks.forEach((button, i) => button.setAttribute('aria-pressed', String(same(DURATION_MARKS[i].hours, hours))));
      // Near a clean length the thumb jumps onto it, so it is easy to hit.
      if (DURATION_MARKS.some((mark) => same(mark.hours, hours))) e.target.value = String(Math.round(positionOf(hours) * SCALE));
    },
    onChange: (e) => apply(tidyDuration(Number(e.target.value) / SCALE)),
  });
  return h(
    'div',
    { class: 'choice' },
    h('div', { class: 'choice-label duration-label' }, def.label, readout),
    h('div', { class: 'duration' }, slider, h('div', { class: 'duration-marks' }, marks)),
  );
}

/** The landing time moved by a number of hours (the "−1 week" to "+1 hour" buttons). */
export const movedBy = (start, hours) => new Date(start.getTime() + hours * 3_600_000);

/** The landing time: big in the middle, with steps of a week, a day and an hour back on the left and forward on the right. */
export function dateRow(start, set) {
  const STEPS = [
    [24 * 7, 'week'],
    [24, 'day'],
    [1, 'hour'],
  ];
  const side = (sign) =>
    h(
      'div',
      { class: 'date-steps', role: 'group', 'aria-label': sign < 0 ? 'Earlier' : 'Later' },
      STEPS.map(([hours, unit]) =>
        h('button', { type: 'button', 'aria-label': `One ${unit} ${sign < 0 ? 'earlier' : 'later'}`, onClick: () => set(movedBy(start, sign * hours)) }, `${sign < 0 ? '−' : '+'}1 ${unit}`),
      ),
    );
  // The date box itself is hidden: tapping the big date opens its picker, for a jump of more than a few weeks.
  const input = h('input', {
    class: 'date-input',
    type: 'datetime-local',
    step: '3600',
    tabIndex: -1,
    'aria-hidden': 'true',
    value: start.toISOString().slice(0, 16),
    onChange: (e) => {
      const date = new Date(`${e.target.value}Z`);
      if (!Number.isNaN(date.getTime())) set(date);
    },
  });
  const day = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return h(
    'div',
    { class: 'choice' },
    h('div', { class: 'choice-label' }, 'Landing datetime'),
    h(
      'div',
      { class: 'date-row' },
      side(-1),
      h(
        'button',
        {
          type: 'button',
          class: 'date-now',
          title: 'Choose a date',
          onClick: () => {
            try {
              input.showPicker();
            } catch {
              input.focus();
            }
          },
        },
        h('span', { class: 'date-day' }, day),
        h('span', { class: 'date-time' }, `${start.toISOString().slice(11, 16)} UTC`),
        input,
      ),
      side(1),
    ),
  );
}
