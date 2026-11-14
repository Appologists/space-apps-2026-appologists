# Adding a criterion

A criterion answers one question about a site for a mission ("how long is it sunlit?", "how steep is it?")
with a score from 0 (worst) to 1 (best).

## 1. Write the file

`src/criteria/slope.js`:

```js
import slopes from '../../data/derived/site-slopes.json'; // made by a script in tools/

/** @type {import('./types.js').Criterion} */
export default {
  id: 'slope',
  label: 'Landing terrain',
  description: 'How flat the ground is where the lander touches down.',
  status: 'ready',
  defaultWeight: 0.8,
  evaluate(site, ctx) {
    const slopeDeg = slopes[site.id];
    if (slopeDeg == null) {
      return { score: null, value: null, summary: 'No slope data for this point' };
    }
    return {
      score: Math.max(0, 1 - slopeDeg / 15), // 0° is perfect, 15° or more scores zero
      value: slopeDeg,
      unit: '°',
      summary: `Slope ${slopeDeg.toFixed(1)}°`,
      caveats: ['Slope measured over 80 m; smaller rocks and craters are not seen.'],
    };
  },
};
```

What you get:

- `site`: `{ id, name, lat, lon, category, … }` from `data/sites.json`, or the user's own point
  (`id: 'custom'`).
- `ctx.mission`: the user's choices (`src/mission.js`).
- `ctx.sky(site)`: Sun and Earth elevation and azimuth for every time step of the mission.
- `ctx.stepHours`: hours between time steps.

What you return (`src/criteria/types.js` has the full list):

- `score`: 0 to 1, or **`null` when you have no data**. Never guess, never return 0 for "unknown".
- `value` and `unit`: the real-world number.
- `summary`: one short line for the ranked list.
- `caveats`: what the number leaves out. Shown to the user.

## 2. Register it

In `src/criteria/index.js`, import it and add it to the `criteria` array. If it replaces a planned one,
delete that entry from `src/criteria/planned.js`. A slider appears in the app by itself.

## 3. Test it

Add a case to `tests/scoring.test.js`, or a new file in `tests/`, with at least one site where you know the
right answer. `npm test`.

## 4. Tell the team

Update the row in `docs/plan.md`. If you made a judgement call (why 15°?), add it to `docs/decisions.md`.

## Tips

- The user's own point has no entry in your derived file. Return `score: null` for it, or compute on the
  fly if you can.
- Turning a real number into 0–1 is a judgement. Say how in a comment and keep it simple: a straight line
  between "perfect" and "useless" is fine.
- If something should rule a site out entirely rather than lower its score, that is a must-have, not a
  criterion: see plan item 10.
