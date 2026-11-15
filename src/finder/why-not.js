// Why a drive does not work, as a short banner and as marks on the map. Pure: no DOM.
// Reads the planner's reasons (planner.js / plan-text.js) and, when the shortest route gets the rover lost,
// where that happens.
import { formatHours } from '../format.js';
import { destinationName } from './plan-text.js';

const km = (m) => `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;

/**
 * @param {object} result   FinderResult
 * @param {{row, col}} start
 * @param {{row, col}[]} targets
 * @param {object} rover    { maxSlopeDeg, rangeM, maxDarknessHours, needEarthToDrive }
 * @param {object} fastest  the planner's plan
 * @param {object|null} shortest  the shortest-route plan (route-options.js), or null
 * @returns {null | { title, problems: [{ text, tip?, layer? }], marks: [{ row, col, kind, label }] }}
 *   kind: 'steep' | 'walled' | 'far' | 'dark' | 'lost'. null when the fastest plan works.
 */
export function whyNot(result, start, targets, rover, fastest, shortest = null) {
  if (!fastest || fastest.ok || !targets.length) return null;
  const { n, slope } = result;
  const many = targets.length > 1;
  const name = (i) => (many ? `Destination ${destinationName(i)}` : 'The destination');
  const label = (i) => (many ? destinationName(i) : '!');
  const problems = [];
  const marks = [];
  const at = (p) => ({ row: p.row, col: p.col });
  const slopeAt = (p) => slope[p.row * n + p.col];
  const deg = (v) => `${Number.isFinite(v) ? v.toFixed(0) : '?'}°`;

  const reasons = fastest.reasons ?? [];
  for (const reason of reasons) {
    const d = reason.destination;
    switch (reason.code) {
      case 'start-steep':
        problems.push({ text: `The start is on ${deg(slopeAt(start))} ground; the rover climbs at most ${rover.maxSlopeDeg}°.`, tip: 'Pick a flatter start, or raise "Steepest slope it drives".', layer: 'slope' });
        marks.push({ ...at(start), kind: 'steep', label: '!' });
        break;
      case 'start-off-map':
        problems.push({ text: 'The start is off the map.', tip: 'Click inside the search circle.' });
        break;
      case 'dest-steep':
        problems.push({ text: `${name(d)} is on ${deg(slopeAt(targets[d]))} ground; the rover climbs at most ${rover.maxSlopeDeg}°.`, tip: 'Move it to flatter ground (the "Slope" layer shows where), or raise "Steepest slope it drives".', layer: 'slope' });
        marks.push({ ...at(targets[d]), kind: 'steep', label: label(d) });
        break;
      case 'dest-off-map':
        problems.push({ text: `${name(d)} is off the map.`, tip: 'Click inside the search circle.' });
        break;
      case 'dest-no-path':
        problems.push({ text: `${name(d)} is walled in: every way there crosses ground steeper than ${rover.maxSlopeDeg}°.`, tip: 'The "Reach" layer shows where the rover can drive from the start.', layer: 'reach' });
        marks.push({ ...at(targets[d]), kind: 'walled', label: label(d) });
        break;
      case 'dest-beyond-range':
        problems.push({ text: `${name(d)} is ${km(reason.neededM)} away by the shortest drivable path; the rover's range is ${km(rover.rangeM)}.`, tip: 'Pick a nearer spot, or raise "Range".', layer: 'reach' });
        marks.push({ ...at(targets[d]), kind: 'far', label: label(d) });
        break;
      case 'start-lost':
        problems.push({ text: `The start is dark for longer than the rover survives (${formatHours(rover.maxDarknessHours)}): it is lost ${formatHours(reason.lostAtHours)} after landing, before it can drive away.`, tip: 'Pick a start that stays sunlit (the "Darkness" layer shows long darkness), or land at another time.', layer: 'dark' });
        marks.push({ ...at(start), kind: 'dark', label: '!' });
        break;
      case 'start-never-lit':
        problems.push({ text: 'The start is never sunlit again once the rover may leave, so it cannot drive off.', tip: 'Pick a sunnier start (the "Sunlight" layer).', layer: 'sun' });
        marks.push({ ...at(start), kind: 'dark', label: '!' });
        break;
      case 'no-time':
        problems.push({ text: 'The rover may not leave before the mission ends.', tip: 'Lower "Leave no earlier than".' });
        break;
      case 'no-way': {
        const help = (reason.helps ?? [])[0];
        const bad = (reason.alone ?? []).filter((a) => !a.reached).map((a) => a.destination);
        for (const b of bad) {
          problems.push({ text: `${name(b)} cannot be reached in sunlight during the mission, even on its own.`, tip: 'Remove it, or move it towards ground that is lit more often (the "Sunlight" layer).', layer: 'sun' });
          marks.push({ ...at(targets[b]), kind: 'dark', label: label(b) });
        }
        if (!bad.length) {
          const text = `No way there stays in sunlight long enough: somewhere on every route the ground is dark when the rover needs to drive, for longer than it survives (${formatHours(rover.maxDarknessHours)}).`;
          const tip = help?.change === 'darkness'
            ? `It would work if the rover survived about ${formatHours(help.longestDarkH)} of darkness. Try raising "Longest darkness survived".`
            : help?.change === 'earth'
              ? 'It would work if the rover did not need Earth in view to drive.'
              : help?.change === 'range'
                ? `It would work with a range of about ${km(help.distanceM)}.`
                : 'Try a destination in ground that is lit more often (the "Sunlight" layer), or another landing time.';
          problems.push({ text, tip, layer: help ? null : 'sun' });
        }
        break;
      }
      default:
        break;
    }
  }
  // It gets there but freezes afterwards: mark the last stop.
  if (fastest.drive && fastest.drive.arrived && !fastest.drive.survived) {
    const last = fastest.order[fastest.order.length - 1];
    problems.unshift({ text: `The rover reaches ${many ? `destination ${destinationName(last)}` : 'the destination'}, but that spot then stays dark for longer than it survives (${formatHours(rover.maxDarknessHours)}): it is lost ${formatHours(fastest.drive.lostAtHours)} after landing.`, tip: 'Choose a final stop that stays sunlit until the mission ends (the "Darkness" layer).', layer: 'dark' });
    marks.push({ ...at(targets[last]), kind: 'dark', label: label(last) });
  }
  // Where the shortest (sunlight-blind) route would get it lost.
  if (shortest?.drive && !shortest.drive.survived && shortest.path) {
    const idx = Math.max(0, ...Array.from(shortest.drive.cellIndex));
    const cell = shortest.path[Math.min(idx, shortest.path.length - 1)];
    marks.push({ row: (cell / n) | 0, col: cell % n, kind: 'lost', label: '✕' });
  }
  if (!problems.length) problems.push({ text: 'No drive could be planned with these limits.' });
  const title = fastest.drive?.arrived ? 'The rover gets there, but does not survive' : 'Why the rover cannot get there';
  return { title, problems, marks };
}

/** Colours for the map marks and the banner. */
export const WHY_COLOURS = Object.freeze({ steep: '#ff8a5b', walled: '#ff8a5b', far: '#c4b2ff', dark: '#8fa8ff', lost: '#e04848' });
