// The landing-site finder: runs the search, shows the result as a map over the stage, and lists the best
// sites. Like surface-mode.js, it owns its part of the page and talks to main.js through callbacks.
import { finderStepMinutes, searchLanding } from '../finder/client.js';
import { latLonToCell } from '../finder/grid.js';
import { pathStats, pathTo, reachFrom } from '../finder/route.js';
import { MAP_LAYERS, createFinderMap } from '../finder/map-view.js';
import { defaultFinder } from '../finder/score.js';
import { terrainCovers } from '../terrain/client.js';
import { formatHours, formatLatLon } from '../format.js';
import { clear, debounce, h } from './dom.js';
import { renderFinderForm } from './finder-form.js';

const $ = (id) => document.getElementById(id);
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/**
 * @param {Object} options
 * @param {HTMLElement} options.app   the .app element (gets the class "finder-open")
 * @param {() => {mission: import('../mission.js').Mission, weights: Object<string, number>, terrain: object|null, site: {name: string, lat: number, lon: number}|null}} options.getState
 * @param {(message: string|null, hideAfterMs?: number) => void} options.setStatus
 * @param {(lat: number, lon: number) => void} options.onPick   the user chose a point on the map or in the list
 */
export function createFinderMode({ app, getState, setStatus, onPick }) {
  const values = defaultFinder();
  let map = null; // created the first time a result is shown
  let result = null;
  let centreName = '';
  let busy = false;
  let layerId = MAP_LAYERS[0].id;
  // Reach and route: where the rover starts (the landing point), where it is going, and what it can reach.
  let clickMode = 'start'; // what a click on the map sets: 'start' or 'dest'
  let start = null; // { row, col, lat, lon }
  let target = null;
  let reach = null;

  const CLICK_MODES = [
    ['start', 'Start'],
    ['dest', 'Destination'],
  ];
  const modeButtons = CLICK_MODES.map(([id, label]) =>
    h('button', { type: 'button', 'aria-pressed': String(id === clickMode), onClick: () => setClickMode(id) }, label),
  );
  $('finderClickMode').append(...modeButtons);
  function setClickMode(id) {
    clickMode = id;
    modeButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(CLICK_MODES[i][0] === id)));
  }

  const layerButtons = MAP_LAYERS.map((layer) =>
    h('button', { type: 'button', 'aria-pressed': String(layer.id === layerId), onClick: () => chooseLayer(layer.id) }, layer.label),
  );
  $('finderLayers').append(...layerButtons);
  function chooseLayer(id) {
    layerId = id;
    layerButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(MAP_LAYERS[i].id === id)));
    map?.setLayer(id);
  }

  /** Redraw the form. Call when the selected site or the terrain information changes. */
  function drawForm() {
    const { site, terrain } = getState();
    const hint = !terrain
      ? 'Checking for terrain data…'
      : !terrain.available
        ? `Needs terrain data. Run "${terrain.hint ?? 'npm run data:fetch -- lola-south-80s-80m'}", then reload.`
        : !site
          ? 'Select a site first.'
          : !terrainCovers(terrain, site.lat)
            ? `Choose a centre south of ${Math.abs(terrain.coversSouthOfLat)}° S: the terrain data stops there.`
            : null;
    renderFinderForm($('finderForm'), { values, centre: site, busy, hint, onChange: (patch) => {
        Object.assign(values, patch);
        if (Object.keys(patch).some((key) => key.startsWith('rover'))) updateRouteSoon(); // no new search needed
      },
      onSearch: run,
    });
  }

  async function run() {
    const { mission, weights, site } = getState();
    if (!site || busy) return;
    busy = true;
    drawForm();
    setStatus('Searching for landing sites… this takes about 10 to 20 seconds.');
    try {
      result = await searchLanding({
        ...values,
        center: { lat: site.lat, lon: site.lon },
        start: mission.start.toISOString(),
        durationHours: mission.durationHours,
        stepMinutes: finderStepMinutes(mission.durationHours),
        panelHeightM: mission.panelHeightM,
        antennaHeightM: mission.antennaHeightM,
        weights: { sunlight: weights.sunlight ?? 1, earthComms: weights.earthComms ?? 0 },
      });
      centreName = site.name;
      setStatus(null);
      show();
    } catch (error) {
      setStatus(error.message, 9000);
    }
    busy = false;
    drawForm();
  }

  /** A click on the map or on a listed site: sets the start or the destination. */
  function pick(lat, lon, as = clickMode) {
    const cell = result ? latLonToCell(result, result.center, lat, lon) : null;
    if (as === 'dest') {
      target = cell ? { ...cell, lat, lon } : null;
      updateRoute();
      return;
    }
    start = cell ? { ...cell, lat, lon } : null;
    onPick(lat, lon); // also makes it the app's selected point, so "Look around from here" works
    updateRoute();
  }

  /** Recompute what the rover can reach from the start, and the path to the destination if there is one. */
  function updateRoute() {
    if (!result || !map) return;
    const rover = { maxSlopeDeg: values.roverMaxSlopeDeg, rangeM: values.roverRangeKm * 1000 };
    reach = start ? reachFrom(result, start, rover) : null;
    map.setReach(reach);
    map.setSelected(start ? { lat: start.lat, lon: start.lon } : null);
    const path = reach && target ? pathTo(reach, target) : null;
    map.setRoute(target ? { path, target } : null);

    const limits = `within ${values.roverRangeKm} km on slopes up to ${values.roverMaxSlopeDeg}°`;
    let text;
    if (!start) {
      text = 'Click the map to choose where the rover starts.';
    } else if (!target) {
      let cells = 0;
      for (let i = 0; i < reach.dist.length; i++) if (Number.isFinite(reach.dist[i])) cells++;
      const area = (cells * result.cellM * result.cellM) / 1e6;
      text =
        cells <= 1
          ? `From the start the rover cannot move: the ground there is steeper than ${values.roverMaxSlopeDeg}°, or off the map.`
          : `From the start the rover can reach ${area.toFixed(area < 10 ? 1 : 0)} km² ${limits}. Choose "Destination" and click the map to plan a drive. The "Reach" layer shows how far each spot is.`;
    } else if (!path) {
      text = `No drivable path from the start to that destination ${limits}.`;
    } else {
      const s = pathStats(result, path, { speedMPerHour: values.roverSpeedMPerHour });
      const km = s.distanceM / 1000;
      text =
        `Drive: ${km.toFixed(km < 10 ? 1 : 0)} km, about ${formatHours(s.hours)} at ${values.roverSpeedMPerHour} m per hour. ` +
        `Steepest slope on the way ${s.steepestDeg.toFixed(0)}°, climbing ${Math.round(s.climbM)} m and descending ${Math.round(s.descentM)} m. ` +
        `Along the way the worst spot has ${formatHours(s.longestDarkH)} of darkness, is sunlit ${percent(s.minSunFraction)} of the mission and sees Earth ${percent(s.minEarthFraction)} of it. ` +
        'This is the shortest drivable path on this terrain. It does not check that the Sun is up or Earth is in view at the hour the rover passes.';
    }
    $('finderRoute').textContent = text;
  }
  const updateRouteSoon = debounce(updateRoute, 250);

  function show() {
    app.classList.add('finder-open');
    $('finder').hidden = false;
    map ??= createFinderMap({ container: $('finderMap'), canvas: $('finderCanvas'), legendEl: $('finderLegend'), tipEl: $('finderTip'), onPick: ({ lat, lon }) => pick(lat, lon) });
    map.setResult(result);
    map.setLayer(layerId);
    map.resize();
    // A new search starts the rover at the middle of the search area, with no destination.
    const middle = latLonToCell(result, result.center, result.center.lat, result.center.lon);
    start = middle ? { ...middle, lat: result.center.lat, lon: result.center.lon } : null;
    target = null;
    updateRoute();

    const { counts, sites, cellM, radiusKm, computeMs, params } = result;
    const km2 = (cells) => {
      const area = (cells * cellM * cellM) / 1e6;
      return area.toLocaleString('en-US', { maximumFractionDigits: area < 1 ? 2 : area < 100 ? 1 : 0 });
    };
    $('finderTitle').textContent = sites.length ? `${sites.length} landing ${sites.length === 1 ? 'site' : 'sites'} found` : 'No landing site passes';
    const reasons = [
      [counts.slope, 'too steep'],
      [counts.noSun, 'no sunlight at touchdown'],
      [counts.dark, 'darkness too long'],
      [counts.noEarth, 'Earth not in view at touchdown'],
    ]
      .filter(([cells]) => cells > 0)
      .sort((a, b) => b[0] - a[0])
      .map(([cells, text]) => `${text} (${percent(cells / counts.evaluated)})`);
    $('finderSummary').textContent =
      `${km2(counts.passing)} of ${km2(counts.evaluated)} km² within ${radiusKm} km of ${centreName} pass every check. ` +
      (reasons.length ? `Ground that fails: ${reasons.join(', ')}. ` : '') +
      `Searched in ${(computeMs / 1000).toFixed(0)} s.`;
    clear($('finderSites')).append(
      ...sites.map((site) =>
        h(
          'li',
          {},
          h(
            'button',
            { type: 'button', class: 'found-site', onClick: () => pick(site.lat, site.lon, 'start') },
            h('span', { class: 'num' }, `${site.rank}`),
            h('span', {}, formatLatLon(site.lat, site.lon, 3), h('span', { class: 'rank-score' }, ` ${Math.round(site.score * 100)}`)),
            h(
              'small',
              {},
              `Sunlit ${percent(site.sunFraction)}, longest dark ${formatHours(site.longestDarkH)}, Earth in view ${percent(site.earthFraction)}, slope up to ${site.ellipseSlopeDeg.toFixed(0)}°`,
            ),
          ),
        ),
      ),
    );
    $('finderNotes').textContent =
      `Every point within ${params.ellipseRadiusM} m of a site must pass. Checked on ${cellM} m cells of NASA LOLA terrain: hills show, rocks and small craters do not. ` +
      'The Sun and Earth count as visible when the centre of their disc clears the terrain. Darkness at the very start or end of the mission may be longer than shown. ' +
      'Click the map or a site, then "Look around from here" to stand there.';
  }

  function close() {
    app.classList.remove('finder-open');
    $('finder').hidden = true;
  }
  $('finderBack').addEventListener('click', close);

  return { drawForm, close, isOpen: () => !$('finder').hidden, getResult: () => result, debug: { pick, route: () => ({ start, target, reach }) } };
}
