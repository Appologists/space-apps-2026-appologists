// "Look around from here": opens the surface view for a site, keeps it in step with the mission and the
// time slider, and fills the heads-up panel (what you can see now, and what real terrain does to the
// mission's sunlight and Earth contact).
import { altAz, horizonDipDeg, skySeries, visibilityStats } from '../astro/sky.js';
import { compass, formatHours, formatLatLon } from '../format.js';
import { LENSES } from '../surface/lenses.js';
import { createSurfaceView } from '../surface/surface-view.js';
import { fetchTerrainPatch } from '../terrain/client.js';
import { clearanceSeries, horizonAt, horizonProfile } from '../terrain/polar-grid.js';
import { clear, h } from './dom.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {Object} options
 * @param {HTMLElement} options.app                 the .app element (gets the class "surface-open")
 * @param {() => {ctx: import('../criteria/types.js').Context, viewIndex: number}} options.getState
 * @param {(message: string|null, hideAfterMs?: number) => void} options.setStatus
 */
export function createSurfaceMode({ app, getState, setStatus }) {
  let view = null; // the 3D view, created the first time it is needed
  let current = null; // { site, patch, sky, profiles }
  let eyeHeightM = 1.7;
  let request = 0;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- Camera moves for the arrival and the departure (see open() and close()) ------------------------------
  const DESCENT_FROM_M = 3500; // the arrival starts this high above the ground, looking down
  let tween = null;
  const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  /**
   * Move the eye from one height and look to another. Heights change in log space, so the ground rushes up
   * at the end like a landing. Resolves at the end, or at once if cut short.
   */
  function moveEye(from, to, duration) {
    tween?.stop();
    return new Promise((resolve) => {
      const t0 = performance.now();
      let raf = 0;
      const yawTurn = ((((to.yaw - from.yaw) % 360) + 540) % 360) - 180; // the short way round
      const step = (now) => {
        const k = Math.min((now - t0) / duration, 1);
        const e = easeInOut(k);
        view.setEyeHeight(Math.exp(Math.log(from.height) + (Math.log(to.height) - Math.log(from.height)) * e));
        view.setLook({ yaw: from.yaw + yawTurn * e, pitch: from.pitch + (to.pitch - from.pitch) * e, fov: from.fov + (to.fov - from.fov) * e });
        if (k < 1) raf = requestAnimationFrame(step);
        else finish();
      };
      const finish = () => {
        cancelAnimationFrame(raf);
        if (tween) clearTimeout(tween.guard);
        tween = null;
        resolve();
      };
      tween = {
        // Cut short (the user grabbed the view): jump to the end height and keep whatever look they have.
        stop: () => {
          view.setEyeHeight(to.height);
          finish();
        },
      };
      raf = requestAnimationFrame(step);
      // If the browser stops drawing frames (a hidden tab), land anyway rather than hang half-way.
      const guard = setTimeout(() => {
        if (tween?.guard !== guard) return;
        view.setEyeHeight(to.height);
        view.setLook({ yaw: to.yaw, pitch: to.pitch, fov: to.fov });
        finish();
      }, duration + 1500);
      tween.guard = guard;
    });
  }

  // ---- Lenses: switch, legend and the read-out under the pointer ----------------------------------------
  let lensId = 'natural';
  const lensButtons = LENSES.map((lens) =>
    h('button', { type: 'button', 'aria-pressed': String(lens.id === lensId), onClick: () => chooseLens(lens.id) }, lens.label),
  );
  $('lensButtons').append(...lensButtons);
  function chooseLens(id) {
    lensId = id;
    lensButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(LENSES[i].id === id)));
    view?.setLens(id);
  }
  /** Draw the legend the view hands back for the active lens (null for the natural view). */
  function showLegend(legend) {
    const el = $('lensLegend');
    el.hidden = !legend;
    if (!legend) return;
    const last = legend.stops.length - 1;
    const ticks = legend.stops.map((stop, i) => ({ ...stop, at: i / last })).filter((stop) => stop.label);
    const scale = [
      h(
        'div',
        { class: 'legend-ramp', style: `background: linear-gradient(to right, ${legend.stops.map((s) => s.hex).join(', ')})` },
        legend.marker ? h('i', { class: 'legend-marker', style: `left: ${(legend.marker.at * 100).toFixed(1)}%` }) : null,
      ),
      legend.positioned
        ? h('div', { class: 'legend-ticks positioned' }, ticks.map((t) => h('span', { style: `left: ${(t.at * 100).toFixed(1)}%` }, t.label)))
        : h('div', { class: 'legend-ticks' }, ticks.map((t) => h('span', {}, t.label))),
      legend.marker ? h('div', { class: 'legend-you' }, `White line: ${legend.marker.label.replace('You: ', 'where you stand, ')}`) : null,
    ];
    clear(el).append(h('div', { class: 'legend-title' }, legend.title), ...scale.filter(Boolean), h('p', { class: 'legend-note' }, legend.note));
  }
  /** Say what the pointer is on: height, slope, and how far away. */
  function showHover(point, clientX, clientY) {
    const tip = $('surfaceTip');
    tip.hidden = !point;
    if (!point) return;
    const metres = (m) => `${m < 0 ? '−' : ''}${Math.abs(Math.round(m)).toLocaleString('en-US')} m`;
    const far = point.distanceM < 1000 ? `${Math.round(point.distanceM)} m` : `${(point.distanceM / 1000).toFixed(point.distanceM < 10_000 ? 1 : 0)} km`;
    const slope = Number.isNaN(point.slopeDeg) ? '' : ` · slope ${point.slopeDeg.toFixed(0)}°`;
    const height = Number.isNaN(point.elevationM) ? 'no data' : metres(point.elevationM);
    tip.textContent = `${height}${slope} · ${far} to the ${compass(point.bearingDeg)}`;
    const rect = $('surface').getBoundingClientRect();
    const x = Math.min(clientX - rect.left + 14, rect.width - tip.offsetWidth - 6);
    tip.style.transform = `translate(${x}px, ${clientY - rect.top + 18}px)`;
  }

  const showHeading = ({ yaw, pitch }) => {
    $('hudHeading').textContent = `Looking ${compass(yaw)} · ${String(Math.round(yaw) % 360).padStart(3, '0')}° · ${pitch >= 0 ? '+' : '−'}${Math.abs(pitch).toFixed(0)}°`;
  };

  /**
   * @param {object} site
   * @param {{intro?: {revealAfter?: Promise<unknown>, onReveal?: () => void}}} [options]  intro: arrive from
   *        above. The view stays invisible until the terrain is in and `revealAfter` settles (the globe's
   *        fly-in); then `onReveal` runs and the view fades in while the eye comes down.
   * @returns {Promise<boolean>} true if the view opened
   */
  async function open(site, { intro = null } = {}) {
    const mine = ++request;
    setStatus('Loading terrain…');
    let patch;
    try {
      patch = await fetchTerrainPatch(site.lat, site.lon, getState().terrainSource);
    } catch (error) {
      if (mine === request) setStatus(error.message, 8000);
      return false;
    }
    if (mine !== request) return false; // a newer request replaced this one
    setStatus(null);
    const arriving = !!intro && !reduceMotion;
    $('surface').classList.toggle('surface-intro', arriving);
    app.classList.add('surface-open');
    $('surface').hidden = false;
    $('surfaceTip').hidden = true;
    if (innerWidth <= 900 && $('hudDetails')) $('hudDetails').open = false; // on a phone the panel would cover the view
    if (!view) {
      view = createSurfaceView({
        canvas: $('surfaceCanvas'),
        container: $('surface'),
        labelsEl: $('surfaceLabels'),
        onLook: showHeading,
        onLegend: showLegend,
        onHover: showHover,
      });
      view.setLens(lensId);
    }
    view.resize();
    view.setEyeHeight(eyeHeightM);
    view.setTerrain(patch);
    current = { site: { ...site, elevationM: patch.groundHeightM }, patch };
    missionChanged();
    // Start facing the Sun if it is near or above the horizon, otherwise Earth, otherwise north.
    const { viewIndex } = getState();
    const { sky } = current;
    const yaw = sky.sunEl[viewIndex] > -2 ? sky.sunAz[viewIndex] : sky.earthEl[viewIndex] > -2 ? sky.earthAz[viewIndex] : 0;
    const landed = { height: eyeHeightM, yaw, pitch: 4, fov: 60 };
    if (!arriving) {
      view.setLook({ yaw, pitch: 4, fov: 60 });
      $('surfaceCanvas').focus({ preventScroll: true });
      return true;
    }
    // Arrival: start high up, looking down, a little to one side; wait for the globe; then fade in and come down.
    const above = { height: DESCENT_FROM_M, yaw: yaw - 40, pitch: -70, fov: 72 };
    view.setEyeHeight(above.height);
    view.setLook({ yaw: above.yaw, pitch: above.pitch, fov: above.fov });
    await intro.revealAfter;
    if (mine !== request) return false;
    intro.onReveal?.();
    void $('surface').offsetWidth; // let the invisible state paint first, so the fade runs
    $('surface').classList.remove('surface-intro');
    await moveEye(above, landed, 2600);
    if (mine !== request) return false;
    $('surfaceCanvas').focus({ preventScroll: true });
    return true;
  }

  /**
   * @param {{outro?: boolean}} [options]  outro: lift off and fade out first (resolves when done)
   */
  async function close({ outro = false } = {}) {
    const mine = ++request;
    if (outro && current && view && !reduceMotion && !$('surface').hidden) {
      const look = view.getLook();
      $('surface').classList.add('surface-leaving');
      await moveEye({ height: eyeHeightM, ...look }, { height: DESCENT_FROM_M * 0.6, yaw: look.yaw + 25, pitch: -65, fov: 72 }, 750);
      if (mine !== request) return;
    }
    tween?.stop();
    current = null;
    app.classList.remove('surface-open');
    $('surface').hidden = true;
    $('surface').classList.remove('surface-leaving', 'surface-intro');
    if (view) view.setEyeHeight(eyeHeightM);
  }

  /** The mission (or the eye height) changed: redo the paths, the horizons and the mission numbers. */
  function missionChanged() {
    if (!current) return;
    const { ctx } = getState();
    const { mission } = ctx;
    const { patch, site } = current;
    current.sky = skySeries(site, ctx.series);
    current.profiles = {
      eye: horizonProfile(patch, eyeHeightM),
      panel: horizonProfile(patch, mission.panelHeightM),
      antenna: horizonProfile(patch, mission.antennaHeightM),
    };
    view.setPaths(current.sky);
    drawStatic(ctx);
    timeChanged();
  }

  function drawStatic(ctx) {
    const { mission } = ctx;
    const { site, patch, sky, profiles } = current;
    $('hudTitle').textContent = site.name;
    $('hudCoords').textContent = `${formatLatLon(site.lat, site.lon)} · ground ${Math.round(patch.groundHeightM).toLocaleString('en-US')} m`;

    const real = {
      sun: visibilityStats(clearanceSeries(sky.sunEl, sky.sunAz, profiles.panel), mission.minSunElevationDeg, ctx.stepHours),
      earth: visibilityStats(clearanceSeries(sky.earthEl, sky.earthAz, profiles.antenna), mission.minEarthElevationDeg, ctx.stepHours),
    };
    // The smooth-Moon numbers are the ones the ranked list uses: same site, no terrain, ground at the mean radius.
    const smoothSky = ctx.sky({ lat: site.lat, lon: site.lon });
    const smooth = {
      sun: visibilityStats(smoothSky.sunEl, mission.minSunElevationDeg - horizonDipDeg(mission.panelHeightM), ctx.stepHours),
      earth: visibilityStats(smoothSky.earthEl, mission.minEarthElevationDeg - horizonDipDeg(mission.antennaHeightM), ctx.stepHours),
    };
    const pct = (stats) => `${Math.round(stats.fraction * 100)}%`;
    clear($('hudStats')).append(
      h(
        'li',
        {},
        h('i', { class: 'dot', style: 'background:var(--sun)' }),
        ` Solar panel ${mission.panelHeightM} m up: lit ${pct(real.sun)} of the time, longest unbroken ${formatHours(real.sun.longestRunHours)}.`,
        h('small', {}, `A smooth Moon would give ${pct(smooth.sun)} and ${formatHours(smooth.sun.longestRunHours)}.`),
      ),
      h(
        'li',
        {},
        h('i', { class: 'dot', style: 'background:var(--earth)' }),
        ` Antenna ${mission.antennaHeightM} m up: Earth in view ${pct(real.earth)} of the time, longest pass ${formatHours(real.earth.longestRunHours)}.`,
        h('small', {}, `A smooth Moon would give ${pct(smooth.earth)}.`),
      ),
    );
    const edge = patch.coverage < 0.995 && patch.dataEdgeM ? ` The data ends ${Math.round(patch.dataEdgeM / 1000)} km away in some directions; ground beyond is drawn flat and blue-grey.` : '';
    $('hudNotes').textContent =
      `Terrain: ${patch.sourceLabel ?? 'NASA LOLA'} data, about ${Math.round(patch.pixelM)} m per pixel, so no rocks or small craters.${patch.sourceNote ? ` ${patch.sourceNote}` : ''} The fine grain on the ground is decoration, not data. Shadows are computed from the terrain; ground in shadow is brightened a little so you can see its shape.${edge}`;
  }

  /** The time slider moved: move the Sun and Earth and say what is visible now. */
  function timeChanged() {
    if (!current) return;
    const { ctx, viewIndex } = getState();
    const sample = ctx.series.samples[viewIndex];
    const { site, patch, sky, profiles } = current;
    // From high ground you see past the level horizon: a smooth Moon's horizon sits lower the higher you stand.
    const smoothHorizon = -horizonDipDeg(Math.max(patch.groundHeightM, 0) + eyeHeightM);
    const signed = (deg) => `${deg >= 0 ? '+' : '−'}${Math.abs(deg).toFixed(1)}°`;

    const describe = (name, now, elevations, azimuths) => {
      const terrain = horizonAt(profiles.eye, now.azimuth);
      const state = now.elevation > terrain ? 'visible' : now.elevation > smoothHorizon ? 'behind' : 'below';
      const where = compass(now.azimuth);
      const text =
        state === 'visible'
          ? `Visible to the ${where} at ${signed(now.elevation)} elevation. It clears the terrain by ${(now.elevation - terrain).toFixed(1)}°.`
          : state === 'behind'
            ? `Hidden behind terrain to the ${where}. It is at ${signed(now.elevation)} elevation; the terrain there reaches ${signed(terrain)}.`
            : `Below the horizon to the ${where}, at ${signed(now.elevation)} elevation.`;
      // When does that change? Walk forward through the mission.
      const visibleNow = state === 'visible';
      let hours = null;
      for (let i = viewIndex + 1; i < elevations.length; i++) {
        if (elevations[i] > horizonAt(profiles.eye, azimuths[i]) !== visibleNow) {
          hours = (i - viewIndex) * ctx.stepHours;
          break;
        }
      }
      const next = hours == null ? 'No change for the rest of the mission.' : `${visibleNow ? 'Disappears' : 'Appears'} in ${formatHours(hours)}.`;
      const label = state === 'visible' ? name : `${name} (${state === 'behind' ? 'behind terrain' : 'below horizon'})`;
      return { text, next, label };
    };

    const sunNow = altAz(site, sample.sunKm);
    const earthNow = altAz(site, sample.earthKm);
    const sun = describe('Sun', sunNow, sky.sunEl, sky.sunAz);
    const earth = describe('Earth', earthNow, sky.earthEl, sky.earthAz);
    view.setSky({ sun: sunNow, earth: earthNow, sunText: sun.label, earthText: earth.label });
    clear($('hudSky')).append(
      h('dt', {}, h('i', { class: 'dot', style: 'background:var(--sun)' }), 'Sun'),
      h('dd', {}, sun.text, h('small', {}, sun.next)),
      h('dt', {}, h('i', { class: 'dot', style: 'background:var(--earth)' }), 'Earth'),
      h('dd', {}, earth.text, h('small', {}, earth.next)),
    );
  }

  $('eyeHeight').addEventListener('input', (e) => {
    const value = parseFloat(e.target.value);
    if (!Number.isFinite(value) || value <= 0 || !current) return;
    eyeHeightM = value;
    view.setEyeHeight(value);
    current.profiles.eye = horizonProfile(current.patch, value);
    timeChanged();
  });
  $('surfaceBack')?.addEventListener('click', () => close({ outro: true }));
  // Grabbing the view during the arrival ends it: the user is in charge from then on.
  $('surfaceCanvas').addEventListener('pointerdown', () => tween?.stop());
  $('surfaceCanvas').addEventListener('wheel', () => tween?.stop(), { passive: true });

  return {
    open,
    close,
    isOpen: () => !!current,
    missionChanged,
    timeChanged,
    getView: () => view,
    /** Where the open view is centred, or null. */
    getSite: () => current?.site ?? null,
    /** Drive the viewpoint over the open terrain: metres east and north of where the view was opened. */
    setPosition: (eastM, northM, look) => {
      if (!current) return;
      view.setPosition(eastM, northM);
      if (look) view.setLook(look);
    },
  };
}
