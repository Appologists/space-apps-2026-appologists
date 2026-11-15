// Plan panel: one plain sentence on the drive. When no drive works it also lists why, since that is what the
// person needs to change something. The hour-by-hour strip, the departure controls and the step-by-step list
// were taken off the demo page (Daniel, 2026-11-14): "Play the drive" shows the same thing as it happens.
import { h } from './dom.js';

export function renderSchedule(el, { plan, text }) {
  el.replaceChildren();
  // A working drive needs no sentence here: the destination row and the route card already say when it arrives.
  if (!plan || plan.ok) return;
  el.append(
    ...[
      h('p', { id: 'scheduleText', class: 'schedule-text' }, text.headline),
      !plan.ok && text.lines?.length ? h('ul', { id: 'scheduleLines', class: 'schedule-lines' }, text.lines.map((line) => h('li', {}, line))) : null,
    ].filter(Boolean), // append() would write a null out as the word "null"
  );
  // "How this is worked out" (text.notes) is shown under "What these results leave out" instead (finder-mode.js).
}
