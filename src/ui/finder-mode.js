// The landing-site finder: runs the search, shows the result as a map over the stage, and lists the best
// sites. Like surface-mode.js, it owns its part of the page and talks to main.js through callbacks.
import { searchLanding, searchQuestion } from '../finder/client.js';
import { latLonToCell } from '../finder/grid.js';
import { pathStats, reachFrom } from '../finder/route.js';
import { MAX_DESTINATIONS, latestDeparture, planMission } from '../finder/planner.js';
import { destinationName, planText } from '../finder/plan-text.js';
import { MAP_LAYERS, createFinderMap } from '../finder/map-view.js';
import { defaultFinder } from '../finder/score.js';
import { coverageText, terrainCovers } from '../terrain/client.js';
import { formatHours, formatLatLon } from '../format.js';
import { clear, debounce, h } from './dom.js';
import { renderFinderForm } from './finder-form.js';
import { renderSchedule } from './finder-schedule.js';

const $ = (id) => document.getElementById(id);
const percent = (fraction) => `${Math.round(fraction * 100)}%`;

/**
 * @param {Object} options
 * @param {HTMLElement} options.app   the .app element (gets the class "finder-open")
 * @param {() => {mission: import('../mission.js').Mission, weights: Object<string, number>, terrain: object|null, site: {name: string, lat: number, lon: number}|null}} options.getState
 * @param {(message: string|null, hideAfterMs?: number) => void} options.setStatus
 * @param {(lat: number, lon: number) => void} options.onPick   the user chose a point on the map or in the list
 * @param {(route: {result: object, start: object|null, targets: object[], plan: object|null}) => void} [options.onRoute]
 *        the start, the destinations or the plan changed (the mission steps play the drive back from this)
 */
export function createFinderMode({ app, getState, setStatus, onPick, onRoute }) {
  const values = defaultFinder();
  let map = null; // created the first time a result is shown
  let result = null;
  let centreName = '';
  let busy = false;
  let layerId = MAP_LAYERS[0].id;
  // Reach and route: where the rover starts (the landing point), where it is going, and what it can reach.
  let clickMode = 'start'; // what a click on the map sets: 'start' or 'dest'
  let start = null; // { row, col, lat, lon }
  let targets = []; // destinations, in the order added: { row, col, lat, lon }
  let reach = null;
  let plan = null; // the latest plan, or null when there are no destinations
  let departHours = 0; // "leave no earlier than", hours after landing

  const CLICK_MODES = [
    ['start', 'Start'],
    ['dest', 'Add destination'],
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
    map?.setTime(null); // back from "sunlight at the time shown" to the chosen layer
    map?.setLayer(id);
  }

  /** Redraw the form. Call when the selected site or the terrain information changes. */
  function drawForm() {
    const { site, terrain, terrainSource } = getState();
    const hint = !terrain
      ? 'Checking for terrain data…'
      : !terrain.available
        ? `Needs terrain data. Run "${terrain.hint ?? 'npm run data:fetch -- lola-south-80s-80m'}", then reload.`
        : !site
          ? 'The search needs a centre. Select a site near the south pole first.'
          : !terrainCovers(terrain, site.lat, terrainSource)
            ? `${site.name} is outside the chosen terrain data, which covers ${coverageText(terrain, terrainSource)}. Select a site inside it, or choose other terrain data.`
            : null;
    renderFinderForm($('finderForm'), { values, centre: site, busy, hint, onChange: (patch) => {
        Object.assign(values, patch);
        if (Object.keys(patch).some((key) => key.startsWith('rover'))) updateRouteSoon(); // no new search needed
        if ('maxDarknessHours' in patch && result) updateRouteSoon(); // the drive plan depends on it
      },
      onSearch: run,
      // When the only problem is where the search is centred, offer a spot that works.
      onUseExample: terrain?.available && (!site || !terrainCovers(terrain, site.lat, terrainSource)) ? () => onPick(-89.45, -137.31) : null,
    });
  }

  /** The whole question for a search centred on a point: the form's values and the mission. */
  function paramsFor(center) {
    const { mission, weights, terrainSource } = getState();
    return searchQuestion({ center, values, mission, weights, source: terrainSource });
  }

  async function run() {
    const { site } = getState();
    if (!site || busy) return;
    busy = true;
    drawForm();
    setStatus('Searching for landing sites… this takes about 10 to 20 seconds.');
    try {
      result = await searchLanding(paramsFor(site));
      centreName = site.name;
      setStatus(null);
      show();
    } catch (error) {
      setStatus(error.message, 9000);
    }
    busy = false;
    drawForm();
  }

  /**
   * Show a search that was run elsewhere (the mission steps search several regions and show one at a time).
   * @param {{lat: number, lon: number}|null} [options.startAt]  where the rover starts; default: the middle
   */
  function showResult(next, name, { startAt = null } = {}) {
    result = next;
    centreName = name;
    show();
    if (startAt) pick(startAt.lat, startAt.lon, 'start');
  }

  /**
   * Add one destination that gives a drive the rover survives: the farthest of the other found sites that works.
   * @returns {boolean} false if no found site gives such a drive
   */
  function suggestDrive() {
    if (!result || !start || !reach) return false;
    const rover = roverNow();
    const others = result.sites
      .map((site) => ({ site, driveM: reach.dist[site.row * result.n + site.col] }))
      .filter(({ driveM }) => Number.isFinite(driveM) && driveM > 3 * result.cellM)
      .sort((a, b) => b.driveM - a.driveM);
    for (const { site } of others) {
      const target = { row: site.row, col: site.col, lat: site.lat, lon: site.lon };
      if (planMission(result, start, [target], rover, { explain: false }).ok) {
        targets = [target];
        updateRoute();
        return true;
      }
    }
    return false;
  }

  /** A click on the map or on a listed site: sets the start or adds a destination. */
  function pick(lat, lon, as = clickMode) {
    const cell = result ? latLonToCell(result, result.center, lat, lon) : null;
    if (as === 'dest') {
      if (!cell) return;
      if (targets.length >= MAX_DESTINATIONS) {
        $('finderRoute').textContent = `At most ${MAX_DESTINATIONS} destinations. Remove one to add another.`;
        return;
      }
      targets.push({ ...cell, lat, lon });
      updateRoute();
      return;
    }
    start = cell ? { ...cell, lat, lon } : null;
    onPick(lat, lon); // also makes it the app's selected point, so "Look around from here" works
    updateRoute();
  }

  const roverNow = () => ({
    maxSlopeDeg: values.roverMaxSlopeDeg,
    rangeM: values.roverRangeKm > 0 ? values.roverRangeKm * 1000 : Infinity, // 0: no limit on the total drive
    speedMPerHour: values.roverSpeedMPerHour,
    maxDarknessHours: values.maxDarknessHours,
    needEarthToDrive: values.roverNeedsEarthToDrive,
    departHours,
  });

  function removeTarget(i) {
    targets.splice(i, 1);
    updateRoute();
  }

  /** The destination list: visiting order when there is a plan, otherwise the order added. */
  function drawDests() {
    const el = clear($('finderDests'));
    if (!targets.length) return;
    const order = plan?.order?.length ? plan.order : targets.map((_, i) => i);
    for (const i of order) {
      const t = targets[i];
      const stop = plan?.stops?.find((s) => s.destination === i);
      el.append(
        h('div', { class: 'dest-row' },
          h('span', { class: 'dest-letter' }, destinationName(i)),
          h('span', { class: 'dest-coords' }, formatLatLon(t.lat, t.lon, 3)),
          h('span', { class: 'dest-arrival' }, stop ? `arrives ${formatHours(stop.arrivalHours)} after landing` : ''),
          h('button', { type: 'button', onClick: () => removeTarget(i) }, 'Remove')),
      );
    }
    el.append(h('button', { type: 'button', class: 'dest-clear', onClick: () => { targets = []; updateRoute(); } }, 'Clear destinations'));
  }

  /** Recompute what the rover can reach from the start, and the plan for the destinations if there are any. */
  function updateRoute() {
    if (!result || !map) return;
    const rover = roverNow();
    reach = start ? reachFrom(result, start, { maxSlopeDeg: rover.maxSlopeDeg, rangeM: rover.rangeM }) : null;
    map.setReach(reach);
    map.setSelected(start ? { lat: start.lat, lon: start.lon } : null);
    plan = null;
    let text = null;
    let routeText = '';
    if (!start) {
      routeText = 'Click the map to choose where the rover starts.';
      map.setRoute(null);
    } else if (!targets.length) {
      const limits = `${values.roverRangeKm > 0 ? `within ${values.roverRangeKm} km ` : ''}on slopes up to ${values.roverMaxSlopeDeg}°`;
      let cells = 0;
      for (let i = 0; i < reach.dist.length; i++) if (Number.isFinite(reach.dist[i])) cells++;
      const area = (cells * result.cellM * result.cellM) / 1e6;
      routeText =
        cells <= 1
          ? `From the start the rover cannot move: the ground there is steeper than ${values.roverMaxSlopeDeg}°, or off the map.`
          : `From the start the rover can reach ${area.toFixed(area < 10 ? 1 : 0)} km² ${limits}. Choose "Add destination" and click the map to plan a drive. The "Reach" layer shows how far each spot is.`;
      map.setRoute(null);
    } else {
      plan = planMission(result, start, targets, rover);
      text = planText(result, plan, { rover, destinations: targets });
      if (plan.path) {
        const s = pathStats(result, plan.path, { speedMPerHour: rover.speedMPerHour });
        const km = s.distanceM / 1000;
        routeText = `Planned route: ${km.toFixed(km < 10 ? 1 : 0)} km, steepest slope ${s.steepestDeg.toFixed(0)}°, climbing ${Math.round(s.climbM)} m and descending ${Math.round(s.descentM)} m.`;
      }
      map.setRoute({
        path: plan.path,
        stops: targets.map((t, i) => ({ row: t.row, col: t.col, label: destinationName(i) })),
        waits: plan.waits ?? [],
      });
    }
    $('finderRoute').textContent = routeText;
    drawDests();
    drawSchedule(text);
    onRoute?.({ result, start, targets, plan });
  }

  function drawSchedule(text) {
    renderSchedule($('finderSchedule'), {
      result,
      plan,
      text,
      departHours,
      onDepart: (hours) => {
        departHours = Math.max(0, hours);
        updateRoute();
      },
      onFindLatest: () => {
        const found = latestDeparture(result, start, targets, roverNow());
        if (found) {
          departHours = found.departHours;
          updateRoute();
        }
      },
    });
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
    targets = [];
    departHours = 0;
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
      `Every point within ${params.ellipseRadiusM} m of a site must pass. Checked on ${cellM} m cells; the terrain data is ${result.sourceLabel ?? 'NASA LOLA'} at about ${Math.round(result.terrainPixelM ?? cellM)} m per pixel, so hills show, rocks and small craters do not. ${result.sourceNote ? `${result.sourceNote} ` : ''}` +
      'The Sun and Earth count as visible when the centre of their disc clears the terrain. Darkness at the very start or end of the mission may be longer than shown. ' +
      'Click the map or a site, then "Look around from here" to stand there.';
  }

  function close() {
    app.classList.remove('finder-open');
    $('finder').hidden = true;
  }
  $('finderBack')?.addEventListener('click', close);

  return {
    drawForm,
    close,
    isOpen: () => !$('finder').hidden,
    getResult: () => result,
    // For the mission steps (src/ui/flow.js):
    values,
    paramsFor,
    showResult,
    /** Bring the map of the last result back after close(). */
    open: () => {
      if (!result) return;
      app.classList.add('finder-open');
      $('finder').hidden = false;
      map?.resize();
    },
    pick,
    setClickMode,
    suggestDrive,
    clearTargets: () => {
      targets = [];
      updateRoute();
    },
    getRoute: () => ({ start, targets, reach, plan }),
    getMap: () => map,
    debug: { pick, route: () => ({ start, targets, reach, plan }) },
  };
}
