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
import { STATE_STORY, milestoneLabel } from '../finder/plan-text.js';
import { formatHours, formatUTC } from '../format.js';
import { DURATION_MARKS, formatDuration, positionOf, tidyDuration } from '../mission.js';
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
  // A named crater stands for its middle (a reference point, not a vetted landing site); missions.json says so.
  // searchRadiusKm: the crater regions are searched 20 km round their centres, to reach the rims (our choice).
  return { id: region.id, name: site.name, lat: site.lat, lon: site.lon, searchRadiusKm: region.searchRadiusKm, source: sources[site.source] };
});

// The custom mission's controls: a few big choices each, instead of number boxes. `on` says which object holds the value.
const yes = (when) => (v) => (v ? when[0] : when[1]);
const GROUPS = [
  {
    id: 'mission',
    title: 'Mission',
    date: true, // the landing date comes first, with its own row
    choices: [
      { on: 'mission', key: 'durationHours', label: 'Duration', slider: true, summary: (v) => `for ${formatDuration(v)}` },
    ],
  },
  {
    id: 'lander',
    title: 'Lander',
    choices: [
      // 100 m is NASA's figure for the Artemis lander (missions.json, hls-2024); 200 m and 2 km are our choices, the
      // last for an older-style lander (decision V). 50 m was dropped: the search's 80 m cells make it the same as
      // 100 m. On the seven demo regions 100 m finds 8.4 km² that can take a landing, 200 m 1.8 km², 2 km none.
      { on: 'finder', key: 'ellipseRadiusM', label: 'Landing accuracy', hint: 'How far from its target it may come down', options: [[100, '100 m', 'NASA: Artemis Human Landing System (2024)'], [200, '200 m', 'Our choice'], [2000, '2 km', 'Our choice: an older-style lander']], format: (v) => (v >= 1000 ? `${v / 1000} km` : `${v} m`), summary: (v) => `within ${v >= 1000 ? `${v / 1000} km` : `${v} m`}` },
      { on: 'finder', key: 'maxLandingSlopeDeg', label: 'Steepest ground it lands on', options: [[5, '5°'], [10, '10°'], [15, '15°']], format: (v) => `${v}°`, summary: (v) => `slopes up to ${v}°` },
      { on: 'finder', key: 'needEarthAtLanding', label: 'Earth in view at touchdown', options: [[true, 'Needed'], [false, 'Not needed']], summary: yes(['Earth in view', null]) },
      { on: 'finder', key: 'needSunAtLanding', label: 'Sunlight at touchdown', options: [[true, 'Needed'], [false, 'Not needed']], summary: yes(['in sunlight', null]) },
    ],
  },
  {
    id: 'rover',
    title: 'Rover',
    choices: [
      { on: 'finder', key: 'maxDarknessHours', label: 'Max darkness', options: [[24, '24 h'], [50, '50 h'], [100, '100 h']], format: (v) => `${v} h`, summary: (v) => `survives ${v} h dark` },
      { on: 'finder', key: 'roverMaxSlopeDeg', label: 'Max ground slope', options: [[10, '10°'], [15, '15°'], [20, '20°']], format: (v) => `${v}°`, summary: (v) => `slopes up to ${v}°` },
      { on: 'finder', key: 'roverSpeedMPerHour', label: 'Average speed', options: [[36, '36 m/hr'], [200, '200 m/hr'], [720, '720 m/hr']], format: (v) => `${v} m/hr`, summary: (v) => `${v} m/hr` },
      { on: 'finder', key: 'roverNeedsEarthToDrive', label: 'Earth in view to drive', options: [[true, 'Needed'], [false, 'Not needed']], summary: yes(['needs Earth to drive', null]) },
    ],
  },
];

// Region markers on the globe, coloured like the verdicts in the list (styles.css, .region .verdict).
const REGION_COLOURS = { pass: '#5fe0c0', fail: '#8d96a6', waiting: '#3a4250' };
// How close the globe comes on step 2. Daniel (2026-11-14) asked for it further out, so the view shows which part
// of the Moon this is; in its narrower pane that needs the Moon's curved edge in view, which is about 2.5 (our choice).
const REGION_ZOOM = 2.5;
const WIDE_KM = Math.max(...REGIONS.map((r) => r.searchRadiusKm ?? 0));
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
  const openGroups = new Set(); // which groups of the custom form are open; all start closed
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

    drawGlobeRegions();
    if (step === 1) {
      finder.close();
      surface.close();
      globe.view('south');
      api.setStatus(null);
      drawSetup();
    } else if (step === 2 || step === 3) {
      surface.close();
      if (step === 2) searchRegions();
      const result = shownResult();
      if (result && finder.getResult() !== result) showRegion(regionId); // found while another step was on the stage
      if (step === 2) {
        // The globe and the region's map share the stage (styles.css): where on the Moon, and where it can land.
        if (result) finder.open();
        const region = REGIONS.find((r) => r.id === regionId);
        if (region) globe.focus(region.lat, region.lon, REGION_ZOOM);
        else globe.view('southClose');
      } else if (result) finder.open();
      applyMapView();
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

  const valueOf = (def) => (def.on === 'mission' ? api.getMission()[def.key] : finder.values[def.key]);

  /** One group of the custom form: a header that shows the current values, and its questions when open. */
  function groupBlock(group) {
    const date = (d) => `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}, ${d.toISOString().slice(11, 16)} UTC`;
    const said = [group.date ? date(api.getMission().start) : null, ...group.choices.map((def) => def.summary(valueOf(def)))].filter(Boolean);
    return h(
      'details',
      { class: 'group', open: openGroups.has(group.id), onToggle: (e) => (e.target.open ? openGroups.add(group.id) : openGroups.delete(group.id)) },
      h('summary', {}, h('span', { class: 'group-title' }, group.title), h('span', { class: 'group-summary' }, said.join(' · '))),
      h('div', { class: 'group-body' }, group.date ? dateRow() : null, ...group.choices.map((def) => (def.slider ? durationRow(def) : choiceRow(def)))),
    );
  }

  function choiceRow(def) {
    const current = valueOf(def);
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
        // A third entry, where given, is the value's source, shown on hover.
        options.map(([value, text, source]) => h('button', { type: 'button', title: source ?? '', 'aria-pressed': String(same(value, current)), onClick: () => set(value) }, text)),
      ),
    );
  }

  /**
   * Mission length: a slider from 1 hour to 1 year with the clean lengths evenly spaced under it as big buttons
   * (the scale is in src/mission.js). Dragging shows the length; letting go applies it.
   */
  function durationRow(def) {
    const current = valueOf(def);
    const SCALE = 1000;
    const readout = h('span', { class: 'duration-value' }, formatDuration(current));
    const set = (hours) => {
      if (same(hours, valueOf(def))) return;
      api.setMission({ durationHours: hours });
      drawSetup();
      save();
    };
    const marks = DURATION_MARKS.map((mark, i) =>
      h(
        'button',
        {
          type: 'button',
          class: 'duration-mark',
          style: `left: ${((100 * i) / (DURATION_MARKS.length - 1)).toFixed(3)}%`,
          'aria-pressed': String(same(mark.hours, current)),
          'aria-label': formatDuration(mark.hours),
          onClick: () => set(mark.hours),
        },
        mark.label,
      ),
    );
    const slider = h('input', {
      type: 'range',
      class: 'duration-slider',
      min: '0',
      max: String(SCALE),
      step: '1',
      value: String(Math.round(positionOf(current) * SCALE)),
      'aria-label': 'Duration',
      'aria-valuetext': formatDuration(current),
      onInput: (e) => {
        const hours = tidyDuration(Number(e.target.value) / SCALE);
        readout.textContent = formatDuration(hours);
        e.target.setAttribute('aria-valuetext', formatDuration(hours));
        marks.forEach((button, i) => button.setAttribute('aria-pressed', String(same(DURATION_MARKS[i].hours, hours))));
        // Near a clean length the thumb jumps onto it, so it is easy to hit.
        if (DURATION_MARKS.some((mark) => same(mark.hours, hours))) e.target.value = String(Math.round(positionOf(hours) * SCALE));
      },
      onChange: (e) => set(tidyDuration(Number(e.target.value) / SCALE)),
    });
    return h(
      'div',
      { class: 'choice' },
      h('div', { class: 'choice-label duration-label' }, def.label, readout),
      h('div', { class: 'duration' }, slider, h('div', { class: 'duration-marks' }, marks)),
    );
  }

  /** The landing time: big in the middle, with steps of a week, a day and an hour back on the left and forward on the right. */
  function dateRow() {
    const mission = api.getMission();
    const move = (hours) => {
      api.setMission({ start: new Date(mission.start.getTime() + hours * 3_600_000) });
      drawSetup();
      save();
    };
    const STEPS = [
      [24 * 7, 'week'],
      [24, 'day'],
      [1, 'hour'],
    ];
    const side = (sign) =>
      h(
        'div',
        { class: 'date-steps', role: 'group', 'aria-label': sign < 0 ? 'Earlier' : 'Later' },
        STEPS.map(([hours, unit]) =>
          h('button', { type: 'button', 'aria-label': `One ${unit} ${sign < 0 ? 'earlier' : 'later'}`, onClick: () => move(sign * hours) }, `${sign < 0 ? '−' : '+'}1 ${unit}`),
        ),
      );
    // The date box itself is hidden: tapping the big date opens its picker, for a jump of more than a few weeks.
    const input = h('input', {
      id: 'setupStart',
      class: 'date-input',
      type: 'datetime-local',
      step: '3600',
      tabIndex: -1,
      'aria-hidden': 'true',
      value: mission.start.toISOString().slice(0, 16),
      onChange: (e) => {
        const date = new Date(`${e.target.value}Z`);
        if (Number.isNaN(date.getTime())) return;
        api.setMission({ start: date });
        drawSetup();
        save();
      },
    });
    const day = mission.start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    return h(
      'div',
      { class: 'choice' },
      h('div', { class: 'choice-label' }, 'Landing datetime'),
      h(
        'div',
        { class: 'date-row' },
        side(-1),
        h(
          'button',
          {
            type: 'button',
            class: 'date-now',
            title: 'Choose a date',
            onClick: () => {
              try {
                input.showPicker();
              } catch {
                input.focus();
              }
            },
          },
          h('span', { class: 'date-day' }, day),
          h('span', { class: 'date-time' }, `${mission.start.toISOString().slice(11, 16)} UTC`),
          input,
        ),
        side(1),
      ),
    );
  }


  // The mission cards are built once and then only updated, so the change to the compact row can slide.
  const profileButtons = missions.profiles.map((profile) =>
    h(
      'button',
      { type: 'button', class: 'profile', 'data-profile': profile.id, onClick: () => chooseProfile(profile.id) },
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
      h('span', { class: 'profile-blurb' }, profile.blurb),
      h('span', { class: 'profile-back', 'aria-hidden': 'true' }, '← Back'),
    ),
  );
  $('profiles').append(...profileButtons);

  /** A tap on a mission card. With the custom form open, the other card is a "Back" to the choice of mission. */
  function chooseProfile(id) {
    if (id === profileId) return; // already chosen: keep whatever has been set
    if (profileId === 'custom') {
      profileId = null;
      drawSetup();
      drawNav();
      save();
      return;
    }
    useProfile(id);
  }

  function drawSetup() {
    const compact = profileId === 'custom';
    missions.profiles.forEach((profile, i) => {
      profileButtons[i].setAttribute('aria-pressed', String(profile.id === profileId));
      profileButtons[i].setAttribute('aria-label', compact && profile.id !== profileId ? 'Back to the choice of mission' : profile.name);
    });
    // With the custom form open, the title goes and the cards shrink to one slim row, leaving the room to the form.
    $('missionSection').classList.toggle('compact', compact);
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
    el.append(...GROUPS.map(groupBlock));
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
    if (step === 2) globe.focus(region.lat, region.lon, REGION_ZOOM);
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
      return ['pass', `${km2.toFixed(km2 < 10 ? 1 : 0)} km² available for landing · ${sites.length} ${sites.length === 1 ? 'site' : 'sites'}`];
    }
    // The check that rules out the most ground.
    const [worst] = Object.keys(FAIL_WORDS)
      .map((name) => [name, counts[name] ?? 0])
      .sort((a, b) => b[1] - a[1])[0];
    return ['fail', `No available sites. Cause: ${FAIL_WORDS[worst]}`];
  }

  function drawRegions() {
    const mission = api.getMission();
    const done = [...scan.results.values()].filter((entry) => entry.result);
    const passing = done.filter((entry) => entry.result.sites.length).length;
    $('regionsLede').textContent =
      `Each region is searched for ${finder.values.radiusKm} km around the point named (${WIDE_KM} km round the crater centres, to reach their rims), on real terrain, for a landing on ${formatUTC(mission.start)} and ${formatHours(mission.durationHours)} on the Moon. ` +
      (scan.done ? `${passing} of ${REGIONS.length} have sites available for landing.` : `${done.length} of ${REGIONS.length} searched so far.`) +
      // A long mission is checked in longer steps (src/finder/client.js), which can miss short darkness.
      (done[0] && done[0].result.stepHours > 1
        ? ` Over a mission this long, sunlight is checked every ${formatHours(done[0].result.stepHours)}, so darkness shorter than that can be missed.`
        : '');
    // Once every region is in, the ones that pass come first, most room first.
    const rank = (region) => {
      const result = scan.results.get(region.id)?.result;
      return result ? passingKm2(result) : -1;
    };
    const order = scan.done ? [...REGIONS].sort((a, b) => rank(b) - rank(a)) : REGIONS;
    drawGlobeRegions();
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
              title: region.source?.title ?? '', // the source stays on hover; the page shows no notes (Daniel)
              'aria-pressed': String(region.id === regionId),
              disabled: !entry?.result,
              onClick: () => chooseRegion(region.id),
            },
            h('strong', {}, region.name),
            h('span', { class: `verdict ${kind}` }, text),
          ),
        );
      }),
    );
  }

  function chooseRegion(id) {
    if (!scan.results.get(id)?.result) return;
    userChoseRegion = true;
    showRegion(id);
  }

  /** The regions on the globe while step 2 is on, each coloured by its verdict; none on the other steps. */
  function drawGlobeRegions() {
    if (step !== 2) return globe.setRegions([]);
    globe.setRegions(
      REGIONS.map((region) => ({
        ...region,
        color: REGION_COLOURS[verdict(scan.results.get(region.id))[0]],
        selected: region.id === regionId,
        label: region.id === regionId, // this far out the regions sit within a few pixels; the list names them all
      })),
      { onPick: chooseRegion },
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
    showMoment();
  }

  /** Draw the moment the clock shows: the rover on the map, or the viewpoint on the surface. */
  function showMoment() {
    const result = finder.getResult();
    const map = finder.getMap();
    if ((step === 2 || step === 3) && map && result) {
      map.setTime(clock.showTime ? Math.floor(clock.hours / result.stepHours) : null);
      map.setRover(step === 3 && track ? track.at(clock.hours) : null);
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
    // Play from an hour before it sets off until it arrives (or an hour after it is lost), in 10 to 16
    // seconds. Each frame moves on from clock.hours, so "Next change" can move the clock while it plays.
    const from = Math.max(track.startHours - 1, 0);
    const to = playEnd(result);
    if (!(clock.hours >= from && clock.hours < to - 0.05)) setHours(from);
    clock.rate = (to - from) / Math.min(Math.max((to - from) * 0.5, 10), 16);
    clock.playing = true;
    clock.freeLook = false;
    let last = performance.now();
    const tick = (now) => {
      if (!clock.playing) return;
      const hours = clock.hours + ((now - last) / 1000) * clock.rate;
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

  /** Where playing stops: when the rover reaches its last destination (Daniel, 2026-11-14), or an hour after
   *  it is lost on the way. */
  function playEnd(result) {
    if (track.arrivalHours != null) return Math.min(track.arrivalHours, result.windowHours);
    return Math.min(Math.max(track.endHours, track.changes.at(-1) ?? 0) + 1, result.windowHours);
  }

  /** Jump to the next time the rover starts doing something else; it keeps playing if it was. */
  function nextChange() {
    const at = track?.nextChange(clock.hours);
    if (at == null) return;
    setHours(at);
  }

  function pause() {
    if (!clock.playing) return;
    clock.playing = false;
    cancelAnimationFrame(clock.frame);
    drawClock();
  }

  // ---- What the map is coloured by: a small toggle on the map itself (Daniel, 2026-11-14) ----------------------
  // Day/night is the sunlight at the clock's moment; the others are finder layers (map-layers.js). Each step
  // keeps its own choice: the Regions step opens on the landing sites, the Drive step on day and night.
  const MAP_VIEWS = [
    ['time', 'Day/night'],
    ['slope', 'Slope'],
    ['result', 'Landing sites'],
  ];
  const mapViewFor = { 2: 'result', 3: 'time' };
  const mapViewButtons = MAP_VIEWS.map(([id, label]) => h('button', { type: 'button', onClick: () => setMapView(id) }, label));
  $('mapViews').append(...mapViewButtons);
  function setMapView(id) {
    if (step === 2 || step === 3) mapViewFor[step] = id;
    applyMapView();
  }
  function pressMapView(id) {
    mapViewButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(MAP_VIEWS[i][0] === id)));
  }
  function applyMapView() {
    const id = mapViewFor[step] ?? 'result';
    pressMapView(id);
    clock.showTime = id === 'time';
    if (id !== 'time') finder.chooseLayer(id);
    showMoment();
  }
  // The "why no drive works" box can show another layer (Darkness, Reach…): the toggle follows it.
  finder.listenLayer((id) => {
    if (step !== 2 && step !== 3) return;
    mapViewFor[step] = id;
    clock.showTime = false;
    pressMapView(id);
  });
  $('surfaceCanvas').addEventListener('pointerdown', () => {
    clock.freeLook = true;
  });

  // The parts of the player rewritten every frame: the clock line, the sentence, the darkness bar and, on the
  // Drive step, the timeline's milestones. On the Drive step they sit in a column at the map's right edge
  // (Daniel, 2026-11-14), so they never cover the route; on the Ride step they stay in the left panel.
  let clockParts = null;
  const dayText = (hours) => `Day ${(hours / 24).toFixed(1)}`;

  function drawClock() {
    const el = clear(step === 5 ? $('driveNow') : $('playback'));
    clear(step === 5 ? $('playback') : $('driveNow'));
    const column = clear($('driveTimeline'));
    clockParts = null;
    app.classList.toggle('timeline-on', step === 3 && !!track);
    if (step !== 3 && step !== 5) return;
    if (!track) {
      if (step === 5) el.append(h('p', { class: 'caveats' }, 'No drive is planned. Go back to "Drive" and add a destination.'));
      return;
    }
    clockParts = {
      text: h('p', { class: 'clock-text' }),
      story: h('p', { class: 'clock-story' }),
      fill: h('i'),
      dark: h('span', { class: 'dark-text' }),
      next: h('button', { type: 'button', class: 'next-change', onClick: nextChange }, 'Next change'),
      rows: null,
      current: -1,
    };
    const meter = h(
      'div',
      { class: 'dark-meter' },
      h('div', { class: 'dark-bar', title: 'Unbroken time in the dark so far. Full means the rover is lost.' }, clockParts.fill),
      clockParts.dark,
    );
    el.append(
      h(
        'div',
        { class: 'play-row' },
        h('button', { type: 'button', class: 'primary play', 'aria-pressed': String(clock.playing), onClick: () => (clock.playing ? pause() : play()) }, clock.playing ? 'Pause' : step === 5 ? 'Ride the drive' : 'Play the drive'),
        clockParts.next,
      ),
    );
    if (step === 3) {
      // The timeline: touchdown at the top, then one row for every time the sentence changes. A tap on a row
      // moves the clock there.
      clockParts.rows = track.milestones.map((m) => {
        const row = h(
          'li',
          { class: 'tl-row' },
          h(
            'button',
            { type: 'button', onClick: () => setHours(m.hours) },
            h('span', { class: 'tl-mark', 'aria-hidden': 'true' }),
            h('span', { class: 'tl-time' }, dayText(m.hours)),
            h('span', { class: 'tl-label' }, milestoneLabel(m)),
          ),
        );
        return { row, hours: m.hours };
      });
      column.append(
        h('div', { class: 'tl-now' }, clockParts.text, meter),
        h('ol', { class: 'tl-list', 'aria-label': 'What the rover does, from touchdown' }, clockParts.rows.map((r) => r.row)),
      );
    } else {
      el.append(
        clockParts.story,
        meter,
        clockParts.text,
        h(
          'p',
          { class: 'caveats' },
          'The view moves along the planned route over the same terrain. The Sun and Earth are drawn where they are at the landing spot; over this drive they move by under 0.2°. Speeded up: the rover is far slower.',
        ),
      );
    }
    updateClockText();
  }

  function updateClockText() {
    if (!clockParts || !track) return;
    const now = track.at(clock.hours);
    const km = (m) => (m / 1000).toFixed(1);
    // The date and time are on the time bar under the map; this line keeps the day and the distance.
    clockParts.text.textContent = `${dayText(clock.hours)} · ${km(now.distanceM)} of ${km(track.lengthM)} km driven`;
    const story = STATE_STORY[now.state] ?? '';
    if (clockParts.story.textContent !== story) clockParts.story.textContent = story;
    const max = route?.rover?.maxDarknessHours;
    const share = max > 0 ? Math.min(now.darkH / max, 1) : 0;
    clockParts.fill.style.width = `${(share * 100).toFixed(1)}%`;
    clockParts.fill.className = share >= 1 ? 'lost' : share > 0.8 ? 'near' : share > 0.5 ? 'half' : '';
    // Whole hours, in the same unit as the "Max darkness" choice (24 / 50 / 100 h).
    clockParts.dark.textContent = max > 0 ? `In the dark ${Math.round(now.darkH)} h of the ${max} h it survives` : `In the dark ${Math.round(now.darkH)} h`;
    clockParts.next.disabled = track.nextChange(clock.hours) == null;
    if (clockParts.rows) {
      // The row now playing: the last one at or before the clock. Rows before it are done, rows after it to come.
      let current = 0;
      clockParts.rows.forEach((r, i) => {
        if (r.hours <= clock.hours + 1e-6) current = i;
      });
      if (current !== clockParts.current) {
        clockParts.current = current;
        clockParts.rows.forEach((r, i) => {
          r.row.className = `tl-row ${i < current ? 'done' : i === current ? 'now' : 'next'}`;
          if (i === current) r.row.setAttribute('aria-current', 'step');
          else r.row.removeAttribute('aria-current');
        });
        // Keep the row in view inside the column only (scrollIntoView could also move the stage).
        const col = $('driveTimeline');
        const row = clockParts.rows[current].row;
        if (row.offsetTop < col.scrollTop) col.scrollTop = row.offsetTop - 8;
        else if (row.offsetTop + row.offsetHeight > col.scrollTop + col.clientHeight) col.scrollTop = row.offsetTop + row.offsetHeight - col.clientHeight + 8;
      }
    }
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
        ...credits.sections.flatMap((section) => [
          h('div', { class: 'credit-sub' }, section.title),
          ...section.items.map((entry) => line(entry.what, entry.who)),
        ]),
      ),
    );
    // The same reading speed however long the list is: about 45 pixels a second.
    const roll = $('credits').firstChild;
    roll.style.animationDuration = `${Math.max(20, Math.round((roll.offsetHeight + 230) / 45))}s`;
  }

  // ---- Start --------------------------------------------------------------------------------------------
  globe.view('south');
  const saved = decodeFlow(location.hash); // read before go(1) writes the address
  go(1).then(() => restore(saved));

  return { go, routeChanged, timeChanged, getStep: () => step, debug: { scan: () => scan, clock, play, pause, useProfile } };
}
