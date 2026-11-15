import { describe, expect, it } from 'vitest';
import { compress, directions, heading, profile } from '../src/finder/directions.js';
import { planMission } from '../src/finder/planner.js';
import { shortestPlan } from '../src/finder/route-options.js';

const setBit = (mask, stride, step, cell, v = 1) => {
  const i = step * stride + (cell >> 3);
  if (v) mask[i] |= 1 << (cell & 7);
  else mask[i] &= ~(1 << (cell & 7));
};
function fake({ steps = 72, n = 9 } = {}) {
  const size = n * n;
  const stride = Math.ceil(size / 8);
  const r = {
    n, cellM: 100, elevation: new Float32Array(size), slope: new Float32Array(size), fail: new Uint8Array(size),
    steps, stepHours: 1, windowHours: steps - 1, maskStride: stride,
    sunMask: new Uint8Array(steps * stride).fill(255), earthMask: new Uint8Array(steps * stride).fill(255),
  };
  r.cell = (row, col) => row * n + col;
  r.dark = (row, col, from, to) => {
    for (let s = from; s <= Math.min(to, steps - 1); s++) setBit(r.sunMask, stride, s, r.cell(row, col), 0);
  };
  return r;
}
const rover = { maxSlopeDeg: 15, rangeM: 1e9, speedMPerHour: 100, maxDarknessHours: 20 };
const at = (row, col) => ({ row, col });

describe('heading', () => {
  it('uses the map grid: up is north, right is east', () => {
    const n = 9;
    const c = 4 * n + 4;
    expect(heading(n, c, c - n)).toBe('N');
    expect(heading(n, c, c + 1)).toBe('E');
    expect(heading(n, c, c + n)).toBe('S');
    expect(heading(n, c, c - n - 1)).toBe('NW');
  });
});

describe('directions', () => {
  it('a straight sunlit drive reads as leave, one drive east, arrive', () => {
    const r = fake();
    const plan = planMission(r, at(4, 0), [at(4, 8)], rover);
    const d = directions(r, plan);
    expect(d.map((s) => s.kind)).toEqual(['depart', 'drive', 'arrive']);
    expect(d[1].text).toBe('Drive 800 m E');
    expect(d[2].text).toContain('Arrive at the destination');
  });

  it('an L-shaped drive gives two legs with their headings', () => {
    const r = fake();
    const plan = shortestPlan(r, at(8, 0), [at(4, 0), at(4, 6)], rover, [0, 1]);
    const d = directions(r, plan).filter((s) => s.kind === 'drive').map((s) => s.text);
    expect(d).toEqual(['Drive 400 m N', 'Drive 600 m E']);
  });

  it('says when it climbs and how steep it gets', () => {
    const r = fake();
    for (let col = 0; col < 9; col++) {
      r.elevation[r.cell(4, col)] = col * 10;
      r.slope[r.cell(4, col)] = 12;
    }
    const plan = planMission(r, at(4, 0), [at(4, 8)], rover);
    const drive = directions(r, plan).find((s) => s.kind === 'drive');
    expect(drive.text).toMatch(/^Climb .* E \(up 80 m\), slopes up to 12°$/);
  });

  it('lists a wait for sunlight on the way', () => {
    const r = fake({ n: 5 });
    for (let row = 0; row < 5; row++) if (row !== 2) for (let col = 0; col < 5; col++) r.slope[r.cell(row, col)] = 30; // one corridor
    r.dark(2, 2, 0, 6);
    r.dark(2, 1, 4, 6); // the cell before the shadow goes dark too: the rover has to wait there in the dark
    const plan = planMission(r, at(2, 0), [at(2, 4)], rover);
    expect(plan.ok).toBe(true);
    const kinds = directions(r, plan).map((s) => s.kind);
    expect(kinds).toContain('wait');
    expect(kinds[kinds.length - 1]).toBe('arrive');
  });

  it('ends with "lost" when the drive does not survive', () => {
    const r = fake({ n: 7 });
    r.dark(3, 3, 2, 60);
    const plan = shortestPlan(r, at(3, 0), [at(3, 6)], rover, [0]);
    const d = directions(r, plan);
    expect(d[d.length - 1].kind).toBe('lost');
  });
});

describe('directions, compressed', () => {
  it('folds many short legs and short waits into one "edge between shadows" line', () => {
    const r = fake();
    const path = [36, 37, 38, 39, 40, 41, 42, 43, 44]; // row 4, west to east
    const steps = [{ kind: 'depart', pathIndex: 0, atHours: 0 }];
    for (let p = 1; p <= 4; p++) {
      steps.push({ kind: 'drive', pathIndex: p - 1, atHours: p, distM: 100, steepestDeg: 11 });
      steps.push({ kind: 'wait', pathIndex: p, atHours: p + 0.5, hours: 2 });
    }
    steps.push({ kind: 'drive', pathIndex: 4, atHours: 9, distM: 400, steepestDeg: 0 });
    steps.push({ kind: 'wait', pathIndex: 8, atHours: 10, hours: 30 });
    steps.push({ kind: 'arrive', pathIndex: 8, atHours: 40 });
    const out = compress(r, path, steps);
    expect(out.map((s) => s.kind)).toEqual(['depart', 'creep', 'wait', 'arrive']);
    expect(out[1].text).toBe('Edge 800 m E between moving shadows: 4 short stops, 8.0 h of waiting in all, slopes up to 11°');
  });

  it('leaves a few short waits alone', () => {
    const r = fake();
    const steps = [
      { kind: 'drive', pathIndex: 0, atHours: 0, distM: 100 },
      { kind: 'wait', pathIndex: 1, atHours: 1, hours: 2 },
      { kind: 'drive', pathIndex: 1, atHours: 3, distM: 100 },
    ];
    expect(compress(r, [36, 37, 38], steps)).toEqual(steps);
  });
});

describe('profile', () => {
  it('measures distance along the path, including height', () => {
    const r = fake();
    r.elevation[r.cell(4, 1)] = 100;
    const plan = shortestPlan(r, at(4, 0), [at(4, 2)], { ...rover, maxSlopeDeg: 90 }, [0]);
    const p = profile(r, plan.path);
    expect(p.length).toBe(plan.path.length);
    expect(p[p.length - 1].distM).toBeCloseTo(plan.distanceM, 6);
  });
});
