// Criteria the team wants but has not built. They show in the app as "planned" and are never scored.
// To build one: move it to its own file, set status to 'ready', and return a real score from evaluate().
// See docs/adding-a-criterion.md.
import { noData } from './types.js';

const planned = (c) => ({
  status: 'planned',
  defaultWeight: 0,
  evaluate: () => noData('Not built yet'),
  ...c,
});

/** @type {import('./types.js').Criterion[]} */
export default [
  planned({
    id: 'slope',
    label: 'Landing terrain',
    description: 'How flat and smooth the ground is where the lander touches down.',
    needs: 'Slope computed from LOLA elevation (catalog ids lola-south-80s-80m, ldem-16).',
  }),
  planned({
    id: 'traverse',
    label: 'Travel paths',
    description: 'How much ground a rover can reach from the site without crossing slopes that are too steep.',
    needs: 'A slope map around each site, then a reachability search with a maximum slope.',
  }),
  planned({
    id: 'water',
    label: 'Water ice access',
    description: 'How close the site is to permanently shadowed ground, where water ice can survive.',
    needs: 'A map of permanently shadowed regions (derived from LOLA) or published ice detections.',
  }),
  planned({
    id: 'thermal',
    label: 'Temperature',
    description: 'How hot and cold the surface gets during the mission.',
    needs: 'LRO Diviner surface temperature maps, or a simple model driven by Sun elevation.',
  }),
];
