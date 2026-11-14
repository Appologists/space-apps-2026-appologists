// App entry point. Holds the state and wires the pieces together:
//
//   mission + sites ──▶ criteria (src/criteria) ──▶ ranking (src/scoring) ──▶ panel, globe, detail card
//
// Changing the mission re-evaluates every site. Changing a weight only re-ranks. Moving the time
// slider only moves the Sun on the globe and updates the selected site's card.
import './styles.css';
import sitesData from '../data/sites.json';
import { criteria, defaultWeights, plannedCriteria, readyCriteria } from './criteria/index.js';
import { formatUTC } from './format.js';
import { createGlobe } from './globe/globe.js';
import { defaultMission, stepMinutesFor } from './mission.js';
import { createContext, evaluateSites, rankSites } from './scoring/rank.js';
import { wrapLon } from './astro/coords.js';
import { coverageText, terrainCovers, terrainInfo } from './terrain/client.js';
import { renderDetail } from './ui/detail.js';
import { createFinderMode } from './ui/finder-mode.js';
import { createSurfaceMode } from './ui/surface-mode.js';
import { renderTerrainPicker } from './ui/terrain-picker.js';
import { renderMission, renderRanking, renderWeights } from './ui/panel.js';

const $ = (id) => document.getElementById(id);
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const CATEGORY_COLORS = Object.fromEntries(Object.keys(sitesData.categories).map((id) => [id, cssVar(`--cat-${id}`) || '#888888']));
const CRITERION_COLORS = { sunlight: 'var(--sun)', earthComms: 'var(--earth)' };
const TOP_LABELS = 3; // how many top-ranked sites get a name label on the globe

const state = {
  mission: defaultMission(),
  weights: defaultWeights(),
  customSite: null, // the user's own point, if any
  selectedId: null,
  viewIndex: 0, // which sample of the mission window the globe and the card show
  started: false,
  terrain: null, // what /api/terrain/info said: which terrain datasets are downloaded, and what they cover
  terrainSource: 'auto', // the dataset the user chose, or 'auto' for the best available
};
let ctx = null;
let evaluations = [];
let ranking = [];

const globe = createGlobe({
  canvas: $('globe'),
  stage: $('stage'),
  labelsEl: $('labels'),
  tipEl: $('tip'),
  textureUrl: `${import.meta.env.BASE_URL}textures/moon_lroc_color_4k.jpg`,
  onStatus: (message) => setStatus(message),
  onPick: (pick) => {
    if (pick.siteId) select(pick.siteId);
    else setCustomSite(pick.lat, pick.lon);
  },
  // The two clicks of a double-click have already selected the site or dropped "Your point" there.
  onDoublePick: (pick) => lookAround(pick.siteId ? allSites().find((s) => s.id === pick.siteId) : state.customSite),
});

let statusTimer = null;
/** Show a message in the pill at the top of the stage; null hides it. */
function setStatus(message, hideAfterMs) {
  clearTimeout(statusTimer);
  $('status').hidden = !message;
  if (message) $('status').textContent = message;
  if (message && hideAfterMs) statusTimer = setTimeout(() => setStatus(null), hideAfterMs);
}

const surface = createSurfaceMode({
  app: document.querySelector('.app'),
  getState: () => ({ ctx, viewIndex: state.viewIndex, terrainSource: state.terrainSource }),
  setStatus,
});

const finder = createFinderMode({
  app: document.querySelector('.app'),
  getState: () => ({
    mission: state.mission,
    weights: state.weights,
    terrain: state.terrain,
    terrainSource: state.terrainSource,
    site: allSites().find((s) => s.id === state.selectedId) ?? null,
  }),
  setStatus,
  onPick: (lat, lon) => setCustomSite(lat, lon),
});

/** The "Terrain data" picker: which dataset the surface view and the finder use. */
function drawTerrainPicker() {
  renderTerrainPicker($('terrainPicker'), {
    info: state.terrain,
    selected: state.terrainSource,
    onSelect: (id) => {
      state.terrainSource = id;
      drawTerrainPicker();
      drawDetail();
      finder.drawForm();
      moveSurfaceTo(allSites().find((s) => s.id === state.selectedId)); // if standing on the surface, reload it
    },
  });
}

/** Stand on the surface at a site and look around, if terrain data covers it. */
async function lookAround(site) {
  if (!site) return;
  const info = await terrainInfo();
  if (!info.available) {
    return setStatus(`The surface view needs terrain data. Run "${info.hint ?? 'npm run data:fetch -- lola-south-80s-80m'}", then reload.`, 10_000);
  }
  if (!terrainCovers(info, site.lat, state.terrainSource)) {
    return setStatus(`No terrain data here: the chosen terrain data covers ${coverageText(info, state.terrainSource)}.`, 7000);
  }
  await surface.open(site);
}

const allSites = () => (state.customSite ? [...sitesData.sites, state.customSite] : sitesData.sites);

/** The mission or the list of sites changed: recompute Sun/Earth positions and every criterion. */
function evaluate() {
  ctx = createContext(state.mission);
  evaluations = evaluateSites(allSites(), criteria, ctx);
  const last = ctx.series.samples.length - 1;
  state.viewIndex = Math.min(state.viewIndex, last);
  $('viewTime').max = String(last);
  surface.missionChanged();
  rank();
  showViewTime();
}

/** The weights changed (or evaluate() just ran): re-rank and redraw. */
function rank() {
  ranking = rankSites(evaluations, state.weights);
  if (!state.started) {
    state.started = true;
    state.selectedId = ranking[0]?.site.id ?? null; // open on the best site, once
  } else if (!ranking.some((r) => r.site.id === state.selectedId)) {
    state.selectedId = null;
  }
  renderRanking($('ranking'), ranking, {
    selectedId: state.selectedId,
    categories: sitesData.categories,
    colors: CATEGORY_COLORS,
    criterionColors: CRITERION_COLORS,
    onSelect: (id) => select(id, { focus: true }),
  });
  globe.setSites(
    ranking.map((r) => ({
      ...r.site,
      color: CATEGORY_COLORS[r.site.category] ?? '#888888',
      label:
        r.rank != null && r.rank <= TOP_LABELS ? `${r.rank}  ${r.site.name}` : r.site.id === state.selectedId ? r.site.name : null,
    })),
  );
  globe.setSelected(state.selectedId);
  drawDetail();
}

function drawDetail() {
  renderDetail($('detail'), {
    entry: ranking.find((r) => r.site.id === state.selectedId) ?? null,
    ctx,
    viewIndex: state.viewIndex,
    criteria: readyCriteria,
    meta: sitesData,
    surface: {
      info: state.terrain,
      covered: terrainCovers(state.terrain, allSites().find((s) => s.id === state.selectedId)?.lat ?? 90, state.terrainSource),
      coverage: coverageText(state.terrain, state.terrainSource),
      onLookAround: () => lookAround(allSites().find((s) => s.id === state.selectedId)),
    },
    onScrub: setViewIndex,
    onClose: () => {
      state.selectedId = null;
      globe.setSelected(null);
      $('detail').hidden = true;
      $('ranking').querySelector('[aria-current]')?.removeAttribute('aria-current');
      finder.drawForm();
    },
  });
}

function select(id, { focus = false } = {}) {
  state.selectedId = id;
  rank();
  const site = allSites().find((s) => s.id === id);
  if (focus && site) globe.focus(site.lat, site.lon);
  moveSurfaceTo(site);
  finder.drawForm();
}

/** Already standing on the surface? Move to the newly chosen site, or go back to the globe if it has no terrain. */
function moveSurfaceTo(site) {
  if (!surface.isOpen() || !site) return;
  if (terrainCovers(state.terrain, site.lat, state.terrainSource)) surface.open(site);
  else surface.close();
}

function setCustomSite(lat, lon) {
  state.customSite = { id: 'custom', name: 'Your point', lat, lon: wrapLon(lon), category: 'custom' };
  state.selectedId = 'custom';
  evaluate();
  moveSurfaceTo(state.customSite);
  finder.drawForm();
}

function showViewTime() {
  const sample = ctx.series.samples[state.viewIndex];
  globe.setSunEarth(sample.sunKm, sample.earthKm);
  $('viewTime').value = String(state.viewIndex);
  const day = (state.viewIndex * ctx.stepHours) / 24;
  $('viewTimeText').textContent = `${formatUTC(sample.date)} · day ${day.toFixed(1)} of ${(state.mission.durationHours / 24).toFixed(1)}`;
  surface.timeChanged();
}

function setViewIndex(index) {
  state.viewIndex = Math.min(Math.max(index, 0), ctx.series.samples.length - 1);
  showViewTime();
  drawDetail();
}

// ---- Controls ---------------------------------------------------------------------------------------
function drawMission() {
  renderMission($('mission'), state.mission, (patch) => {
    Object.assign(state.mission, patch);
    if (patch.durationHours) {
      state.mission.stepMinutes = stepMinutesFor(patch.durationHours);
      state.viewIndex = 0;
    }
    if (patch.start) state.viewIndex = 0;
    evaluate();
  });
}

renderWeights($('weights'), readyCriteria, plannedCriteria, state.weights, (id, weight) => {
  state.weights[id] = weight;
  rank();
});

$('viewTime').addEventListener('input', (e) => setViewIndex(Number(e.target.value)));

let playing = false;
let lastFrame = 0;
let carry = 0;
$('play').addEventListener('click', () => {
  playing = !playing;
  $('play').setAttribute('aria-pressed', String(playing));
  $('play').textContent = playing ? 'Pause' : 'Play';
  lastFrame = performance.now();
  if (playing) requestAnimationFrame(tick);
});
function tick(now) {
  if (!playing) return;
  // Play the whole mission window in about 20 seconds, then loop.
  const samples = ctx.series.samples.length;
  carry += ((now - lastFrame) / 20_000) * samples;
  lastFrame = now;
  if (carry >= 1) {
    const steps = Math.floor(carry);
    carry -= steps;
    setViewIndex((state.viewIndex + steps) % samples);
  }
  requestAnimationFrame(tick);
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => globe.view(button.dataset.view)));
$('zoomIn').addEventListener('click', () => globe.zoomBy(1.4));
$('zoomOut').addEventListener('click', () => globe.zoomBy(1 / 1.4));

$('addPoint').addEventListener('submit', (e) => {
  e.preventDefault();
  const lat = parseFloat($('addLat').value);
  const lon = parseFloat($('addLon').value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return;
  setCustomSite(lat, lon);
  globe.focus(lat, wrapLon(lon));
});

// ---- Start ------------------------------------------------------------------------------------------
drawMission();
evaluate();
finder.drawForm();
drawTerrainPicker();
terrainInfo().then((info) => {
  state.terrain = info;
  drawDetail(); // the site card can now offer "Look around from here"
  finder.drawForm();
  drawTerrainPicker();
});
{
  const top = ranking[0]?.site;
  if (top) globe.focus(top.lat, top.lon); // open looking at the best site
}

// Handy in the browser console while developing.
window.__app = { state, globe, surface, finder, lookAround, get ctx() { return ctx; }, get ranking() { return ranking; } };
