// The drive simulation: play the chosen route hour by hour on the map, with moving shadows, the rover's state
// and how long it has been in the dark. All numbers come from the plan's replay (src/finder/simulation.js).
import { frameAt, keySteps, prepareSimulation } from '../finder/simulation.js';
import { STATE } from '../finder/schedule.js';
import { destinationName } from '../finder/plan-text.js';
import { formatHours } from '../format.js';
import { h } from './dom.js';

const STORY = {
  [STATE.PARKED]: 'The rover sits at the landing site, waiting for its moment to leave.',
  [STATE.DRIVING]: 'Its spot is sunlit, so it drives on along the route.',
  [STATE.WAIT_SUN]: 'Its spot has fallen into shadow. It must stop and wait for the light, while the time in the dark counts up.',
  [STATE.WAIT_EARTH]: 'It has sunlight but Earth is below the horizon, and it needs Earth in view to drive. It waits.',
  [STATE.HOLD]: 'It waits on purpose in sunlight: the ground ahead is still dark, and setting off now would strand it there.',
  [STATE.ARRIVED]: 'It has arrived and stays there for the rest of the mission.',
  [STATE.LOST]: 'It sat in the dark for longer than it can survive. The mission is lost here.',
};
const SPEEDS = [
  ['1', 'Slow'],
  ['4', 'Normal'],
  ['16', 'Fast'],
];

/**
 * @param {{ el: HTMLElement, getMap: () => object|null }} options
 */
export function createSimulation({ el, getMap }) {
  let sim = null;
  let rover = null;
  let step = 0;
  let playing = false;
  let speed = 4; // time steps per second
  let timer = null;
  let last = 0;
  let parts = null;
  let active = false; // the map shows the simulation only once it has been started or scrubbed

  function stop() {
    playing = false;
    if (timer) clearTimeout(timer);
    timer = null;
    if (parts) parts.play.textContent = '▶ Play';
  }

  function tick() {
    if (!playing) return;
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    step = Math.min(sim.steps - 1, step + dt * speed);
    show();
    const f = frameAt(sim, step);
    const doneOk = f.state === STATE.ARRIVED && sim.plan.ok; // nothing more happens after a safe arrival
    if (step >= sim.steps - 1 || f.state === STATE.LOST || doneOk) {
      stop();
      return;
    }
    timer = setTimeout(tick, 40);
  }

  function play() {
    if (!sim) return;
    if (playing) return stop();
    active = true;
    const now = frameAt(sim, step);
    if (step >= sim.steps - 1 || now.state === STATE.LOST || (now.state === STATE.ARRIVED && sim.plan.ok)) step = 0;
    playing = true;
    parts.play.textContent = '⏸ Pause';
    last = performance.now();
    timer = setTimeout(tick, 40);
  }

  function show() {
    if (!sim || !parts) return;
    const f = frameAt(sim, step);
    if (active) getMap()?.setSim(f);
    parts.slider.value = String(f.step);
    const days = f.hours / 24;
    parts.time.textContent = `Day ${days.toFixed(1)} · ${formatHours(f.hours)} after landing`;
    parts.state.textContent = f.text;
    parts.state.style.borderColor = f.colour;
    parts.state.style.color = f.colour;
    parts.light.textContent = f.lit ? '☀ In sunlight' : '🌑 In the dark';
    parts.earth.textContent = f.earth ? '🌍 Earth in view' : '🌍 Earth hidden';
    const max = rover?.maxDarknessHours;
    const share = Number.isFinite(max) && max > 0 ? Math.min(1, f.darkRunH / max) : 0;
    parts.darkFill.style.width = `${(share * 100).toFixed(1)}%`;
    parts.darkFill.style.background = share > 0.8 ? '#e04848' : share > 0.5 ? '#ff8a5b' : '#8fa8ff';
    parts.darkText.textContent = Number.isFinite(max) ? `Time in the dark so far: ${Math.round(f.darkRunH)} h of the ${Math.round(max)} h it survives` : `Time in the dark so far: ${Math.round(f.darkRunH)} h`;
    const total = sim.cum[sim.cum.length - 1];
    parts.dist.textContent = `Driven ${(f.distanceM / 1000).toFixed(1)} of ${(total / 1000).toFixed(1)} km${f.reached.length ? ` · reached ${f.reached.map(destinationName).join(', ')}` : ''}`;
    parts.story.textContent = STORY[f.state] ?? '';
  }

  function render() {
    el.replaceChildren();
    parts = null;
    if (!sim) return;
    const play_ = h('button', { type: 'button', class: 'sim-play', onClick: play }, '▶ Play');
    const slider = h('input', { type: 'range', min: 0, max: sim.steps - 1, step: 1, value: 0, 'aria-label': 'Time in the mission', onInput: (e) => { stop(); active = true; step = Number(e.target.value); show(); } });
    const jump = (dir) => {
      stop();
      active = true;
      const keys = keySteps(sim);
      const cur = Math.round(step);
      const next = dir > 0 ? keys.find((k) => k > cur) ?? sim.steps - 1 : [...keys].reverse().find((k) => k < cur) ?? 0;
      step = next;
      show();
    };
    const speedSel = h('select', { 'aria-label': 'Speed', onChange: (e) => { speed = Number(e.target.value); } },
      SPEEDS.map(([v, label]) => h('option', { value: v, selected: Number(v) === speed }, label)));
    parts = {
      play: play_,
      slider,
      time: h('span', { class: 'sim-time' }),
      state: h('span', { class: 'sim-state' }),
      light: h('span', {}),
      earth: h('span', {}),
      darkFill: h('i'),
      darkText: h('div', { class: 'sim-darktext' }),
      dist: h('div', { class: 'sim-dist' }),
      story: h('p', { class: 'sim-story' }),
    };
    el.append(
      h('div', { class: 'route-sub' }, 'Simulation: watch the drive hour by hour'),
      h('div', { class: 'sim-controls' },
        h('button', { type: 'button', title: 'Back to landing', onClick: () => { stop(); active = true; step = 0; show(); } }, '⏮'),
        h('button', { type: 'button', title: 'Previous change', onClick: () => jump(-1) }, '◀'),
        play_,
        h('button', { type: 'button', title: 'Next change', onClick: () => jump(1) }, '▶▶'),
        speedSel),
      slider,
      h('div', { class: 'sim-status' }, parts.time, parts.state),
      h('div', { class: 'sim-flags' }, parts.light, parts.earth),
      h('div', { class: 'sim-darkbar', title: 'Unbroken time in the dark; full means lost' }, parts.darkFill),
      parts.darkText,
      parts.dist,
      parts.story,
      h('p', { class: 'caveats' }, 'Dark blue on the map is ground in shadow at that hour. "▶▶" jumps to the next time the rover changes what it is doing.'),
    );
    show();
  }

  return {
    /** New route (or none): stop, rewind and redraw. */
    setPlan(result, plan, roverNow) {
      stop();
      step = 0;
      active = false;
      getMap()?.setSim(null);
      rover = roverNow;
      sim = result && plan?.path?.length > 1 && plan.drive ? prepareSimulation(result, plan) : null;
      render();
    },
    stop() {
      stop();
      getMap()?.setSim(null);
    },
  };
}
