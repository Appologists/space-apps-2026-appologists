// Plan panel: "leave no earlier than" control, a plain-language summary and a strip of what the rover does over the mission.
import { h } from './dom.js';
import { STATE } from '../finder/schedule.js';

const STATE_COLOURS = {
  [STATE.PARKED]: '#3a4250',
  [STATE.DRIVING]: '#e6e9ef',
  [STATE.WAIT_SUN]: '#7a5a2a',
  [STATE.WAIT_EARTH]: '#2f4f7a',
  [STATE.ARRIVED]: '#5fe0c0',
  [STATE.LOST]: '#d03b3b',
  [STATE.HOLD]: '#8a93a6',
};
const LIT = '#ffd36b';
const DARK = '#1d2530';

function drawStrip(canvas, drive, stops, stepHours) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round((canvas.clientWidth || 300) * dpr));
  const hgt = Math.round(46 * dpr);
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const steps = drive.timeline.length;
  const rowH = Math.floor(hgt / 2);
  for (let s = 0; s < steps; s++) {
    const x0 = Math.floor((s / steps) * w);
    const x1 = Math.max(x0 + 1, Math.floor(((s + 1) / steps) * w));
    ctx.fillStyle = STATE_COLOURS[drive.timeline[s]] ?? STATE_COLOURS[STATE.PARKED];
    ctx.fillRect(x0, 0, x1 - x0, rowH - 1);
    ctx.fillStyle = drive.lit[s] ? LIT : DARK;
    ctx.fillRect(x0, rowH + 1, x1 - x0, hgt - rowH - 1);
  }
  ctx.fillStyle = '#ffffff';
  for (const stop of stops) {
    if (stop.arrivalHours == null) continue;
    const x = Math.min(w - 1, Math.floor((stop.arrivalHours / stepHours / steps) * w));
    ctx.fillRect(x, 0, Math.max(1, Math.round(dpr)), hgt);
  }
}

// The "leave no earlier than" box and "Find the latest time to leave" were taken off the demo page
// (Daniel, 2026-11-14): the rover leaves at landing. latestDeparture() in planner.js still does the work.
export function renderSchedule(el, { result, plan, text }) {
  el.replaceChildren();
  if (!plan) {
    el.append(h('p', { class: 'schedule-hint' }, 'Add a destination to plan a drive.'));
    return;
  }
  const sw = (colour, label) => h('span', { class: 'schedule-key' }, h('i', { style: `background:${colour}` }), label);
  el.append(
    ...[
      h('p', { id: 'scheduleText', class: 'schedule-text' }, text.headline),
      text.lines?.length ? h('ul', { id: 'scheduleLines', class: 'schedule-lines' }, text.lines.map((line) => h('li', {}, line))) : null,
    ].filter(Boolean), // append() would write a null out as the word "null"
  );
  if (plan.drive) {
    const canvas = h('canvas', { id: 'scheduleStrip', class: 'schedule-strip' });
    el.append(
      canvas,
      h('div', { class: 'schedule-legend' },
        'Top row: ',
        sw(STATE_COLOURS[STATE.PARKED], 'parked'),
        sw(STATE_COLOURS[STATE.DRIVING], 'driving'),
        sw(STATE_COLOURS[STATE.WAIT_SUN], 'waiting for sunlight'),
        sw(STATE_COLOURS[STATE.WAIT_EARTH], 'waiting for Earth'),
        sw(STATE_COLOURS[STATE.HOLD], 'waiting in sunlight (planned)'),
        sw(STATE_COLOURS[STATE.ARRIVED], 'arrived'),
        sw(STATE_COLOURS[STATE.LOST], 'lost'),
        ' Bottom row: ',
        sw(LIT, 'sunlit'),
        sw(DARK, 'dark'),
        ' White lines: arrivals'),
    );
    drawStrip(canvas, plan.drive, plan.stops ?? [], result.stepHours);
  }
  // "How this is worked out" (text.notes) is shown under "What these results leave out" instead (finder-mode.js).
}
