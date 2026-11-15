// The mission steps: the five views a planner walks through, one after another.
//
//   1 Mission   choose a ready-made mission, or set the lander and the rover yourself
//   2 Regions   which candidate regions that mission can land in (a real terrain search of each)
//   3 Drive     where the rover starts and where it goes, and the trip played back with day and night
//   4 Surface   stand at the landing spot and look around
//   5 Ride      the same view, moving along the route, with the credits
//
// It owns the step bar, Back and Next, and the parts of the left panel that belong to no other module. The
// globe, the finder (finder-mode.js) and the surface view (surface-mode.js) do the work; this file only says
// which of them is on the stage and feeds them the playback clock. Profiles and regions: data/missions.json.
import credits from '../../data/credits.json';
import missions from '../../data/missions.json';
import sitesData from '../../data/sites.json';
import { searchLanding } from '../finder/client.js';
import { createTrack } from '../finder/playback.js';
import { STATE } from '../finder/schedule.js';
import { formatHours, formatUTC } from '../format.js';
import { LUNAR_DAY_HOURS } from '../mission.js';
import { clear, h } from './dom.js';
import { decodeFlow, encodeFlow } from './flow-state.js';

const $ = (id) => document.getElementById(id);

const STEPS = [
  { short: 'Mission', next: 'Find regions that fit' },
  { short: 'Regions', next: 'Plan the drive' },
  { short: 'Drive', next: 'Stand on the surface' },
  { short: 'Surface', next: 'Ride along' },
  { short: 'Ride', next: 'Start again' },
];

/** The regions every mission is checked against, with their coordinates and sources resolved. */
const REGIONS = missions.regions.map((region) => {
  const site = region.site ? sitesData.sites.find((s) => s.id === region.site) : region;
  const sources = region.site ? sitesData.sources : missions.sources;
  // A named crater stands for its middle. The site list's longer note is about the smooth-Moon ranking, not this.
  const note = region.site ? 'The middle of the crater: a reference point, not a vetted landing site.' : (region.note ?? '');
  return { id: region.id, name: site.name, lat: site.lat, lon: site.lon, note, source: sources[site.source] };
});

// The custom mission's controls: a few big choices each, instead of number boxes. `on` says which object holds the value.
const DAY = 24;
const CHOICES = [
  { on: 'mission', key: 'durationHours', label: 'Duration', options: [[7 * DAY, '7 days'], [14 * DAY, '14 days'], [LUNAR_DAY_HOURS, '29.5 days']], format: (v) => formatHours(v) },
  { group: 'Lander' },
  { on: 'finder', key: 'ellipseRadiusM', label: 'Landing accuracy', hint: 'How far from its target it may come down', options: [[50, '50 m'], [100, '100 m'], [500, '500 m']], format: (v) => `${v} m` },
  { on: 'finder', key: 'maxLandingSlopeDeg', label: 'Steepest ground it lands on', options: [[5, '5°'], [10, '10°'], [15, '15°']], format: (v) => `${v}°` },
  { on: 'finder', key: 'needEarthAtLanding', label: 'Earth in view at touchdown', options: [[true, 'Needed'], [false, 'Not needed']] },
  { on: 'finder', key: 'needSunAtLanding', label: 'Sunlight at touchdown', options: [[true, 'Needed'], [false, 'Not needed']] },
  { group: 'Rover' },
  { on: 'finder', key: 'maxDarknessHours', label: 'Darkness it survives', hint: 'Unbroken hours without sunlight', options: [[24, '24 h'], [50, '50 h'], [100, '100 h']], format: (v) => `${v} h` },
  { on: 'finder', key: 'roverMaxSlopeDeg', label: 'Steepest slope it drives', options: [[10, '10°'], [15, '15°'], [20, '20°']], format: (v) => `${v}°` },
  { on: 'finder', key: 'roverSpeedMPerHour', label: 'Average speed', hint: 'Metres an hour, stops included', options: [[36, '36'], [200, '200'], [720, '720']], format: (v) => `${v}` },
  { on: 'finder', key: 'roverRangeKm', label: 'Range', options: [[5, '5 km'], [10, '10 km'], [20, '20 km']], format: (v) => `${v} km` },
  { on: 'finder', key: 'roverNeedsEarthToDrive', label: 'Earth in view to drive', options: [[true, 'Needed'], [false, 'Not needed']] },
];

const STATE_WORDS = {
  [STATE.PARKED]: 'parked at the landing spot',
  [STATE.DRIVING]: 'driving',
  [STATE.WAIT_SUN]: 'waiting for sunlight',
  [STATE.WAIT_EARTH]: 'waiting for Earth to come into view',
  [STATE.HOLD]: 'waiting in sunlight for the way ahead to light up',
  [STATE.ARRIVED]: 'arrived',
  [STATE.LOST]: 'lost: too long in the dark',
};
const FAIL_WORDS = { slope: 'the ground is too steep', noSun: 'no sunlight at touchdown', dark: 'darkness lasts too long', noEarth: 'Earth is not in view at touchdown' };

/**
 * @param {Object} options
 * @param {HTMLElement} options.app
 * @param {ReturnType<import('../globe/globe.js').createGlobe>} options.globe
 * @param {ReturnType<import('./finder-mode.js').createFinderMode>} options.finder
 * @param {ReturnType<import('./surface-mode.js').createSurfaceMode>} options.surface
 * @param {Object} options.api   what main.js lends: getMission(), setMission(patch), stepHours(), viewIndex(),
 *                               setViewIndex(i), standAt(site) and setStatus(message, hideAfterMs)
 */
export function createFlow({ app, globe, finder, surface, api }) {
  let step = 1;
  let furthest = 1; // the last step reached, so the step bar can jump back and forth among visited steps
  let profileId = null;
  // The regions search for one mission. `key` is the question asked; a different mission starts a new one.
  let scan = { key: null, token: 0, results: new Map(), done: false };
  let regionId = null; // the region whose map is on the stage
  let userChoseRegion = false;
  let route = null; // the finder's latest { result, start, targets, plan }
  let track = null; // where the rover is at any hour of the plan (playback.js)
  // One clock for the map and the surface view: hours after landing. `fromHere` stops an echo when this file moves the app's time slider.
  let searchFirst = null; // a region to search before the others (the one a saved address was showing)
  let restoring = false; // while a saved address is being acted on, nothing is written back to it
  const clock = { hours: 0, playing: false, frame: 0, rate: 0, showTime: false, freeLook: false, yaw: null, fromHere: false, sunAt: 0 };

  // ---- Step bar and Back / Next ---------------------------------------------------------------------------
  const stepButtons = STEPS.map((s, i) =>
    h('li', {}, h('button', { type: 'button', onClick: () => go(i + 1) }, h('span', { class: 'n' }, String(i + 1)), s.short)),
  );
  $('steps').append(...stepButtons);
  $('flowBack').addEventListener('click', () => go(step - 1));
  $('flowNext').addEventListener('click', () => go(step === STEPS.length ? 1 : step + 1));
  const sections = [...document.querySelectorAll('[data-steps]')];

  const shownResult = () => (regionId ? scan.results.get(regionId)?.result ?? null : null);

  /** Why the next step cannot be taken yet, or null if it can. */
  function blocked(from = step) {
    if (from === 1 && !profileId) return 'Choose a mission above to begin.';
    if (from === 2) {
      const result = shownResult();
      if (!result) return scan.done ? 'Choose a region.' : 'Searching the regions…';
      if (!result.sites.length) return 'No landing passes in this region. Choose another, or go back and change the mission.';
    }
    if (from === 3 && !route?.start) return 'Tap the map to choose where the rover starts.';
    if (from === 4 && !track) return 'No drive is planned yet. Go back a step and add a destination.';
    return null;
  }

  function drawNav() {
    stepButtons.forEach((li, i) => {
      const button = li.firstChild;
      button.setAttribute('aria-current', i + 1 === step ? 'step' : 'false');
      button.disabled = i + 1 > furthest;
    });
    const why = blocked();
    $('flowBack').disabled = step === 1;
    $('flowNext').disabled = !!why;
    $('flowNext').textContent = STEPS[step - 1].next;
    $('flowHint').hidden = !why;
    $('flowHint').textContent = why ?? '';
  }

  async function go(next) {
    if (next < 1 || next > STEPS.length || (next > step && next > furthest && (next !== step + 1 || blocked()))) return;
    pause();
    step = next;
    furthest = Math.max(furthest, step);
    app.dataset.step = String(step);
    for (const section of sections) section.hidden = !section.dataset.steps.split(' ').includes(String(step));
    $('flowBody').scrollTop = 0;
    drawNav();

    if (step === 1) {
      finder.close();
      surface.close();
      api.setStatus(null);
      drawSetup();
    } else if (step === 2 || step === 3) {
      surface.close();
      if (step === 2) searchRegions();
      const result = shownResult();
      if (result && finder.getResult() !== result) showRegion(regionId); // found while another step was on the stage
      else if (result) finder.open();
      const map = finder.getMap();
      clock.showTime = false;
      map?.setTime(null);
      map?.setRover(step === 3 && track ? track.at(clock.hours) : null);
      if (step === 3) {
        finder.setClickMode('dest');
        setHours(track?.startHours ?? 0);
        drawClock();
      }
    } else {
      const { start } = finder.getRoute();
      if (!start) return go(3);
      const here = surface.getSite();
      if (!here || here.lat !== start.lat || here.lon !== start.lon) {
        await api.standAt({ id: 'landing', name: 'Landing spot', lat: start.lat, lon: start.lon, category: 'custom' });
      }
      if (step === 4) {
        surface.setPosition(0, 0);
        setHours(0); // the moment of landing
      } else {
        drawCredits();
        clock.freeLook = false;
        clock.yaw = null;
        setHours(Math.max((track?.startHours ?? 0) - 0.5, 0));
        if (track) play();
      }
      drawClock();
    }
    drawNav();
    save();
  }

  // ---- The address: a reload or a bookmark comes back to the same step (flow-state.js) -----------------------
  function save() {
    if (restoring) return;
    const mission = api.getMission();
    const { start, targets } = finder.getRoute();
    const onMap = step >= 3 || (regionId && finder.getResult() === shownResult());
    const text = encodeFlow({
      step,
      profile: profileId,
      start: mission.start,
      durationHours: mission.durationHours,
      values: finder.values,
      region: regionId,
      startAt: onMap ? start : null,
      targets: onMap ? targets : [],
    });
    history.replaceState(null, '', `#${text}`);
  }

  /** Act on a saved address: the same mission, then step by step up to where it was. */
  async function restore(saved) {
    const profile = missions.profiles.find((p) => p.id === saved.profile);
    if (!profile) return;
    restoring = true;
    try {
      profileId = profile.id;
      Object.assign(finder.values, profile.finder, saved.values);
      finder.drawForm();
      api.setMission({ start: saved.start ?? new Date(profile.mission.start), durationHours: saved.durationHours ?? profile.mission.durationHours });
      drawSetup();
      drawNav();
      if (!saved.step || saved.step === 1) return;
      // Search the saved region first and wait only for it (about a second when the server has kept the answer).
      const wanted = REGIONS.some((r) => r.id === saved.region) ? saved.region : null;
      searchFirst = wanted;
      await go(2);
      const settled = () => scan.done || (wanted && ['done', 'error'].includes(scan.results.get(wanted)?.status));
      while (!settled()) await new Promise((r) => setTimeout(r, 100));
      if (wanted && scan.results.get(wanted)?.result) {
        userChoseRegion = true;
        showRegion(wanted);
      }
      if (saved.step >= 3 && !blocked(2)) {
        await go(3);
        if (saved.startAt) finder.pick(saved.startAt.lat, saved.startAt.lon, 'start');
        for (const target of saved.targets ?? []) finder.pick(target.lat, target.lon, 'dest');
        for (let next = 4; next <= saved.step && !blocked(next - 1); next++) await go(next);
      }
    } finally {
      restoring = false;
      save();
    }
  }

  // ---- 1 Mission ----------------------------------------------------------------------------------------
  function useProfile(id) {
    const profile = missions.profiles.find((p) => p.id === id);
    profileId = id;
    Object.assign(finder.values, profile.finder);
    finder.drawForm();
    api.setMission({ start: new Date(profile.mission.start), durationHours: profile.mission.durationHours });
    drawSetup();
    drawNav();
    save();
  }

  const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

  function choiceRow(def) {
    if (def.group) return h('div', { class: 'eyebrow' }, def.group);
    const current = def.on === 'mission' ? api.getMission()[def.key] : finder.values[def.key];
    // A value set elsewhere (the exact-number boxes under "More tools") gets a button of its own.
    const options = def.options.some(([value]) => same(value, current)) ? def.options : [...def.options, [current, def.format ? def.format(current) : String(current)]];
    const set = (value) => {
      if (def.on === 'mission') api.setMission({ [def.key]: value });
      else {
        finder.values[def.key] = value;
        finder.drawForm();
      }
      drawSetup();
      save();
    };
    return h(
      'div',
      { class: 'choice' },
      h('div', { class: 'choice-label' }, def.label, def.hint ? h('small', {}, def.hint) : null),
      h(
        'div',
        { class: 'choice-options', role: 'group', 'aria-label': def.label },
        options.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(same(value, current)), onClick: () => set(value) }, text)),
      ),
    );
  }

  function dateRow() {
    const mission = api.getMission();
    const shift = (days) => {
      api.setMission({ start: new Date(mission.start.getTime() + days * 86_400_000) });
      drawSetup();
      save();
    };
    return h(
      'div',
      { class: 'choice' },
      h('label', { class: 'choice-label', htmlFor: 'setupStart' }, 'Landing datetime', h('small', { class: 'inline' }, 'UTC')),
      h(
        'div',
        { class: 'date-row', role: 'group', 'aria-label': 'Landing date' },
        h('input', {
        id: 'setupStart',
        class: 'big',
        type: 'datetime-local',
        step: '3600',
        value: mission.start.toISOString().slice(0, 16),
        onChange: (e) => {
          const date = new Date(`${e.target.value}Z`);
          if (Number.isNaN(date.getTime())) return;
          api.setMission({ start: date });
          drawSetup();
          save();
        },
        }),
        h('button', { type: 'button', 'aria-label': 'Two weeks earlier', onClick: () => shift(-14) }, '−2 weeks'),
        h('button', { type: 'button', 'aria-label': 'Two weeks later', onClick: () => shift(14) }, '+2 weeks'),
      ),
    );
  }

  function drawSetup() {
    clear($('profiles')).append(
      ...missions.profiles.map((profile) =>
        h(
          'button',
          { type: 'button', class: 'profile', 'aria-pressed': String(profile.id === profileId), onClick: () => useProfile(profile.id) },
          profile.pictures?.length
            ? h(
                'span',
                { class: 'profile-pictures' },
                profile.pictures.map((picture) =>
                  h('img', {
                    src: /^https?:/.test(picture.src) ? picture.src : `${import.meta.env.BASE_URL}${picture.src}`,
                    alt: picture.alt,
                    title: picture.credit,
                    style: `flex: ${picture.width ?? 100} 1 0; object-position: ${picture.position ?? '50% 50%'}`,
                  }),
                ),
              )
            : null,
          h('strong', {}, profile.name),
          h('span', {}, profile.blurb),
        ),
      ),
    );
    const el = clear($('setup'));
    if (!profileId) return;
    const profile = missions.profiles.find((p) => p.id === profileId);
    if (profile.facts.length) {
      el.append(
        h(
          'ul',
          { class: 'facts' },
          // Each number's source stays in data/missions.json and shows on hover; the demo page shows no links.
          profile.facts.map((fact) => h('li', { title: missions.sources[fact.source].title }, fact.text)),
        ),
        h('button', { type: 'button', onClick: () => { profileId = 'custom'; drawSetup(); save(); } }, 'Edit'),
      );
      return;
    }
    el.append(h('div', { class: 'eyebrow' }, 'Mission'), dateRow(), ...CHOICES.map(choiceRow));
  }

  // ---- 2 Regions ----------------------------------------------------------------------------------------
  const passingKm2 = (result) => (result.counts.passing * result.cellM * result.cellM) / 1e6;

  /** Search every region for the mission as it stands now. Does nothing if that search is done or under way. */
  async function searchRegions() {
    const key = JSON.stringify(finder.paramsFor({ lat: 0, lon: 0 }));
    if (key === scan.key) return;
    const token = scan.token + 1;
    scan = { key, token, results: new Map(), done: false };
    regionId = null;
    userChoseRegion = false;
    furthest = Math.min(furthest, 2);
    finder.close(); // the map on show answered a different mission
    drawRegions();
    drawNav();
    const order = [...REGIONS].sort((a, b) => (b.id === searchFirst) - (a.id === searchFirst));
    for (const [i, region] of order.entries()) {
      scan.results.set(region.id, { status: 'searching' });
      drawRegions();
      if (step === 2) api.setStatus(`Checking ${region.name} against the terrain… (${i + 1} of ${REGIONS.length})`);
      let entry;
      try {
        entry = { status: 'done', result: await searchLanding(finder.paramsFor(region)) };
      } catch (error) {
        entry = { status: 'error', error: error.message };
      }
      if (token !== scan.token) return; // the mission changed while this one was being searched
      scan.results.set(region.id, entry);
      // Put the best region found so far on the stage, until the user chooses one.
      const best = shownResult();
      if (entry.result && !userChoseRegion && (!best || passingKm2(entry.result) > passingKm2(best))) showRegion(region.id);
      drawRegions();
      drawNav();
    }
    scan.done = true;
    api.setStatus(null);
    drawRegions();
    drawNav();
  }

  function showRegion(id) {
    const result = scan.results.get(id)?.result;
    if (!result) return;
    regionId = id;
    const region = REGIONS.find((r) => r.id === id);
    if (step === 2 || step === 3) finder.showResult(result, region.name, { startAt: result.sites[0] ?? null });
    drawRegions();
    drawNav();
    save();
  }

  function verdict(entry) {
    if (!entry) return ['waiting', 'Waiting its turn'];
    if (entry.status === 'searching') return ['waiting', 'Searching the terrain…'];
    if (entry.status === 'error') return ['fail', entry.error];
    const { counts, sites } = entry.result;
    if (sites.length) {
      const km2 = passingKm2(entry.result);
      return ['pass', `${km2.toFixed(km2 < 10 ? 1 : 0)} km² can take the landing · ${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`];
    }
    const [worst, cells] = Object.entries(FAIL_WORDS)
      .map(([name]) => [name, counts[name] ?? 0])
      .sort((a, b) => b[1] - a[1])[0];
    return ['fail', `No landing passes. Most often: ${FAIL_WORDS[worst]} (${Math.round((100 * cells) / Math.max(counts.evaluated, 1))}% of the ground)`];
  }

  function drawRegions() {
    const mission = api.getMission();
    const done = [...scan.results.values()].filter((entry) => entry.result);
    const passing = done.filter((entry) => entry.result.sites.length).length;
    $('regionsLede').textContent =
      `Each region is searched for 10 km around the point named, on real terrain, for a landing on ${formatUTC(mission.start)} and ${formatHours(mission.durationHours)} on the Moon. ` +
      (scan.done ? `${passing} of ${REGIONS.length} can take this mission.` : `${done.length} of ${REGIONS.length} searched so far.`);
    // Once every region is in, the ones that pass come first, most room first.
    const rank = (region) => {
      const result = scan.results.get(region.id)?.result;
      return result ? passingKm2(result) : -1;
    };
    const order = scan.done ? [...REGIONS].sort((a, b) => rank(b) - rank(a)) : REGIONS;
    clear($('regions')).append(
      ...order.map((region) => {
        const entry = scan.results.get(region.id);
        const [kind, text] = verdict(entry);
        return h(
          'li',
          {},
          h(
            'button',
            {
              type: 'button',
              class: 'region',
              'aria-pressed': String(region.id === regionId),
              disabled: !entry?.result,
              onClick: () => {
                userChoseRegion = true;
                showRegion(region.id);
              },
            },
            h('strong', {}, region.name),
            h('span', { class: `verdict ${kind}` }, text),
          ),
          region.note ? h('small', { class: 'region-note', title: region.source?.title ?? '' }, region.note) : null,
        );
      }),
    );
  }

  // ---- 3 Drive, 5 Ride: the playback clock ------------------------------------------------------------------
  /** The finder's start, destinations or plan changed. */
  function routeChanged(next) {
    route = next;
    track = next.plan?.path ? createTrack(next.result, next.plan) : null;
    pause();
    if (step === 3) {
      setHours(track?.startHours ?? 0);
      finder.getMap()?.setRover(track ? track.at(clock.hours) : null);
    }
    drawClock();
    drawNav();
    save();
  }

  /** Move the clock. The app's time slider, the globe and the surface view's Sun follow. */
  function setHours(hours) {
    clock.hours = hours;
    const index = Math.round(hours / api.stepHours());
    // Moving the Sun redraws every shadow in the surface view (50 to 90 ms), so while the ride plays the Sun
    // steps three times a second and the viewpoint moves every frame.
    const now = performance.now();
    const sunDue = !(clock.playing && step === 5) || now - clock.sunAt > 330;
    if (index !== api.viewIndex() && sunDue) {
      clock.sunAt = now;
      clock.fromHere = true;
      api.setViewIndex(index);
      clock.fromHere = false;
    }
    showMoment();
  }

  /** main.js calls this whenever the app's time changes (its own slider and Play button included). */
  function timeChanged() {
    if (clock.fromHere) return;
    clock.hours = api.viewIndex() * api.stepHours();
    if (step === 3 && track) clock.showTime = true;
    showMoment();
  }

  /** Draw the moment the clock shows: the rover on the map, or the viewpoint on the surface. */
  function showMoment() {
    const result = finder.getResult();
    const map = finder.getMap();
    if (step === 3 && map && result) {
      map.setTime(clock.showTime && track ? Math.floor(clock.hours / result.stepHours) : null);
      map.setRover(track ? track.at(clock.hours) : null);
    }
    if (step === 5 && track && surface.isOpen()) {
      const now = track.at(clock.hours);
      const from = track.points[0];
      // Face the way the rover is heading, turning gently; a drag on the view hands the looking back to the user.
      let look;
      if (!clock.freeLook) {
        const turn = clock.yaw == null ? 0 : ((now.headingDeg - clock.yaw + 540) % 360) - 180;
        clock.yaw = clock.yaw == null ? now.headingDeg : clock.yaw + turn * 0.08;
        look = { yaw: clock.yaw, pitch: 1.5, fov: 70 };
      }
      surface.setPosition(now.east - from.east, now.north - from.north, look);
    }
    updateClockText();
  }

  function play() {
    const result = finder.getResult();
    if (!track || !result) return;
    // Play from an hour before it sets off to an hour after it stops, in 10 to 16 seconds.
    const from = Math.max(track.startHours - 1, 0);
    const to = Math.min(track.endHours + 1, result.windowHours);
    let hours = clock.hours >= from && clock.hours < to - 0.05 ? clock.hours : from;
    clock.rate = (to - from) / Math.min(Math.max((to - from) * 0.5, 10), 16);
    clock.playing = true;
    clock.showTime = true;
    clock.freeLook = false;
    let last = performance.now();
    const tick = (now) => {
      if (!clock.playing) return;
      hours += ((now - last) / 1000) * clock.rate;
      last = now;
      if (hours >= to) {
        pause(); // first, so the last moment is not held back by the ride's slower Sun
        setHours(to);
        return;
      }
      setHours(hours);
      clock.frame = requestAnimationFrame(tick);
    };
    clock.frame = requestAnimationFrame(tick);
    drawClock();
  }

  function pause() {
    if (!clock.playing) return;
    clock.playing = false;
    cancelAnimationFrame(clock.frame);
    drawClock();
  }

  // Choosing a map layer leaves "sunlight at the time shown"; a drag on the surface view takes over the looking.
  $('finderLayers').addEventListener('click', () => {
    clock.showTime = false;
  });
  $('surfaceCanvas').addEventListener('pointerdown', () => {
    clock.freeLook = true;
  });

  let clockText = null; // the line under the Play button, rewritten every frame
  function drawClock() {
    const el = clear(step === 5 ? $('driveNow') : $('playback'));
    clear(step === 5 ? $('playback') : $('driveNow'));
    clockText = null;
    if (step !== 3 && step !== 5) return;
    if (!track) {
      if (step === 5) el.append(h('p', { class: 'caveats' }, 'No drive is planned. Go back to "Drive" and add a destination.'));
      return;
    }
    clockText = h('p', { class: 'clock-text' });
    el.append(
      h('button', { type: 'button', class: 'primary play', 'aria-pressed': String(clock.playing), onClick: () => (clock.playing ? pause() : play()) }, clock.playing ? 'Pause' : step === 5 ? 'Ride the drive' : 'Play the drive'),
      clockText,
      h(
        'p',
        { class: 'caveats' },
        step === 5
          ? 'The view moves along the planned route over the same terrain. The Sun and Earth are drawn where they are at the landing spot; over this drive they move by under 0.2°. Speeded up: the rover is far slower.'
          : 'While it plays, the map shows which ground is in sunlight at that hour. The rover is amber in sunlight and blue in the dark.',
      ),
    );
    updateClockText();
  }

  function updateClockText() {
    if (!clockText || !track) return;
    const now = track.at(clock.hours);
    const when = new Date(api.getMission().start.getTime() + clock.hours * 3_600_000);
    const km = (m) => (m / 1000).toFixed(1);
    clockText.textContent =
      `${formatHours(clock.hours)} after landing · ${formatUTC(when)} · ${STATE_WORDS[now.state] ?? ''} · ${now.lit ? 'in sunlight' : 'in the dark'} · ` +
      `${km(now.distanceM)} of ${km(track.lengthM)} km` +
      (clock.playing ? ` · one second shows ${formatHours(clock.rate)}` : '');
  }

  $('suggestDrive').addEventListener('click', () => {
    if (!finder.suggestDrive()) api.setStatus('No drive between the found sites works for this rover. Tap the map to try a destination of your own.', 7000);
  });

  // ---- 5 Credits ----------------------------------------------------------------------------------------
  function drawCredits() {
    const line = (what, who) => h('div', { class: 'credit' }, what ? h('span', {}, what) : null, h('strong', {}, who));
    clear($('credits')).append(
      h(
        'div',
        { class: 'credits-roll' },
        h('div', { class: 'credit-title' }, credits.teamName),
        h('div', { class: 'credit-sub' }, credits.event),
        ...credits.team.map((person) => line(person.role ?? '', person.name)),
        h('div', { class: 'credit-sub' }, 'Made with'),
        ...credits.thanks.map((entry) => line(entry.what, entry.who)),
      ),
    );
  }

  // ---- Start --------------------------------------------------------------------------------------------
  globe.view('south');
  const saved = decodeFlow(location.hash); // read before go(1) writes the address
  go(1).then(() => restore(saved));

  return { go, routeChanged, timeChanged, getStep: () => step, debug: { scan: () => scan, clock, play, pause, useProfile } };
}
