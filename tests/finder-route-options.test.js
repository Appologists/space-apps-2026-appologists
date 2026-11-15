import { describe, expect, it } from 'vitest';
import { DARK_MARGIN, routeOptions, routeSummary, safestPlan, shortestPlan, slopeBand } from '../src/finder/route-options.js';
import { planMission } from '../src/finder/planner.js';

const setBit = (mask, stride, step, cell, v = 1) => {
  const i = step * stride + (cell >> 3);
  if (v) mask[i] |= 1 << (cell & 7);
  else mask[i] &= ~(1 << (cell & 7));
};

/** A flat, fully sunlit square of n by n cells of 100 m, with one-hour steps (as in finder-planner.test.js). */
function fake({ steps = 72, n = 7 } = {}) {
  const size = n * n;
  const stride = Math.ceil(size / 8);
  const r = {
    n,
    cellM: 100,
    elevation: new Float32Array(size),
    slope: new Float32Array(size),
    fail: new Uint8Array(size),
    steps,
    stepHours: 1,
    windowHours: steps - 1,
    maskStride: stride,
    sunMask: new Uint8Array(steps * stride).fill(255),
    earthMask: new Uint8Array(steps * stride).fill(255),
  };
  r.cell = (row, col) => row * n + col;
  r.dark = (row, col, from, to) => {
    for (let s = from; s <= Math.min(to, steps - 1); s++) setBit(r.sunMask, stride, s, r.cell(row, col), 0);
  };
  return r;
}
const rover = { maxSlopeDeg: 15, rangeM: 1e9, speedMPerHour: 100, maxDarknessHours: 20 };
const at = (row, col) => ({ row, col });

describe('slope bands', () => {
  it('puts slopes in the agreed bands: under 10, 10 to 15, 15 to 20, over 20', () => {
    expect(slopeBand(3).id).toBe('easy');
    expect(slopeBand(10).id).toBe('moderate');
    expect(slopeBand(14.9).id).toBe('moderate');
    expect(slopeBand(17).id).toBe('steep');
    expect(slopeBand(25).id).toBe('too-steep');
  });
});

describe('routeOptions', () => {
  it('on flat sunlit ground all three agree, and the safest keeps the darkness margin', () => {
    const r = fake();
    const o = routeOptions(r, at(3, 0), [at(3, 6)], rover);
    expect(o.fastest.summary.ok).toBe(true);
    expect(o.safest.summary.ok).toBe(true);
    expect(o.shortest.summary.ok).toBe(true);
    expect(o.safest.sameAs).toBe('fastest');
    expect(o.safest.limits.margin).toBe(true);
    expect(o.safest.limits.maxDarknessHours).toBeCloseTo(rover.maxDarknessHours * (1 - DARK_MARGIN), 6);
    expect(o.shortest.summary.distanceM).toBeCloseTo(600, 3);
  });

  it('the safest route goes round a band of 13° ground that the fastest drives straight over', () => {
    const r = fake();
    for (let row = 1; row <= 5; row++) r.slope[r.cell(row, 3)] = 13; // a ridge across the middle, open at rows 0 and 6
    const o = routeOptions(r, at(3, 0), [at(3, 6)], rover);
    expect(o.fastest.summary.steepestDeg).toBe(13);
    expect(o.safest.summary.ok).toBe(true);
    expect(o.safest.summary.steepestDeg).toBeLessThan(10);
    expect(o.safest.limits.maxSlopeDeg).toBe(10);
    expect(o.safest.summary.distanceM).toBeGreaterThan(o.fastest.summary.distanceM);
    expect(o.safest.sameAs).toBe(undefined);
  });

  it('the shortest route drives into a long shadow and is lost; the planner goes round it', () => {
    const r = fake();
    r.dark(3, 3, 2, 60); // the middle of the straight line is dark for most of the mission
    const o = routeOptions(r, at(3, 0), [at(3, 6)], rover);
    expect(o.shortest.summary.survived).toBe(false);
    expect(o.shortest.plan.ok).toBe(false);
    expect(o.fastest.summary.ok).toBe(true);
    expect(o.fastest.plan.path).not.toContain(r.cell(3, 3));
  });

  it('the safest route loosens step by step and reports which limits it used', () => {
    const r = fake();
    for (let row = 0; row < 7; row++) r.slope[r.cell(row, 3)] = 11; // no way round: 11° everywhere in column 3
    const safe = safestPlan(r, at(3, 0), [at(3, 6)], rover);
    expect(safe.limits.maxSlopeDeg).toBe(12);
    expect(safe.plan.ok).toBe(true);
  });

  it('never picks a safest plan with more darkness than a baseline that keeps to the same limits', () => {
    const r = fake();
    r.dark(3, 3, 2, 12); // a passing shadow on the straight line: waiting it out or going round both work
    const fastest = planMission(r, at(3, 0), [at(3, 6)], rover);
    const safe = safestPlan(r, at(3, 0), [at(3, 6)], rover, fastest);
    expect(safe.plan.ok).toBe(true);
    if (fastest.path.every((c) => r.slope[c] <= safe.limits.maxSlopeDeg) && fastest.drive.longestDarkH <= safe.limits.maxDarknessHours) {
      expect(safe.plan.drive.longestDarkH).toBeLessThanOrEqual(fastest.drive.longestDarkH);
    }
  });

  it('gives no safest route when even the rover limits fail', () => {
    const r = fake();
    for (let row = 0; row < 7; row++) r.slope[r.cell(row, 3)] = 30;
    const o = routeOptions(r, at(3, 0), [at(3, 6)], rover);
    expect(o.safest).toBe(null);
    expect(o.shortest).toBe(null);
  });
});

describe('shortestPlan and routeSummary', () => {
  it('visits the destinations in the given order and records each arrival', () => {
    const r = fake();
    const plan = shortestPlan(r, at(0, 0), [at(0, 3), at(0, 6)], rover, [0, 1]);
    expect(plan.ok).toBe(true);
    expect(plan.stops.map((s) => s.destination)).toEqual([0, 1]);
    expect(plan.stops[0].arrivalHours).toBeLessThan(plan.stops[1].arrivalHours);
    expect(plan.distanceM).toBeCloseTo(600, 3);
  });

  it('splits the distance into slope bands that add up to the whole drive', () => {
    const r = fake();
    r.slope[r.cell(3, 2)] = 12;
    r.slope[r.cell(3, 4)] = 17;
    const plan = planMission(r, at(3, 0), [at(3, 6)], { ...rover, maxSlopeDeg: 20 });
    const s = routeSummary(r, plan, rover);
    const total = Object.values(s.bandM).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(s.distanceM, 6);
    expect(s.steepestDeg).toBe(17);
    expect(s.darkSpareH).toBe(rover.maxDarknessHours - plan.drive.longestDarkH);
    expect(s.earthFraction).toBe(1);
  });
});
