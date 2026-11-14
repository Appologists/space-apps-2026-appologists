// The list of criteria the app knows about, in display order. Add a new one here.
import sunlight from './sunlight.js';
import earthComms from './earth-comms.js';
import planned from './planned.js';

/** @type {import('./types.js').Criterion[]} */
export const criteria = [sunlight, earthComms, ...planned];

export const readyCriteria = criteria.filter((c) => c.status === 'ready');
export const plannedCriteria = criteria.filter((c) => c.status !== 'ready');

/** Starting weights: { [criterionId]: 0–1 }. */
export const defaultWeights = () => Object.fromEntries(readyCriteria.map((c) => [c.id, c.defaultWeight]));
