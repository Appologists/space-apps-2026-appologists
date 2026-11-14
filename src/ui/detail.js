// The selected site's card: where the Sun and Earth are right now, when they rise or set next,
// a timeline of the whole mission, each criterion's result, and a spot check against JPL Horizons.
import { fetchHorizonsAltAz } from '../astro/horizons.js';
import { horizonDipDeg } from '../astro/sky.js';
import { compass, formatHours, formatLatLon, formatUTC } from '../format.js';
import { clear, h } from './dom.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Hours from sample `from` until the body crosses the threshold, or null if it never does in the window. */
function hoursUntilChange(elevations, threshold, from, stepHours) {
  const up = elevations[from] > threshold;
  for (let i = from + 1; i < elevations.length; i++) {
    if (elevations[i] > threshold !== up) return (i - from) * stepHours;
  }
  return null;
}

function skyLine(name, elevation, azimuth, threshold, untilChange) {
  const up = elevation > threshold;
  const where = `${Math.abs(elevation).toFixed(1)}° ${elevation >= 0 ? 'above' : 'below'} the horizon, to the ${compass(azimuth)}`;
  const next =
    untilChange == null
      ? `Stays ${up ? 'up' : 'down'} for the rest of the mission`
      : `${up ? 'Sets' : 'Rises'} in ${formatHours(untilChange)}`;
  return h('dd', {}, `${up ? 'Up' : 'Down'}: ${where}`, h('small', {}, `${next} · azimuth ${azimuth.toFixed(0)}°`));
}

function drawTimeline(canvas, sky, thresholds, viewIndex) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const g = canvas.getContext('2d');
  g.scale(dpr, dpr);
  g.clearRect(0, 0, width, height);
  const n = sky.sunEl.length;
  const left = 44;
  const plotWidth = width - left - 6;
  const rows = [
    { label: 'Sun', values: sky.sunEl, threshold: thresholds.sun, color: css('--sun'), y: 8 },
    { label: 'Earth', values: sky.earthEl, threshold: thresholds.earth, color: css('--earth'), y: 30 },
  ];
  g.font = `12px ${css('--font-ui')}`;
  g.textBaseline = 'middle';
  for (const row of rows) {
    g.fillStyle = css('--dim');
    g.fillText(row.label, 6, row.y + 7);
    g.fillStyle = css('--rule');
    g.fillRect(left, row.y, plotWidth, 14);
    g.fillStyle = row.color;
    // Draw each "up" stretch as one bar.
    let runStart = -1;
    for (let i = 0; i <= n; i++) {
      const up = i < n && row.values[i] > row.threshold;
      if (up && runStart < 0) runStart = i;
      if (!up && runStart >= 0) {
        const x0 = left + (runStart / (n - 1)) * plotWidth;
        const x1 = left + (Math.min(i, n - 1) / (n - 1)) * plotWidth;
        g.fillRect(x0, row.y, Math.max(x1 - x0, 1), 14);
        runStart = -1;
      }
    }
  }
  const x = left + (viewIndex / Math.max(n - 1, 1)) * plotWidth;
  g.fillStyle = css('--ink');
  g.fillRect(Math.round(x) - 1, 4, 2, height - 8);
  return { left, plotWidth, n };
}

// The last Horizons answer, kept so re-rendering the card (for example after moving a weight) does not lose it.
let horizonsMemo = { key: null, text: '' };

/**
 * @param {HTMLElement} el
 * @param {Object} options
 * @param {ReturnType<import('../scoring/rank.js').rankSites>[number]|null} options.entry
 * @param {import('../criteria/types.js').Context} options.ctx
 * @param {number} options.viewIndex
 * @param {import('../criteria/types.js').Criterion[]} options.criteria
 * @param {{categories: Object<string,string>, sources: Object<string,{title:string,url:string}>}} options.meta
 * @param {{info: {available: boolean, coversSouthOfLat?: number, hint?: string}|null, onLookAround: () => void}} [options.surface]
 * @param {(index: number) => void} options.onScrub
 * @param {() => void} options.onClose
 */
export function renderDetail(el, { entry, ctx, viewIndex, criteria, meta, surface, onScrub, onClose }) {
  if (!entry) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const { site } = entry;
  const { mission } = ctx;
  const sky = ctx.sky(site);
  const viewTime = new Date(mission.start.getTime() + viewIndex * ctx.stepHours * 3_600_000);
  const thresholds = {
    sun: mission.minSunElevationDeg - horizonDipDeg(mission.panelHeightM),
    earth: mission.minEarthElevationDeg - horizonDipDeg(mission.antennaHeightM),
  };

  const timeline = h('canvas', { class: 'timeline', role: 'img', 'aria-label': 'When the Sun and Earth are above the horizon during the mission' });
  const horizonsOut = h('pre', { hidden: true });
  const horizonsKey = `${site.lat},${site.lon},${viewTime.getTime()}`;
  if (horizonsMemo.key === horizonsKey) {
    horizonsOut.textContent = horizonsMemo.text;
    horizonsOut.hidden = false;
  }
  const horizonsButton = h(
    'button',
    {
      type: 'button',
      onClick: async () => {
        horizonsButton.disabled = true;
        horizonsOut.hidden = false;
        horizonsOut.textContent = 'Asking JPL Horizons…';
        try {
          const stop = new Date(viewTime.getTime() + 3_600_000);
          const [sun, earth] = await Promise.all(
            ['sun', 'earth'].map((body) => fetchHorizonsAltAz({ site, body, start: viewTime, stop, step: '1 h' })),
          );
          const line = (name, ours, theirs) =>
            `${name.padEnd(6)} elevation ${ours.toFixed(3)}°   Horizons ${theirs.toFixed(3)}°   differ ${Math.abs(ours - theirs).toFixed(3)}°`;
          horizonsOut.textContent = [line('Sun', sky.sunEl[viewIndex], sun[0].elevation), line('Earth', sky.earthEl[viewIndex], earth[0].elevation)].join('\n');
        } catch (error) {
          horizonsOut.textContent = `Could not reach JPL Horizons. This check needs the app to be started with "npm run dev".\n(${error.message})`;
        }
        horizonsMemo = { key: horizonsKey, text: horizonsOut.textContent };
        horizonsButton.disabled = false;
      },
    },
    'Check against JPL Horizons',
  );

  // "Look around from here": needs terrain data on this machine, and the data must cover the site.
  const info = surface?.info;
  const lookAround = !info
    ? null
    : !info.available
      ? h('div', { class: 'caveats' }, `Surface view needs terrain data. Run "${info.hint ?? 'npm run data:fetch -- lola-south-80s-80m'}", then reload.`)
      : site.lat <= info.coversSouthOfLat
        ? h('button', { type: 'button', class: 'primary', onClick: surface.onLookAround }, 'Look around from here')
        : h('div', { class: 'caveats' }, `Surface view: terrain data only covers ${Math.abs(info.coversSouthOfLat)}° S to the south pole.`);

  const source = site.source ? meta.sources[site.source] : null;
  const caveats = [...new Set(Object.values(entry.results).flatMap((r) => r.caveats ?? []))];

  const parts = [
    h(
      'div',
      { class: 'detail-head' },
      h('div', {}, h('h2', {}, site.name), h('div', { class: 'coords' }, `${meta.categories[site.category] ?? site.category} · ${formatLatLon(site.lat, site.lon)}`)),
      h('button', { type: 'button', class: 'close', 'aria-label': 'Close site details', onClick: onClose }, '×'),
    ),
    h('div', { class: 'eyebrow' }, `At ${formatUTC(viewTime)}`),
    h(
      'dl',
      { class: 'sky' },
      h('dt', {}, h('i', { class: 'dot', style: 'background:var(--sun)' }), 'Sun'),
      skyLine('Sun', sky.sunEl[viewIndex], sky.sunAz[viewIndex], thresholds.sun, hoursUntilChange(sky.sunEl, thresholds.sun, viewIndex, ctx.stepHours)),
      h('dt', {}, h('i', { class: 'dot', style: 'background:var(--earth)' }), 'Earth'),
      skyLine('Earth', sky.earthEl[viewIndex], sky.earthAz[viewIndex], thresholds.earth, hoursUntilChange(sky.earthEl, thresholds.earth, viewIndex, ctx.stepHours)),
    ),
    lookAround,
    h('div', { class: 'eyebrow' }, `Whole mission · ${formatHours(mission.durationHours)} from landing`),
    timeline,
    h(
      'ul',
      {},
      criteria
        .filter((c) => entry.results[c.id])
        .map((c) => {
          const r = entry.results[c.id];
          return h('li', { class: 'crit' }, h('span', {}, c.label), h('span', {}, r.score == null ? 'no data' : `${Math.round(r.score * 100)} / 100`), h('small', {}, r.summary));
        }),
    ),
    site.note ? h('div', { class: 'caveats' }, site.note) : null,
    caveats.length ? h('ul', { class: 'caveats' }, caveats.map((c) => h('li', {}, c))) : null,
    h('div', { class: 'horizons' }, horizonsButton, horizonsOut),
    source ? h('div', { class: 'source' }, 'Coordinates: ', h('a', { href: source.url, target: '_blank', rel: 'noopener' }, source.title)) : null,
  ];
  clear(el).append(...parts.filter(Boolean));

  // Draw after the canvas is in the page so it has a size; click or drag on it to move the view time.
  const geometry = drawTimeline(timeline, sky, thresholds, viewIndex);
  const scrub = (e) => {
    const rect = timeline.getBoundingClientRect();
    const fraction = (e.clientX - rect.left - geometry.left) / geometry.plotWidth;
    onScrub(Math.round(Math.min(Math.max(fraction, 0), 1) * (geometry.n - 1)));
  };
  timeline.addEventListener('pointerdown', scrub);
}
