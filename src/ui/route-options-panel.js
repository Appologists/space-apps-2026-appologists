// The three route choices (safest, fastest, shortest) as cards above the drive plan, like a road map's route
// list. Clicking a card shows that route on the map and in the plan below.
import { ROUTE_KINDS, SLOPE_BANDS, slopeBand } from '../finder/route-options.js';
import { profile } from '../finder/directions.js';
import { formatHours } from '../format.js';
import { WHY_COLOURS } from '../finder/why-not.js';
import { h } from './dom.js';

const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const ICON = { safest: '🛡', fastest: '⚡', shortest: '📏' };

/** What a card says: when it arrives (or how it fails), and how far and how steep. */
function cardLines(option) {
  const s = option.summary;
  const lines = [];
  if (!s.arrived) lines.push(h('span', { class: 'route-bad' }, s.lostAtHours != null ? `Lost in the dark ${formatHours(s.lostAtHours)} after landing` : 'Does not arrive in the mission'));
  else if (!s.survived) lines.push(h('span', { class: 'route-bad' }, `Arrives at ${formatHours(s.arrivalHours)}, then lost in the dark`));
  else lines.push(h('span', { class: 'route-big' }, `Arrives ${formatHours(s.arrivalHours)} after landing`));
  lines.push(`${km(s.distanceM)} · steepest ${s.steepestDeg.toFixed(0)}°`);
  // Darkness to spare, Earth in view, the safest route's limits and "same path as" were taken off the cards to keep
  // the Drive step short (Daniel, 2026-11-14); the limits are still in the "What these results leave out" note.
  return lines;
}

/** Height along the route, the ground under it coloured by slope band; waits and arrivals marked. */
function drawProfile(canvas, result, plan) {
  const points = profile(result, plan.path);
  if (points.length < 2) return;
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round((canvas.clientWidth || 300) * dpr));
  const hgt = Math.round(90 * dpr);
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const pad = { l: 34 * dpr, r: 6 * dpr, t: 8 * dpr, b: 16 * dpr };
  const total = points[points.length - 1].distM;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.elevM);
    hi = Math.max(hi, p.elevM);
  }
  if (hi - lo < 20) {
    const mid = (hi + lo) / 2;
    lo = mid - 10;
    hi = mid + 10;
  }
  const x = (d) => pad.l + (d / total) * (w - pad.l - pad.r);
  const y = (e) => pad.t + (1 - (e - lo) / (hi - lo)) * (hgt - pad.t - pad.b);
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1];
    const b = points[k];
    ctx.fillStyle = slopeBand(Math.max(a.slopeDeg, b.slopeDeg)).hex;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(x(a.distM), hgt - pad.b);
    ctx.lineTo(x(a.distM), y(a.elevM));
    ctx.lineTo(x(b.distM), y(b.elevM));
    ctx.lineTo(x(b.distM), hgt - pad.b);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#e6e9ef';
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath();
  points.forEach((p, k) => (k ? ctx.lineTo(x(p.distM), y(p.elevM)) : ctx.moveTo(x(p.distM), y(p.elevM))));
  ctx.stroke();
  ctx.fillStyle = '#ffd36b';
  for (const wait of plan.waits ?? []) {
    if (!(wait.pathIndex > 0)) continue;
    const p = points[wait.pathIndex];
    ctx.beginPath();
    ctx.arc(x(p.distM), y(p.elevM), 3.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  for (const stop of plan.stops ?? []) {
    const p = points[stop.pathIndex];
    if (p) ctx.fillRect(x(p.distM) - dpr, pad.t, 2 * dpr, hgt - pad.t - pad.b);
  }
  ctx.fillStyle = '#8d96a6';
  ctx.font = `${10 * dpr}px "IBM Plex Mono", monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.round(hi)} m`, pad.l - 3 * dpr, y(hi));
  ctx.fillText(`${Math.round(lo)} m`, pad.l - 3 * dpr, y(lo));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('0', pad.l, hgt);
  ctx.textAlign = 'right';
  ctx.fillText(km(total), w - pad.r, hgt);
}

/**
 * The chosen route's height profile, folded. Its step-by-step directions were taken off the page (Daniel,
 * 2026-11-14): the timeline beside the map now tells the drive. directions() in src/finder/directions.js remains.
 */
function routeDetail(result, plan) {
  if (!plan?.path || plan.path.length < 2 || !plan.drive) return null;
  const canvas = h('canvas', { class: 'route-profile', 'aria-label': 'Height along the route, coloured by slope' });
  const box = h('details', { class: 'explain route-detail' },
    h('summary', {}, 'Height along the route'),
    h('div', { class: 'route-sub' }, 'Elevation above the Moon\'s reference sphere'),
    canvas);
  box.addEventListener('toggle', () => {
    if (box.open) drawProfile(canvas, result, plan);
  });
  return box;
}

/**
 * @param {HTMLElement} el
 * @param {{ options: object|null, choice: string, rover: object, onChoose: (id: string) => void, result?: object, plan?: object }} props
 */
export function renderRouteOptions(el, { options, choice, rover, onChoose, result = null, plan = null, why = null, onLayer = null }) {
  el.replaceChildren();
  if (!options) return;
  const LAYER_NAMES = { slope: 'Slope', reach: 'Reach', dark: 'Darkness', sun: 'Sunlight' };
  const banner = why
    ? h('div', { class: 'why-banner', role: 'alert' },
        h('div', { class: 'why-title' }, '⚠ ', why.title),
        h('ul', {}, why.problems.map((p) => h('li', {},
          h('span', {}, p.text),
          p.tip ? h('span', { class: 'why-tip' }, ` ${p.tip}`) : null,
          p.layer && onLayer ? h('button', { type: 'button', class: 'why-layer', onClick: () => onLayer(p.layer) }, `Show the ${LAYER_NAMES[p.layer] ?? p.layer} layer`) : null))),
        why.marks.length
          ? h('div', { class: 'why-key' }, 'On the map: ',
              [...new Set(why.marks.map((m) => m.kind))].map((kind) => h('span', { class: 'schedule-key' },
                h('i', { style: `border:2px solid ${WHY_COLOURS[kind]};border-radius:50%;background:none` }),
                { steep: 'too steep', walled: 'walled in by steep ground', far: 'beyond range', dark: 'too long in the dark', lost: 'where the shortest way gets lost' }[kind])))
          : null)
    : null;
  el.append(...[banner].filter(Boolean),
    h('div', { class: 'route-cards', role: 'group', 'aria-label': 'Route choices' },
      ROUTE_KINDS.map((kind) => {
        const option = options[kind.id];
        const on = kind.id === choice;
        if (!option?.summary) {
          return h('div', { class: 'route-card none' },
            h('div', { class: 'route-title' }, `${ICON[kind.id]} ${kind.label}`),
            h('small', {}, kind.id === 'safest' ? 'No route within the safer limits.' : kind.id === 'fastest' ? 'No drive works. The reason is in the plan below.' : 'No drivable path on slopes the rover can climb.'));
        }
        return h('button', { type: 'button', class: `route-card${on ? ' on' : ''}${option.summary.ok ? '' : ' warn'}`, 'aria-pressed': String(on), onClick: () => onChoose(kind.id) },
          h('div', { class: 'route-title' }, `${ICON[kind.id]} ${kind.label}`, h('small', {}, ` ${kind.blurb}`)),
          ...cardLines(option).map((line) => h('div', { class: 'route-line' }, line)));
      })),
    h('div', { class: 'route-key' }, 'Slope: ',
      SLOPE_BANDS.map((band) => h('span', { class: 'schedule-key' }, h('i', { style: `background:${band.hex}` }), band.label)),
      h('span', { class: 'schedule-key' }, h('i', { class: 'dash' }), 'other choices'),
      h('span', { class: 'schedule-key' }, h('i', { class: 'ring' }), 'landing area')),
    ...[result ? routeDetail(result, plan) : null].filter(Boolean),
  );
}
