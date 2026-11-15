// The app around the finder: top tabs, the mission survey, the close-up that pops out of the globe, the street
// view, and presenter notes. It drives the mission steps (flow.js) instead of showing them:
//   Moon        flow step 2: the globe, the best regions, and the chosen region's map as a pop-out card
//   Site        flow step 3: the region's map full size, map layers and the rover's drive
//   Street view the street view (public/Street-view/) at the landing spot, inside the app
//   Learn       the education pages (education/)
// The mission questions are the old "Mission" step's own (data/missions.json profiles, finder values).
import missions from '../../data/missions.json';
import { DURATION_MARKS, formatDuration } from '../mission.js';
import { clear, h } from './dom.js';

const $ = (id) => document.getElementById(id);

// The mission questions are the old "Mission" step's, word for word (flow.js GROUPS, data/missions.json):
// choose the Pre-set mission or a Custom one; a custom mission then asks about the mission, the lander and the rover.
const GROUPS = [
  {
    title: 'Mission',
    date: true,
    choices: [],
  },
  {
    title: 'Lander',
    choices: [
      { key: 'ellipseRadiusM', label: 'Landing accuracy', hint: 'How far from its target it may come down', options: [[50, '50 m'], [100, '100 m'], [500, '500 m']] },
      { key: 'maxLandingSlopeDeg', label: 'Steepest ground it lands on', options: [[5, '5°'], [10, '10°'], [15, '15°']] },
      { key: 'needEarthAtLanding', label: 'Earth in view at touchdown', options: [[true, 'Needed'], [false, 'Not needed']] },
      { key: 'needSunAtLanding', label: 'Sunlight at touchdown', options: [[true, 'Needed'], [false, 'Not needed']] },
    ],
  },
  {
    title: 'Rover',
    choices: [
      { key: 'maxDarknessHours', label: 'Max darkness', options: [[24, '24 h'], [50, '50 h'], [100, '100 h']] },
      { key: 'roverMaxSlopeDeg', label: 'Max ground slope', options: [[10, '10°'], [15, '15°'], [20, '20°']] },
      { key: 'roverSpeedMPerHour', label: 'Average speed', options: [[36, '36 m/hr'], [200, '200 m/hr'], [720, '720 m/hr']] },
      { key: 'roverNeedsEarthToDrive', label: 'Earth in view to drive', options: [[true, 'Needed'], [false, 'Not needed']] },
    ],
  },
];
const picture = (src) => (/^https?:/.test(src) ? src : `${import.meta.env.BASE_URL}${src}`);

export function createShell({ app, flow, finder, globe, getMission, setMission }) {
  const regions = missions.regions;
  let tab = 'moon';

  // ---- top bar ---------------------------------------------------------------------------------------------
  const tabs = { moon: $('tabMoon'), site: $('tabSite'), street: $('tabStreet') };
  tabs.moon.onclick = () => show('moon');
  tabs.site.onclick = () => show('site');
  tabs.street.onclick = () => show('street');
  $('changeMission').onclick = () => openSurvey();
  $('notesBtn').onclick = () => ($('notes').hidden = !$('notes').hidden);
  addEventListener('keydown', (e) => {
    if ((e.key === 'n' || e.key === 'N') && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) $('notes').hidden = !$('notes').hidden;
  });

  function markTabs() {
    for (const [k, el] of Object.entries(tabs)) el.setAttribute('aria-current', k === tab ? 'page' : 'false');
    app.dataset.tab = tab;
  }

  async function show(next) {
    if (next !== 'street') closeStreet();
    if (next === 'moon') {
      if (flow.getStep() < 2) return openSurvey();
      await flow.go(2);
    } else if (next === 'site') {
      if (flow.getStep() < 2) return openSurvey();
      await flow.go(3);
      if (flow.getStep() !== 3) return flash('Pick a region with room to land first.');
    } else if (next === 'street') {
      if (!openStreet()) return;
    }
    tab = next;
    markTabs();
    drawSummary();
  }
  let flashTimer = 0;
  function flash(text) {
    const el = $('status');
    el.hidden = false;
    el.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => (el.hidden = true), 4000);
  }

  // ---- mission summary (left panel, one line) ---------------------------------------------------------------
  function drawSummary() {
    const m = getMission();
    const v = finder.values;
    const saved = /profile=(\w+)/.exec(location.hash)?.[1];
    const profile = missions.profiles.find((p) => p.id === (saved ?? answer.profile)) ?? missions.profiles[0];
    const day = m.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    clear($('missionLine')).append(
      h('div', { class: 'eyebrow' }, 'Your mission'),
      h('div', { class: 'mission-name' }, profile.id === 'custom' ? 'Custom mission' : profile.blurb),
      h('div', { class: 'mission-sub' }, `lands ${day} · ${formatDuration(m.durationHours)} · slopes under ${v.maxLandingSlopeDeg}°`),
      h('button', { type: 'button', class: 'primary change', onClick: () => openSurvey() }, 'Change mission'),
      h(
        'details',
        { class: 'more' },
        h('summary', {}, 'Mission details'),
        h(
          'ul',
          { class: 'chips' },
          [
            `lands within ${v.ellipseRadiusM} m`,
            `slopes under ${v.maxLandingSlopeDeg}°`,
            `rover climbs ${v.roverMaxSlopeDeg}°`,
            `survives ${v.maxDarknessHours} h dark`,
            `${v.roverSpeedMPerHour} m/h`,
            v.roverNeedsEarthToDrive ? 'needs Earth to drive' : null,
            v.needSunAtLanding ? 'sunlit at touchdown' : null,
            v.needEarthAtLanding ? 'Earth in view at touchdown' : null,
          ]
            .filter(Boolean)
            .map((t) => h('li', {}, t)),
        ),
      ),
    );
  }

  // ---- mission questions (the old Mission step, as a short series of cards) -------------------------------------
  let q = 0;
  const answer = { profile: 'nasa', start: null, hours: 336, values: {} };
  function openSurvey() {
    const m = getMission();
    // before the first search, start from the Pre-set mission's own date (data/missions.json), not the app's default
    const preset = missions.profiles.find((p) => p.id === 'nasa');
    const first = flow.getStep() < 2;
    answer.start = first ? new Date(preset.mission.start) : new Date(m.start);
    answer.hours = first ? preset.mission.durationHours : m.durationHours;
    answer.values = first ? { ...preset.finder } : { ...finder.values };
    q = 0;
    $('survey').hidden = false;
    drawSurvey();
  }
  const choose = (id) => {
    const profile = missions.profiles.find((p) => p.id === id);
    answer.profile = id;
    answer.values = { ...profile.finder };
    if (id === 'nasa') { answer.start = new Date(profile.mission.start); answer.hours = profile.mission.durationHours; }
    drawSurvey();
  };
  const row = (label, hint, options, current, set) =>
    h(
      'div',
      { class: 'exact' },
      h('span', {}, label, hint ? h('small', {}, hint) : null),
      h('div', { class: 'exact-opts' }, options.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(current === value), onClick: () => { set(value); drawSurvey(); } }, text))),
    );
  function missionCard(profile) {
    return h(
      'button',
      { type: 'button', class: 'profile-card', 'aria-pressed': String(answer.profile === profile.id), onClick: () => choose(profile.id) },
      profile.pictures?.length
        ? h('span', { class: 'pics' }, profile.pictures.map((pic) => h('img', { src: picture(pic.src), alt: pic.alt, title: pic.credit, style: `flex: ${pic.width ?? 100} 1 0; object-position: ${pic.position ?? '50% 50%'}` })))
        : null,
      h('strong', {}, profile.name),
      h('span', {}, profile.blurb),
    );
  }
  function drawSurvey() {
    const preset = answer.profile !== 'custom';
    const pages = [
      () => [
        h('h3', {}, 'Plan a mission'),
        h('div', { class: 'profile-cards' }, missions.profiles.map(missionCard)),
        preset
          ? h('ul', { class: 'facts' }, missions.profiles.find((p) => p.id === answer.profile).facts.map((f) => h('li', { title: missions.sources[f.source]?.title ?? '' }, f.text)))
          : h('p', {}, 'Next: the mission, the lander and the rover.'),
      ],
    ];
    if (!preset) {
      for (const group of GROUPS) {
        pages.push(() => [
          h('h3', {}, group.title),
          group.date
            ? [
                h('label', { class: 'date' }, 'Landing datetime (UTC)', h('input', { type: 'datetime-local', step: '3600', value: answer.start.toISOString().slice(0, 16), onChange: (e) => { const d = new Date(`${e.target.value}Z`); if (!Number.isNaN(d.getTime())) answer.start = d; } })),
                row('Duration', null, DURATION_MARKS.map((mark) => [mark.hours, mark.label]), answer.hours, (v) => (answer.hours = v)),
              ]
            : null,
          ...group.choices.map((c) => row(c.label, c.hint, c.options, answer.values[c.key], (v) => (answer.values[c.key] = v))),
        ]);
      }
    }
    q = Math.min(q, pages.length - 1);
    clear($('surveyDots')).append(...pages.map((_, i) => h('i', { class: i <= q ? 'on' : '' })));
    $('surveyCount').textContent = pages.length > 1 ? `Step ${q + 1} of ${pages.length}` : 'Your mission';
    clear($('surveyBody')).append(...pages[q]().flat().filter(Boolean));
    $('surveyBack').style.visibility = q ? 'visible' : 'hidden';
    $('surveyNext').textContent = q === pages.length - 1 ? 'Find regions that fit →' : 'Next';
    $('surveyNext').onclick = () => (q < pages.length - 1 ? (q++, drawSurvey()) : finishSurvey());
    $('surveyBack').onclick = () => q > 0 && (q--, drawSurvey());
  }
  $('surveyClose').onclick = () => {
    if (flow.getStep() >= 2) $('survey').hidden = true;
    else finishSurvey(); // first visit: closing it runs the Pre-set mission
  };
  async function finishSurvey() {
    flow.debug.useProfile(answer.profile);
    Object.assign(finder.values, answer.values);
    finder.drawForm();
    setMission({ start: answer.start, durationHours: answer.hours });
    $('survey').hidden = true;
    closeStreet();
    if (flow.getStep() === 2) await flow.go(1); // a changed mission searches again
    await flow.go(2);
    tab = 'moon';
    markTabs();
    drawSummary();
  }

  // ---- the close-up that pops out of the globe (Moon tab) ---------------------------------------------------
  $('popOpen').onclick = () => show('site');
  $('popStand').onclick = () => show('street');
  const suggested = { result: null, since: 0, done: false };
  /** The pop-out is small: zoom its map in on the drive (the full map is one click away under "Open site"). */
  const MAP_MARGIN = 12; // src/finder/map-view.js MARGIN
  function zoomPopToRoute(result) {
    const canvas = $('finderCanvas');
    const path = finder.getRoute()?.plan?.path;
    if (!result || !path?.length) return void (canvas.style.transform = '');
    const n = result.n;
    let r0 = n, r1 = 0, c0 = n, c1 = 0;
    for (const i of path) { const r = Math.floor(i / n), c = i % n; r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    const W = canvas.clientWidth, H = canvas.clientHeight, size = Math.min(W, H) - 2 * MAP_MARGIN, bx = (W - size) / 2, by = (H - size) / 2;
    const px = (c) => bx + ((c + 0.5) / n) * size, py = (r) => by + ((r + 0.5) / n) * size;
    const span = Math.max(px(c1) - px(c0), py(r1) - py(r0), 1);
    const s = Math.min(2.6, Math.max(1, (0.6 * Math.min(W, H)) / span));
    const cx = (px(c0) + px(c1)) / 2, cy = (py(r0) + py(r1)) / 2;
    const tx = Math.min(0, Math.max(W - s * W, W / 2 - s * cx)), ty = Math.min(0, Math.max(H - s * H, H / 2 - s * cy));
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(3)})`;
  }
  function drawLead() {
    requestAnimationFrame(drawLead);
    // keep the tabs in step with what is on screen (a reload or a saved address can land on either view)
    const step = flow.getStep();
    if (tab !== 'street' && step >= 2) {
      const want = step >= 3 ? 'site' : 'moon';
      if (want !== tab) { tab = want; markTabs(); drawSummary(); }
    }
    const svg = $('leadLine');
    const region = flow.getRegion?.();
    if (tab !== 'moon' || flow.getStep() !== 2 || !region || $('finder').hidden) {
      $('finderCanvas').style.transform = '';
      return void (svg.innerHTML = '');
    }
    // The pop-out shows the rover's drive too: plan one (the finder's own "Suggest a drive") when a region opens.
    const result = finder.getResult?.();
    if (result && result !== suggested.result) { suggested.result = result; suggested.since = Date.now(); suggested.done = false; }
    // keep trying for a while: the drive can only be planned once the region and the rover's reach are ready
    if (result && Date.now() - suggested.since < 15000 && !finder.getRoute()?.targets?.length) {
      if (finder.suggestDrive()) suggested.done = true;
    }
    zoomPopToRoute(result);
    const p = globe.debug.screenOf(region.lat, region.lon);
    const card = $('finder').getBoundingClientRect();
    const stage = $('stage').getBoundingClientRect();
    if (!p) return void (svg.innerHTML = '');
    const x2 = card.left - stage.left, y2 = card.bottom - stage.top - 60;
    svg.innerHTML = `<path d="M${p.x},${p.y} C${p.x + 90},${p.y - 30} ${x2 - 80},${y2} ${x2},${y2}" fill="none" stroke="#ff6a3d" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="${p.x}" cy="${p.y}" r="13" fill="none" stroke="#ff6a3d" stroke-width="1.5"/>`;
    $('popTitle').textContent = region.name;
  }
  requestAnimationFrame(drawLead);

  // ---- street view, inside the app ---------------------------------------------------------------------------
  function openStreet() {
    const start = finder.getRoute()?.start;
    const region = flow.getRegion?.();
    if (!start) {
      flash('Pick a region with room to land first: the street view opens at its landing spot.');
      return false;
    }
    const name = region ? `${region.name} · landing spot` : 'Landing spot';
    const url = `/Street-view/index.html?embed&lat=${start.lat.toFixed(5)}&lon=${start.lon.toFixed(5)}&name=${encodeURIComponent(name)}&start=${getMission().start.toISOString()}${location.search.includes('vr-test') ? '&vr-test' : ''}`;
    const frame = $('svFrame');
    if (frame.dataset.url !== url) {
      frame.dataset.url = url;
      frame.src = url;
      frame.onload = () => {
        const sv = () => frame.contentWindow?.StreetView;
        const fill = () => {
          if (!sv()) return setTimeout(fill, 200);
          const result = finder.getResult?.();
          const items = [];
          if (result) {
            const km2 = (result.counts.passing * result.cellM * result.cellM) / 1e6;
            items.push({ value: km2.toFixed(km2 < 10 ? 1 : 0), unit: 'km²', label: 'Ground that passes every check' });
            items.push({ value: String(result.sites.length), label: result.sites.length === 1 ? 'Landing site found' : 'Landing sites found' });
          }
          const v = finder.values;
          items.push({ value: String(v.maxLandingSlopeDeg), unit: '°', label: 'Steepest it may land on' });
          items.push({ value: String(v.maxDarknessHours), unit: 'h', label: 'Darkness the rover survives' });
          sv().setSummary({ title: region ? `Why ${region.name}` : 'Why this spot', items });
        };
        fill();
      };
    }
    $('svWrap').hidden = false;
    app.classList.add('street-open');
    return true;
  }
  function closeStreet() {
    $('svWrap').hidden = true;
    app.classList.remove('street-open');
  }

  // ---- layout of the Moon tab: the regions list moves into its own card on the right; the globe loses its grid --
  {
    const section = $('regions').closest('section');
    const card = h('div', { class: 'regions-card panel-card', id: 'regionsCard' });
    $('stage').append(card);
    card.append(section);
    section.querySelector('.step-title').textContent = 'Best regions';
    globe.setOption('grid', false);
  }

  // ---- start ------------------------------------------------------------------------------------------------
  // A saved address (a reload, a shared link) goes straight back; a first visit starts with the survey.
  const savedStep = Number(/step=(\d)/.exec(location.hash)?.[1] ?? 1);
  const began = Date.now();
  const waitForFlow = () => {
    if (flow.getStep() >= 2) {
      if (flow.getStep() > 3) flow.go(3); // the old surface steps are now the street view tab
      tab = flow.getStep() >= 3 ? 'site' : 'moon';
      markTabs();
      drawSummary();
      return;
    }
    if (savedStep < 2 || Date.now() - began > 20000) {
      openSurvey();
      markTabs();
      return;
    }
    setTimeout(waitForFlow, 200);
  };
  setTimeout(waitForFlow, 300);
  return { show, openSurvey };
}
