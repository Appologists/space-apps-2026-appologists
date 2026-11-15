// "When can you land?" on the Regions step: for each region's best landing spot, every landing hour over 30
// days, judged by the mission's rules on the real terrain horizon (src/finder/date-scan.js). One headline
// answer; the day-by-day strip and the method fold out. Picking a time sets the mission's landing time.
import { ephemerisSeries } from '../astro/ephemeris.js';
import { skySeries } from '../astro/sky.js';
import { EARTH_LINK_RULES, REASON, REASON_TEXT, dailySummary, landingWindows, scanLandings } from '../finder/date-scan.js';
import { EXAMPLE_PANEL, MOUNTS, energySummary, hoursUntilBelow, powerSeries } from '../finder/power.js';
import { formatHours, formatLatLon } from '../format.js';
import { fetchTerrainPatch } from '../terrain/client.js';
import { clearanceSeries, horizonProfile } from '../terrain/polar-grid.js';
import { clear, h } from './dom.js';

const SCAN_DAYS = 30;
const AFTER_HOURS = 120; // extra Sun/Earth data past the last mission, to measure darkness still going at its end
const DAY_MS = 86_400_000;
const REASON_CLASS = { [REASON.DARK]: 'dark', [REASON.NO_SUN]: 'nosun', [REASON.NO_EARTH]: 'noearth' };

const dayLabel = (date) => date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeLabel = (date) => `${date.toISOString().slice(11, 16)} UTC`;
const pct = (f) => `${Math.round(f * 100)}%`;
const PANEL_KEY = 'lunar.panel.v1';
const watts = (w) => (w >= 1000 ? `${(w / 1000).toFixed(1)} kW` : `${Math.round(w)} W`);
const wattHours = (wh) => (wh >= 1000 ? `${(wh / 1000).toFixed(wh >= 10_000 ? 0 : 1)} kWh` : `${Math.round(wh)} Wh`);

function loadPanel() {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...EXAMPLE_PANEL, ...saved };
  } catch { /* storage unavailable: use the example */ }
  return { ...EXAMPLE_PANEL };
}

/**
 * @param {{ el: HTMLElement, onUse: (date: Date) => void, setStatus?: (message: string|null) => void }} options
 */
export function createDateScan({ el, onUse }) {
  let job = 0;
  let key = null;
  let anchor = null; // first day of the 30-day window (00:00 UTC); kept while the user tries dates from it
  let earthRule = 'centre';
  let last = null; // { input, rows, best } of the latest finished scan
  let picked = null; // { row, start } chosen in the strip
  let panel = loadPanel(); // the user's panel and load (starts as the example)

  const patchFor = (lat, lon, source) => fetchTerrainPatch(lat, lon, source); // kept by terrain/client.js

  /**
   * New regions, mission or limits. Runs the scan if anything that matters changed.
   * @param {object} input
   * @param {Array<{ name, lat, lon, fromSearch: boolean }>} input.spots   one per region: its best site, or its named point
   * @param {object} input.question   a search question (finder/client.js searchQuestion) for the mission and limits
   * @param {boolean} input.ready     the region search has finished
   */
  function update(input) {
    if (!input.ready) {
      job++;
      key = null;
      return drawWaiting(input.question);
    }
    const q = input.question;
    anchor ??= startOfDay(new Date(q.start));
    const next = JSON.stringify({ a: anchor.getTime(), q: { ...q, center: null, start: null }, earthRule, spots: input.spots.map((s) => [s.lat, s.lon]) });
    if (next === key) return;
    key = next;
    run(input, ++job);
  }

  /** Forget the window's first day: the next scan starts from the mission's landing day again. */
  function resetWindow() {
    anchor = null;
  }

  async function run(input, mine) {
    const q = input.question;
    const missionHours = q.durationHours;
    const scanHours = SCAN_DAYS * 24;
    drawProgress(0, input.spots.length, input.spots[0]?.name);
    // The Sun and Earth over the whole window, once for every spot (hourly).
    await new Promise((r) => setTimeout(r, 0)); // let the progress paint
    const series = ephemerisSeries(anchor, scanHours + missionHours + AFTER_HOURS, 60);
    const rules = {
      needSunAtLanding: q.needSunAtLanding !== false,
      needEarthAtLanding: q.needEarthAtLanding !== false,
      maxDarknessHours: q.maxDarknessHours ?? Infinity,
      minSunClearDeg: 0,
      minEarthClearDeg: EARTH_LINK_RULES[earthRule].marginDeg,
    };
    const spotRows = [];
    for (const [i, spot] of input.spots.entries()) {
      if (mine !== job) return;
      drawProgress(i, input.spots.length, spot.name);
      try {
        const patch = await patchFor(spot.lat, spot.lon, q.source ?? 'auto');
        if (mine !== job) return;
        const sky = skySeries({ lat: spot.lat, lon: spot.lon }, series);
        const sunClear = clearanceSeries(sky.sunEl, sky.sunAz, horizonProfile(patch, q.panelHeightM));
        const earthClear = clearanceSeries(sky.earthEl, sky.earthAz, horizonProfile(patch, q.antennaHeightM));
        const scan = scanLandings({
          sunClear,
          earthClear,
          stepHours: 1,
          scanHours,
          missionHours,
          rules,
          weights: q.weights,
        });
        spotRows.push({ spot, scan, light: { sunClear, earthClear, sunEl: sky.sunEl }, windows: landingWindows(scan), days: dailySummary(scan, 24) });
      } catch (error) {
        spotRows.push({ spot, error: error.message });
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    if (mine !== job) return;
    const regions = groupByRegion(spotRows);
    // Best landing per region (its best window over all its spots), best first.
    const ranked = regions
      .map((region) => {
        let best = null;
        for (const r of region.spots) for (const win of r.windows ?? []) if (!best || win.best.score > best.win.best.score) best = { row: r, win };
        return best && { ...best, region };
      })
      .filter(Boolean)
      .sort((a, b) => b.win.best.score - a.win.best.score);
    const sunAU = Float64Array.from(series.samples, (sample) => sample.sunDistanceAU);
    last = { input, rows: regions, ranked, missionHours, rules, sunAU };
    picked = ranked[0] ? { row: ranked[0].row, start: ranked[0].win.best } : null;
    draw();
  }

  // ---- Drawing --------------------------------------------------------------------------------------------
  function drawWaiting(question) {
    const from = question ? dayLabel(startOfDay(new Date(question.start))) : 'the landing day';
    clear(el).append(h('p', { class: 'when-note' }, `Once the regions are searched, every landing hour for ${SCAN_DAYS} days from ${from} is checked at each region's best spot.`));
  }

  function drawProgress(done, total, name) {
    clear(el).append(
      h('p', { class: 'when-note' }, `Checking ${SCAN_DAYS} days of landing times${name ? ` at ${name}` : ''}… (${Math.min(done + 1, total)} of ${total})`),
      h('div', { class: 'when-progress' }, h('i', { style: `width:${((done / Math.max(total, 1)) * 100).toFixed(0)}%` })),
    );
  }

  const dateOf = (start) => new Date(anchor.getTime() + start.hours * 3_600_000);

  // Which fold-outs of the answer card are open, so a redraw (new panel settings) keeps them as they were.
  const open = { more: false, panel: false };
  const remember = (which) => (e) => { open[which] = e.currentTarget.open; };

  /** One stat: a big number and a few words under it. */
  const stat = (cls, value, label) => h('div', { class: `when-stat ${cls}` }, h('b', {}, value), h('span', {}, label));

  function answer(row, start) {
    const date = dateOf(start);
    const spotText = row.spot.fromSearch ? row.spot.name : `${row.spot.name} (named point)`;
    const power = powerOf(row, start);
    const limit = Number.isFinite(last.rules.maxDarknessHours) ? ` (limit ${formatHours(last.rules.maxDarknessHours)})` : '';
    return h('div', { class: 'when-answer' },
      h('div', { class: 'when-big' }, `${dayLabel(date)} · ${timeLabel(date)}`),
      h('div', { class: 'when-where' }, spotText, h('span', { class: 'when-coords' }, ` ${formatLatLon(row.spot.lat, row.spot.lon, 2)}`)),
      h('div', { class: 'when-stats' },
        stat('sun', formatHours(start.longestLitH), 'of sun in a row'),
        stat('earth', pct(start.earthFraction), 'Earth in view'),
        power ? stat('power', `~${watts(power.atLanding)}`, power.stay.batteryWh > 0 ? `solar · ${wattHours(power.stay.batteryWh)} battery` : `solar · runs ${watts(panel.loadW)}`) : '',
        stat('dark', start.longestDarkH > 0 ? formatHours(start.longestDarkH) : 'None', start.longestDarkH > 0 ? 'longest dark' : 'dark hours')),
      h('details', { class: 'when-more', open: open.more, onToggle: remember('more') },
        h('summary', {}, 'Details'),
        h('ul', { class: 'when-facts' },
          h('li', {}, `Lit ${pct(start.litFraction)} of the stay${start.longestDarkH > 0 ? `; longest darkness ${formatHours(start.longestDarkH)}${limit}` : ''}`),
          ...skyFacts(row, start)),
        power ? powerBlock(power) : ''),
      h('button', { type: 'button', class: 'primary when-use', onClick: () => onUse(date) }, 'Use this landing time'));
  }

  /** Sun height at touchdown, and how long until the Sun and Earth go behind the terrain. */
  function skyFacts(row, start) {
    const light = row.light;
    if (!light) return [];
    const i = start.index;
    const stay = last.missionHours;
    const margin = last.rules.minEarthClearDeg;
    const until = (hrs, body, goes) => (hrs === null || hrs >= stay ? `${body} stays ${goes === 'set' ? 'up' : 'in view'} for the whole stay` : `${body} goes behind the terrain ${formatHours(hrs)} after landing`);
    return [
      h('li', {}, `Sun ${light.sunEl[i].toFixed(1)}° above the level horizon at landing, ${light.sunClear[i].toFixed(1)}° above the terrain`),
      h('li', {}, `${until(hoursUntilBelow(light.sunClear, i, 0, 1), 'Sun', 'set')}; ${until(hoursUntilBelow(light.earthClear, i, margin, 1), 'Earth', 'earthset')}`),
    ];
  }

  /** Estimated panel output over the stay, for the panel set below (null when there is no light data). */
  function powerOf(row, start) {
    const light = row.light;
    if (!light) return null;
    const series = powerSeries({ sunClear: light.sunClear, sunEl: light.sunEl, sunDistanceAU: last.sunAU, panel });
    return { atLanding: series[start.index], stay: energySummary(series, start.index, Math.round(last.missionHours), 1, panel.loadW) };
  }

  /** The power numbers in words, with the panel settings beside them. */
  function powerBlock({ atLanding, stay }) {
    const lines = [
      h('li', {}, `About ${watts(atLanding)} at landing, ${watts(stay.averageW)} on average (most ${watts(stay.peakW)})`),
      h('li', {}, `About ${wattHours(stay.energyWh)} over the stay${stay.zeroHours > 0 ? `; no power for ${formatHours(stay.zeroHours)} in all` : ''}`),
      h('li', {}, stay.batteryWh > 0
        ? `A steady ${watts(panel.loadW)} load needs a battery of at least ${wattHours(stay.batteryWh)}${stay.coversLoad ? '' : ' (and the panel does not make enough over the stay to keep up)'}`
        : `The panel alone runs a steady ${watts(panel.loadW)} load the whole stay`),
    ];
    return h('div', { class: 'when-power' },
      h('div', { class: 'when-power-head' }, 'Solar power (estimate)'),
      h('ul', { class: 'when-facts' }, lines),
      panelSettings(open.panel));
  }

  /** New panel settings: redraw only the answer card (its open fold-outs stay open; the rest is untouched). */
  function redrawPower() {
    const old = el.querySelector('.when-answer');
    if (old && picked) old.replaceWith(answer(picked.row, picked.start));
  }

  function panelSettings(open) {
    const set = (field, value) => {
      if (field !== 'mount' && !(Number.isFinite(value) && value >= 0)) return;
      panel = { ...panel, [field]: value };
      try { localStorage.setItem(PANEL_KEY, JSON.stringify(panel)); } catch { /* not kept */ }
      redrawPower();
    };
    const number = (label, field, value, { min, max, step, toValue = (v) => v }) =>
      h('label', {}, label, h('input', { type: 'number', min, max, step, value: String(value), onChange: (e) => set(field, toValue(Number(e.target.value))) }));
    const isExample = ['areaM2', 'efficiency', 'mount', 'otherLosses', 'loadW'].every((k) => panel[k] === EXAMPLE_PANEL[k]);
    return h('details', { class: 'when-panel', open, onToggle: remember('panel') },
      h('summary', {}, isExample
        ? `Example panel: ${panel.areaM2} m², ${Math.round(panel.efficiency * 100)}% efficient, ${MOUNTS[panel.mount].label}. Change`
        : `For your panel: ${panel.areaM2} m², ${Math.round(panel.efficiency * 100)}% efficient, ${MOUNTS[panel.mount].label}`),
      h('div', { class: 'when-panel-form' },
        number('Area (m²)', 'areaM2', panel.areaM2, { min: '0.01', max: '100', step: '0.1' }),
        number('Efficiency (%)', 'efficiency', Math.round(panel.efficiency * 100), { min: '1', max: '50', step: '1', toValue: (v) => v / 100 }),
        number('Other losses (%)', 'otherLosses', Math.round(panel.otherLosses * 100), { min: '0', max: '90', step: '1', toValue: (v) => v / 100 }),
        number('Steady load (W)', 'loadW', panel.loadW, { min: '0', max: '10000', step: '5' }),
        h('label', {}, 'Mounted',
          h('select', { onChange: (e) => set('mount', e.target.value) },
            Object.entries(MOUNTS).map(([id, m]) => h('option', { value: id, selected: id === panel.mount }, m.label))))),
      h('p', { class: 'caveats' },
        'Power = 1361 W/m² ÷ (distance to the Sun in AU)² × area × efficiency × how squarely the Sun hits the panel × the share of the Sun\'s disc above the terrain × (1 − other losses). ' +
        'The Sun is a disc about 0.53° wide, so while it slides behind a ridge (about an hour near the pole) part of it still gives power. ' +
        'Left out: panel temperature, dust, ageing, light bounced off nearby slopes (a few percent at most), and eclipses by Earth. ' +
        'The battery figure assumes it starts full at landing and counts only the stay. An estimate to compare landings, not a design figure.'),
      isExample ? '' : h('button', { type: 'button', class: 'linklike', onClick: () => { panel = { ...EXAMPLE_PANEL }; try { localStorage.removeItem(PANEL_KEY); } catch { /* fine */ } redrawPower(); } }, 'Back to the example panel'));
  }

  function draw() {
    const { rows, ranked, missionHours } = last;
    const end = new Date(anchor.getTime() + SCAN_DAYS * DAY_MS - 1);
    const range = `${dayLabel(anchor)} – ${dayLabel(end)}`;
    clear(el);
    if (!ranked.length) {
      // Nothing passes: say what stands in the way most often.
      const counts = {};
      for (const r of rows) for (const d of r.days ?? []) for (const [reason, n] of Object.entries(d.reasonCounts ?? {})) counts[reason] = (counts[reason] ?? 0) + n;
      const worst = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      el.append(h('div', { class: 'when-answer none' },
        h('div', { class: 'when-big' }, 'No landing time works'),
        h('p', {}, `None of the spots passes on any hour from ${range}.${worst ? ` Most often: ${REASON_TEXT[worst]}.` : ''} Try a shorter stay, a longer darkness limit, or let Earth count when only its edge is in view (below).`)));
    } else {
      const { row, start } = picked;
      el.append(h('p', { class: 'when-lede' }, picked.row === ranked[0].row && picked.start === ranked[0].win.best ? `Best landing time from ${range}:` : 'Chosen landing time:'), answer(row, start));
      const others = ranked.filter((r) => r.row.spot.region !== row.spot.region).slice(0, 2);
      if (others.length) {
        el.append(h('div', { class: 'when-others' }, 'Also good: ',
          ...others.flatMap((o, i) => [i ? ' · ' : '', h('button', { type: 'button', class: 'linklike', onClick: () => { picked = { row: o.row, start: o.win.best }; draw(); } },
            `${dayLabel(dateOf(o.win.best))} at ${o.row.spot.name}`)])));
      }
    }
    el.append(strip(rows, missionHours), method());
  }

  function strip(rows, missionHours) {
    const header = h('div', { class: 'when-row when-head' }, h('span', { class: 'when-name' }, ''),
      Array.from({ length: SCAN_DAYS }, (_, d) => {
        const date = new Date(anchor.getTime() + d * DAY_MS);
        const showLabel = d === 0 || date.getUTCDate() === 1 || d % 7 === 0;
        return h('span', { class: 'when-day-label' }, showLabel ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '');
      }));
    const body = rows.map((region) =>
      h('div', { class: 'when-row' },
        h('span', { class: 'when-name', title: region.fromSearch ? `The ${region.spots.length} best spots the search found in this region` : 'Named point: not checked for slope or the landing ellipse' }, region.name, region.fromSearch ? '' : ' *'),
        region.error
          ? h('span', { class: 'when-error' }, region.error)
          : region.days.map((day) => {
              const date = new Date(anchor.getTime() + day.day * DAY_MS);
              const row = day.row;
              const on = picked && day.best && picked.start === day.best;
              const spotNote = region.spots.length > 1 && row ? ` (spot ${region.spots.indexOf(row) + 1} of ${region.spots.length})` : '';
              const title = day.best
                ? `${dayLabel(date)}: can land for ${formatHours(day.passHours)} of the day${spotNote}. Best at ${timeLabel(dateOf(day.best))}: ${formatHours(day.best.longestLitH)} unbroken sunlight, Earth ${pct(day.best.earthFraction)}.`
                : `${dayLabel(date)}: no landing at any of its spots. Mostly ${REASON_TEXT[day.reason] ?? 'no data'}.`;
              const strength = day.best ? 0.35 + 0.65 * day.best.score : 1;
              return h('button', {
                type: 'button',
                class: `when-cell ${day.best ? 'ok' : REASON_CLASS[day.reason] ?? 'none'}${on ? ' on' : ''}`,
                style: day.best ? `--k:${strength.toFixed(2)}` : '',
                title,
                'aria-label': title,
                disabled: !day.best,
                onClick: () => {
                  picked = { row: day.row, start: day.best };
                  draw();
                },
              });
            })));
    const key = h('div', { class: 'when-key' },
      h('span', {}, h('i', { class: 'when-cell ok', style: '--k:1' }), 'can land (brighter: better score)'),
      h('span', {}, h('i', { class: 'when-cell dark' }), REASON_TEXT[REASON.DARK]),
      h('span', {}, h('i', { class: 'when-cell nosun' }), REASON_TEXT[REASON.NO_SUN]),
      h('span', {}, h('i', { class: 'when-cell noearth' }), REASON_TEXT[REASON.NO_EARTH]));
    return h('details', { class: 'explain when-strip' },
      h('summary', {}, `Every day for ${SCAN_DAYS} days, every region`),
      h('div', { class: 'when-grid' }, header, ...body),
      key,
      h('p', { class: 'caveats' }, `Each square is one day: the best landing hour that day, at the best of the region's spots (up to three from the search), for a ${formatHours(missionHours)} stay. Hover for the reason. Tap a green square to choose it. * a named point, not a spot the search found: its slope and landing ellipse were not checked.`));
  }

  function method() {
    const ruleButtons = Object.entries(EARTH_LINK_RULES).map(([id, rule]) =>
      h('button', { type: 'button', 'aria-pressed': String(id === earthRule), onClick: () => { earthRule = id; key = null; last && update(last.input); } }, rule.label));
    return h('details', { class: 'explain' },
      h('summary', {}, 'How this is worked out'),
      h('p', {}, 'For each spot the terrain is turned once into its horizon: how high the land rises in every direction, out to 300 km, seen from the solar panel and from the antenna. The Sun and Earth are then followed hour by hour; each hour is one comparison, the body\'s height against the horizon in its direction. A landing hour passes if the Sun and Earth are in view at touchdown (when your mission asks for that) and the rover is never dark for longer than it survives, darkness counted from touchdown until the light comes back, even after the stay ends. Landings that pass are ranked by the same score as the region search: unbroken sunlight and Earth in view, with your weights.'),
      h('div', { class: 'when-rule' }, h('span', {}, 'Earth counts as in view when '), h('span', { class: 'lensbuttons two' }, ruleButtons)),
      h('p', { class: 'caveats' }, `Earth looks about 1.9° wide from the Moon, so its edge can show over a ridge while its centre is hidden; radio also bends a little over a sharp ridge. "Any part" is closer to how a radio link behaves; "its centre" is what the region search uses. The Sun counts as up while the centre of its disc clears the terrain; for power, whatever part of its disc shows counts. "Earth in view" means the geometry allows a direct-to-Earth link: the app does not check antennas, transmitter power or ground-station schedules, and where Earth is hidden by terrain a relay would be needed. Terrain is NASA LOLA at about 80 m per pixel, so rocks and small craters are not seen. Times are checked every hour. The spots are the best ones the search found for your current landing time; on other dates other spots nearby may do better.`));
  }

  return { update, resetWindow, getLast: () => last };
}

/**
 * Rows per region: each day takes the best passing landing over the region's spots, or, if none passes, the
 * reason most common across them.
 */
function groupByRegion(spotRows) {
  const byName = new Map();
  for (const r of spotRows) {
    const name = r.spot.region ?? r.spot.name;
    if (!byName.has(name)) byName.set(name, { name, fromSearch: r.spot.fromSearch, spots: [] });
    byName.get(name).spots.push(r);
  }
  return [...byName.values()].map((region) => {
    const ok = region.spots.filter((r) => r.days);
    if (!ok.length) return { ...region, error: region.spots[0]?.error ?? 'No data' };
    const days = ok[0].days.map((_, d) => {
      let best = null;
      let row = null;
      let passHours = 0;
      const reasonCounts = {};
      for (const r of ok) {
        const day = r.days[d];
        if (day.best && (!best || day.best.score > best.score)) {
          best = day.best;
          row = r;
          passHours = day.passHours;
        }
        for (const [reason, n] of Object.entries(day.reasonCounts)) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + n;
      }
      const reason = best ? null : Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { day: d, best, row, passHours, reason, reasonCounts };
    });
    return { ...region, days };
  });
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
