// The drive plan in plain words: what the rover does, or why no drive works. Pure: no DOM.
import { formatHours } from '../format.js';
import { STATE } from './schedule.js';

/** Destinations are named A, B, C … in the order they were added. */
export const destinationName = (index) => String.fromCharCode(65 + index);

/** One sentence on what the rover is doing and why, for each state of the replay. From Khiem's drive story (PR #7). */
export const STATE_STORY = Object.freeze({
  [STATE.PARKED]: 'The rover sits at its start, waiting for its moment to leave.',
  [STATE.DRIVING]: 'Its spot is sunlit, so it drives on along the route.',
  [STATE.WAIT_SUN]: 'Its spot has fallen into shadow. It must stop and wait for the light while the time in the dark counts up.',
  [STATE.WAIT_EARTH]: 'It has sunlight, but Earth is below the horizon and it needs Earth in view to drive. It waits.',
  [STATE.LOST]: 'It sat in the dark for longer than it can survive. The mission is lost here.',
});

/** A few words for each state, for the drive's timeline beside the map (Daniel's wording, 2026-11-14). */
export const STATE_LABEL = Object.freeze({
  [STATE.PARKED]: 'Waiting to set off',
  [STATE.DRIVING]: 'Driving in sunlight',
  [STATE.WAIT_SUN]: 'Waiting in the dark',
  [STATE.WAIT_EARTH]: 'Waiting for Earth to rise',
  [STATE.HOLD]: 'Waiting until path is lit',
  [STATE.ARRIVED]: 'Arrived',
  [STATE.LOST]: 'Lost in the dark',
});

/** The timeline's words for one milestone (see `milestones` in playback.js). */
export function milestoneLabel(milestone) {
  if (milestone.state == null) return 'Touchdown';
  if (milestone.destination != null) return `Arrived at marker ${destinationName(milestone.destination)}`;
  return STATE_LABEL[milestone.state] ?? '';
}

const km = (m) => {
  const v = m / 1000;
  return `${v.toFixed(v < 10 ? 1 : 0)} km`;
};
const after = (hours) => `${formatHours(hours)} after landing`;
const list = (items, joiner = 'and') => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ${joiner} ${items[items.length - 1]}`);

function reasonText(reason, { rover, many }) {
  const dest = (i) => (many ? `Destination ${destinationName(i)}` : 'The destination');
  switch (reason.code) {
    case 'no-destination':
      return ['Add a destination to plan a drive.'];
    case 'no-masks':
      return ['This search result has no hour-by-hour sunlight, so a drive cannot be planned. Run the search again.'];
    case 'start-off-map':
      return ['The start is off the map.'];
    case 'start-steep':
      return [`The start is on ground steeper than the rover drives (${rover.maxSlopeDeg}°), or has no terrain data.`];
    case 'dest-off-map':
      return [`${dest(reason.destination)} is off the map.`];
    case 'dest-steep':
      return [`${dest(reason.destination)} is on ground steeper than the rover drives (${rover.maxSlopeDeg}°), or outside the search area.`];
    case 'dest-no-path':
      return [`There is no drivable path to ${many ? `destination ${destinationName(reason.destination)}` : 'the destination'} on slopes up to ${rover.maxSlopeDeg}°, even ignoring sunlight.`];
    case 'dest-beyond-range':
      return [`${dest(reason.destination)} is ${km(reason.neededM)} away by the shortest drivable path, beyond the rover's range of ${km(rover.rangeM)}.`];
    case 'start-lost':
      return [`The rover is lost at the start ${after(reason.lostAtHours)}: it is dark there for longer than the ${formatHours(rover.maxDarknessHours)} the rover survives.`];
    case 'start-never-lit':
      return ['From the time the rover may leave, the start is never sunlit again during the mission, so it cannot drive off.'];
    case 'no-time':
      return ['The rover may not leave before the mission ends.'];
    case 'no-way': {
      const lines = [];
      for (const help of reason.helps ?? []) {
        if (help.change === 'earth') lines.push(`It would work if the rover did not need Earth in view to drive (arriving ${after(help.arrivalHours)}).`);
        if (help.change === 'darkness') lines.push(`It would work if the rover survived longer darkness: one such drive has ${formatHours(help.longestDarkH)} of darkness in a row (arriving ${after(help.arrivalHours)}). The least it would need may be lower.`);
        if (help.change === 'range') lines.push(`It would work with a longer range: one such drive is ${km(help.distanceM)} (arriving ${after(help.arrivalHours)}).`);
      }
      if (!reason.helps?.length && reason.helps) {
        const tried = [Number.isFinite(rover.maxDarknessHours) ? 'the darkness limit' : null, Number.isFinite(rover.rangeM) ? 'the range' : null, rover.needEarthToDrive ? 'the need for Earth in view' : null].filter(Boolean);
        lines.push(`${tried.length ? `Lifting ${list(tried)}, one at a time, does not help. ` : ''}Somewhere on every way there, the ground is not sunlit when the rover needs it, or the mission ends first.`);
      }
      if (reason.alone) {
        const bad = reason.alone.filter((a) => !a.reached).map((a) => destinationName(a.destination));
        const endable = reason.alone.filter((a) => a.ok).map((a) => destinationName(a.destination));
        if (bad.length) lines.push(`${bad.length === 1 ? `Destination ${bad[0]} cannot` : `Destinations ${list(bad)} cannot`} be reached even on ${bad.length === 1 ? 'its' : 'their'} own. Remove ${bad.length === 1 ? 'it' : 'them'} to plan the rest.`);
        else if (!endable.length) lines.push('Each destination can be reached on its own, but the rover would be lost waiting at any of them: each is dark for too long before the mission ends.');
        else lines.push(`Each destination can be reached on its own, but no order fits them all into the mission with the rover ending somewhere it is not lost (it could end at ${list(endable, 'or')}).`);
      }
      return lines;
    }
    default:
      return [];
  }
}

/**
 * @param {object} result  the FinderResult the plan was made on
 * @param {object} plan    from planMission()
 * @param {{rover: object, destinations: object[]}} context
 * @returns {{ headline: string, lines: string[], notes: string }}
 */
export function planText(result, plan, { rover, destinations }) {
  const many = destinations.length > 1;
  const H = result.stepHours;
  const rules = `the rover leaves a spot only while it is sunlit there${rover.needEarthToDrive ? ' and sees Earth' : ''}, and must not sit in darkness for more than ${formatHours(rover.maxDarknessHours)}`;
  const lines = [];
  let headline;

  if (!plan.drive) {
    const first = plan.reasons[0]?.code;
    headline = first === 'no-way' ? `No drive works: ${rules}.` : 'No drive can be planned.';
    for (const reason of plan.reasons) lines.push(...reasonText(reason, { rover, many }));
  } else {
    const { drive } = plan;
    const names = plan.order.map(destinationName);
    const last = many ? `destination ${names[names.length - 1]}` : 'the destination';
    if (plan.ok) {
      headline = many
        ? `The rover visits ${names.length === 2 ? 'both' : `all ${names.length}`} destinations, in the order ${list(names)}, and reaches the last ${after(drive.arrivalHours)}.`
        : `The rover reaches the destination ${after(drive.arrivalHours)}.`;
    } else {
      headline = `The rover reaches ${last} ${after(drive.arrivalHours)}, but is lost ${after(drive.lostAtHours)}: it sits in darkness there for longer than the ${formatHours(rover.maxDarknessHours)} it survives.`;
      for (const reason of plan.reasons) lines.push(...reasonText(reason, { rover, many }));
    }

    // When it sets off, and how the time on the way divides up.
    const firstDrive = drive.timeline.indexOf(STATE.DRIVING);
    const count = (state) => drive.timeline.reduce((sum, s) => sum + (s === state ? 1 : 0), 0) * H;
    const sun = count(STATE.WAIT_SUN);
    const earth = count(STATE.WAIT_EARTH);
    const held = count(STATE.HOLD);
    const waitParts = [sun ? `${formatHours(sun)} for sunlight` : null, earth ? `${formatHours(earth)} for Earth to come into view` : null, held ? `${formatHours(held)} in sunlight until the way ahead is ready` : null].filter(Boolean);
    if (firstDrive >= 0) {
      lines.push(
        `It sets off ${firstDrive === 0 ? 'at landing' : after(firstDrive * H)}, drives for ${formatHours(drive.drivingHours)} in all` +
          (waitParts.length ? `, and waits on the way: ${list(waitParts)}.` : ', and never has to wait on the way.'),
      );
    }
    if (many) lines.push(`Arrivals: ${list(plan.stops.map((stop) => `${destinationName(stop.destination)} at ${formatHours(stop.arrivalHours)}`))} after landing.`);
    const longest = plan.waits.filter((w) => w.state !== STATE.PARKED).sort((a, b) => b.hours - a.hours)[0];
    if (longest && longest.hours >= 2 * H) {
      const why = longest.state === STATE.WAIT_SUN ? 'in the dark, waiting for sunlight' : longest.state === STATE.WAIT_EARTH ? 'waiting for Earth' : 'in sunlight';
      lines.push(`Its longest stop on the way is ${formatHours(longest.hours)} ${why}, from ${after(longest.fromHours)}. Stops are marked on the map.`);
    }
    // Distance, against the shortest way when there is one to compare with.
    if (plan.shortestM != null && plan.distanceM > plan.shortestM + result.cellM) {
      lines.push(`It drives ${km(plan.distanceM)}: ${km(plan.distanceM - plan.shortestM)} more than the shortest drivable way (${km(plan.shortestM)}), to keep to sunlit ground.`);
    } else lines.push(`It drives ${km(plan.distanceM)}${plan.shortestM != null ? ', the shortest drivable way' : ''}.`);
    if (plan.ok) {
      const tight = Number.isFinite(rover.maxDarknessHours) && drive.longestDarkH > 0 && drive.longestDarkH >= 0.8 * rover.maxDarknessHours;
      lines.push(`Its longest stretch in darkness is ${formatHours(drive.longestDarkH)}; it survives ${formatHours(rover.maxDarknessHours)}.${tight ? ' That leaves little or no margin: the plan goes for the earliest arrival, not the safest.' : ''}`);
      let tail = 0;
      while (tail < drive.lit.length && !drive.lit[drive.lit.length - 1 - tail]) tail++;
      if (tail) lines.push(`When the mission ends the rover has been in darkness for ${formatHours(tail * H)}. What happens after the mission is not checked.`);
    }
  }

  const notes =
    `How this is worked out: sunlight${rover.needEarthToDrive ? ' and the view of Earth are' : ' is'} checked every ${formatHours(H)} on ${result.cellM} m cells, and the route and the waiting are chosen together for the earliest arrival. ` +
    'The rover leaves a spot only while it is sunlit there, so it never crosses a shadow, however narrow; a real rover could cross short ones on its battery. ' +
    'It stops only on cell centres and stays at the last destination. This finds a workable plan, not always the best one, and when it finds none there may still be one it missed.' +
    (plan.selfCheck === false ? ' Warning: the replay of this plan did not match the search. Treat it with caution and report it.' : '') +
    (plan.computeMs ? ` Planned in ${plan.computeMs < 950 ? `${Math.max(1, Math.round(plan.computeMs))} ms` : `${(plan.computeMs / 1000).toFixed(1)} s`}.` : '');
  return { headline, lines, notes };
}
