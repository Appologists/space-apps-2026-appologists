// Timed-drive panel: departure control, a plain-language summary and a strip of what the rover does over the mission.
import { h } from './dom.js';
import { formatHours } from '../format.js';
import { STATE } from '../finder/schedule.js';

const STATE_COLOURS = {
  [STATE.PARKED]: '#3a4250',
  [STATE.DRIVING]: '#e6e9ef',
  [STATE.WAIT_SUN]: '#7a5a2a',
  [STATE.WAIT_EARTH]: '#2f4f7a',
  [STATE.ARRIVED]: '#5fe0c0',
  [STATE.LOST]: '#d03b3b',
};
const LIT = '#ffd36b';
const DARK = '#1d2530';

const km = (m) => (m / 1000).toFixed(1);

export function describeDrive(result, drive, workable) {
  const leave = `Leaving ${formatHours(drive.departHours)} after landing`;
  let text;
  if (!drive.survived) {
    text = `${leave}, the rover is lost ${formatHours(drive.lostAtHours)} after landing: it sits in darkness longer than it can survive.`;
  } else if (!drive.arrived) {
    const covered = drive.positionM[drive.positionM.length - 1] ?? 0;
    text = `${leave}, the rover does not arrive before the mission ends (it covers ${km(covered)} of ${km(drive.distanceM)} km).`;
  } else {
    text = `${leave}, the rover arrives ${formatHours(drive.arrivalHours)} after landing: ${formatHours(drive.drivingHours)} of driving and ${formatHours(drive.waitingHours)} waiting. Its longest stretch in darkness is ${formatHours(drive.longestDarkH)}.`;
  }
  if (typeof workable === 'number') {
    text += workable > 0 ? ` ${workable} of ${result.steps} departure hours work.` : ' No departure hour works with these limits.';
  }
  return text;
}

function drawStrip(canvas, drive) {
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
    ctx.fillStyle = STATE_COLOURS[drive.timeline[s]];
    ctx.fillRect(x0, 0, x1 - x0, rowH - 1);
    ctx.fillStyle = drive.lit[s] ? LIT : DARK;
    ctx.fillRect(x0, rowH + 1, x1 - x0, hgt - rowH - 1);
  }
}

export function renderSchedule(el, { result, drive, workable, onDepart, onFindBest }) {
  el.replaceChildren();
  if (!drive) {
    el.append(h('p', { class: 'schedule-hint' }, 'Choose a destination to time the drive.'));
    return;
  }
  const input = h('input', {
    id: 'scheduleDepart',
    type: 'number',
    min: 0,
    max: result.windowHours,
    step: result.stepHours,
    value: drive.departHours,
    onChange: (e) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) onDepart?.(Math.min(result.windowHours, Math.max(0, v)));
    },
  });
  const canvas = h('canvas', { id: 'scheduleStrip', class: 'schedule-strip' });
  const sw = (colour, label) => h('span', { class: 'schedule-key' }, h('i', { style: `background:${colour}` }), label);
  el.append(
    h('div', { class: 'schedule-row' },
      h('label', { for: 'scheduleDepart' }, 'Leave this many hours after landing', input),
      h('button', { id: 'scheduleBest', type: 'button', onClick: () => onFindBest?.() }, 'Find the best time to leave')),
    h('p', { id: 'scheduleText', class: 'schedule-text' }, describeDrive(result, drive, workable)),
    canvas,
    h('div', { class: 'schedule-legend' },
      'Top row: ',
      sw(STATE_COLOURS[STATE.PARKED], 'parked'),
      sw(STATE_COLOURS[STATE.DRIVING], 'driving'),
      sw(STATE_COLOURS[STATE.WAIT_SUN], 'waiting for sunlight'),
      sw(STATE_COLOURS[STATE.WAIT_EARTH], 'waiting for Earth'),
      sw(STATE_COLOURS[STATE.ARRIVED], 'arrived'),
      sw(STATE_COLOURS[STATE.LOST], 'lost'),
      ' Bottom row: ',
      sw(LIT, 'sunlit'),
      sw(DARK, 'dark')));
  drawStrip(canvas, drive);
}
