// The app around the finder: top tabs, the mission survey, the close-up that pops out of the globe, the street
// view, and presenter notes. It drives the mission steps (flow.js) instead of showing them:
//   Moon        flow step 2: the globe, the best regions, and the chosen region's map as a pop-out card
//   Site        flow step 3: the region's map full size, map layers and the rover's drive
//   Street view the street view (public/Street-view/) at the landing spot, inside the app
//   Learn       the education pages (education/)
// The survey sets the same values the old "Mission" step did (data/missions.json profiles, finder values).
import missions from '../../data/missions.json';
import { formatDuration } from '../mission.js';
import { clear, h } from './dom.js';

const $ = (id) => document.getElementById(id);

// Survey answers -> finder values. Every option is one of the choices the old Mission step offered.
const LANDERS = [
  { id: 'nasa', title: 'Ice-hunting rover', sub: "like NASA's VIPER · slow and careful, steered from Earth" },
  { id: 'custom', title: 'Faster rover', sub: 'drives on its own, without Earth in view' },
];
const LENGTHS = [
  [168, '7 days'],
  [336, '14 days'],
  [708, 'One lunar day', '29.5 days'],
];
const MUSTS = [
  { key: 'needSunAtLanding', title: 'Sunlight at touchdown', sub: 'power from the moment it lands' },
  { key: 'needEarthAtLanding', title: 'Earth in view at touchdown', sub: 'talk to mission control straight away' },
];
const CARE = [
  { id: 'cautious', title: 'Cautious', sub: 'slopes under 5° · rover survives 24 h of dark', v: { maxLandingSlopeDeg: 5, maxDarknessHours: 24 } },
  { id: 'balanced', title: 'Balanced', sub: 'slopes under 10° · 50 h of dark', v: { maxLandingSlopeDeg: 10, maxDarknessHours: 50 } },
  { id: 'bold', title: 'Bold', sub: 'slopes under 15° · 100 h of dark', v: { maxLandingSlopeDeg: 15, maxDarknessHours: 100 } },
];
// "More options": the exact choices, same lists as the old step's buttons (flow.js GROUPS)
const MORE = {
  lander: [
    ['ellipseRadiusM', 'Lands within', [[50, '50 m'], [100, '100 m'], [500, '500 m']]],
    ['roverMaxSlopeDeg', 'Rover climbs slopes up to', [[10, '10°'], [15, '15°'], [20, '20°']]],
    ['roverSpeedMPerHour', 'Rover average speed', [[36, '36 m/h'], [200, '200 m/h'], [720, '720 m/h']]],
    ['roverNeedsEarthToDrive', 'Rover needs Earth in view to drive', [[true, 'Yes'], [false, 'No']]],
  ],
  care: [
    ['maxLandingSlopeDeg', 'Lands on slopes under', [[5, '5°'], [10, '10°'], [15, '15°']]],
    ['maxDarknessHours', 'Rover survives darkness for', [[24, '24 h'], [50, '50 h'], [100, '100 h']]],
  ],
};

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
    const lander = LANDERS.find((l) => (l.id === 'nasa' ? v.roverSpeedMPerHour === 36 : v.roverSpeedMPerHour !== 36)) ?? LANDERS[0];
    const day = m.start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    clear($('missionLine')).append(
      h('div', { class: 'eyebrow' }, 'Your mission'),
      h('div', { class: 'mission-name' }, lander.title),
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

  // ---- survey ---------------------------------------------------------------------------------------------
  let q = 0;
  const answer = { lander: 'nasa', start: null, hours: 336, musts: new Set(['needSunAtLanding', 'needEarthAtLanding']), care: 'balanced', exact: {} };
  function openSurvey() {
    const m = getMission();
    const v = finder.values;
    // before the first search, start from the ready-made mission's own date (data/missions.json), not the app's default "now"
    const preset = missions.profiles.find((p) => p.id === 'nasa');
    answer.start = flow.getStep() >= 2 ? new Date(m.start) : new Date(preset.mission.start);
    answer.hours = m.durationHours;
    answer.lander = v.roverSpeedMPerHour === 36 && v.roverNeedsEarthToDrive ? 'nasa' : flow.getStep() >= 2 ? 'custom' : 'nasa';
    answer.musts = new Set(MUSTS.filter((x) => v[x.key]).map((x) => x.key));
    answer.care = CARE.find((c) => c.v.maxLandingSlopeDeg === v.maxLandingSlopeDeg && c.v.maxDarknessHours === v.maxDarknessHours)?.id ?? 'balanced';
    answer.exact = {};
    q = 0;
    $('survey').hidden = false;
    drawSurvey();
  }
  const opt = (on, title, sub, onClick) => h('button', { type: 'button', class: 'opt', 'aria-pressed': String(on), onClick }, h('b', {}, title), sub ? h('span', {}, sub) : null);
  const exactRows = (list) =>
    h(
      'details',
      { class: 'more' },
      h('summary', {}, 'More options'),
      ...list.map(([key, label, options]) => {
        const current = key in answer.exact ? answer.exact[key] : finder.values[key];
        return h(
          'div',
          { class: 'exact' },
          h('span', {}, label),
          h('div', { class: 'exact-opts' }, options.map(([value, text]) => h('button', { type: 'button', 'aria-pressed': String(current === value), onClick: () => { answer.exact[key] = value; drawSurvey(true); } }, text))),
        );
      }),
    );
  function drawSurvey(keepOpen = false) {
    const wasOpen = keepOpen && $('surveyBody').querySelector('details')?.open;
    const pages = [
      () => [
        h('h3', {}, "What's landing?"),
        h('p', {}, 'Pick the closest. You can fine-tune it below.'),
        h('div', { class: 'opts' }, LANDERS.map((l) => opt(answer.lander === l.id, l.title, l.sub, () => { answer.lander = l.id; answer.exact = {}; drawSurvey(); }))),
        exactRows(MORE.lander),
      ],
      () => [
        h('h3', {}, 'When, and for how long?'),
        h('p', {}, 'The Sun and Earth move, so the date changes the answer. Times are UTC.'),
        h(
          'label',
          { class: 'date' },
          'Landing',
          h('input', { type: 'datetime-local', step: '3600', value: answer.start.toISOString().slice(0, 16), onChange: (e) => { const d = new Date(`${e.target.value}Z`); if (!Number.isNaN(d.getTime())) answer.start = d; } }),
        ),
        h('div', { class: 'opts row' }, LENGTHS.map(([hrs, t, sub]) => opt(answer.hours === hrs, t, sub, () => { answer.hours = hrs; drawSurvey(); }))),
      ],
      () => [
        h('h3', {}, 'What must be true at touchdown?'),
        h('p', {}, 'Pick any. Each one rules out ground that fails it.'),
        h('div', { class: 'opts grid' }, MUSTS.map((m) => opt(answer.musts.has(m.key), m.title, m.sub, () => { answer.musts.has(m.key) ? answer.musts.delete(m.key) : answer.musts.add(m.key); drawSurvey(); }))),
      ],
      () => [
        h('h3', {}, 'How careful should we be?'),
        h('p', {}, 'Sets the steepest ground it may land on and how long the rover must survive in the dark.'),
        h('div', { class: 'opts row' }, CARE.map((c) => opt(answer.care === c.id, c.title, c.sub, () => { answer.care = c.id; for (const k of Object.keys(c.v)) delete answer.exact[k]; drawSurvey(); }))),
        exactRows(MORE.care),
      ],
    ];
    clear($('surveyDots')).append(...pages.map((_, i) => h('i', { class: i <= q ? 'on' : '' })));
    $('surveyCount').textContent = `Question ${q + 1} of ${pages.length}`;
    clear($('surveyBody')).append(...pages[q]());
    if (wasOpen) $('surveyBody').querySelector('details').open = true;
    $('surveyBack').style.visibility = q ? 'visible' : 'hidden';
    $('surveyNext').textContent = q === pages.length - 1 ? 'Find landing regions →' : 'Next';
    $('surveyNext').onclick = () => (q < pages.length - 1 ? (q++, drawSurvey()) : finishSurvey());
    $('surveyBack').onclick = () => q > 0 && (q--, drawSurvey());
  }
  $('surveyClose').onclick = () => {
    if (flow.getStep() >= 2) $('survey').hidden = true;
    else finishSurvey(); // first visit: closing it runs the ready-made mission as it stands
  };
  async function finishSurvey() {
    flow.debug.useProfile(answer.lander);
    const care = CARE.find((c) => c.id === answer.care).v;
    Object.assign(finder.values, care, Object.fromEntries(MUSTS.map((m) => [m.key, answer.musts.has(m.key)])), answer.exact);
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
    if (tab !== 'moon' || flow.getStep() !== 2 || !region || $('finder').hidden) return void (svg.innerHTML = '');
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
    const url = `/Street-view/index.html?embed&lat=${start.lat.toFixed(5)}&lon=${start.lon.toFixed(5)}&name=${encodeURIComponent(name)}&start=${getMission().start.toISOString()}`;
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
