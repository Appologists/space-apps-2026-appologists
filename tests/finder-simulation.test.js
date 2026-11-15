import { describe, expect, it } from 'vitest';
import { frameAt, keySteps, prepareSimulation } from '../src/finder/simulation.js';
import { planMission } from '../src/finder/planner.js';
import { shortestPlan } from '../src/finder/route-options.js';
import { STATE } from '../src/finder/schedule.js';

const setBit = (mask, stride, step, cell, v = 1) => {
  const i = step * stride + (cell >> 3);
  if (v) mask[i] |= 1 << (cell & 7);
  else mask[i] &= ~(1 << (cell & 7));
};
function fake({ steps = 48, n = 7 } = {}) {
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
const rover = { maxSlopeDeg: 15, rangeM: 1e9, speedMPerHour: 50, maxDarknessHours: 10 };
const at = (row, col) => ({ row, col });

describe('simulation frames', () => {
  it('moves the rover smoothly along the route and ends at the destination', () => {
    const r = fake();
    const plan = planMission(r, at(3, 0), [at(3, 6)], rover); // 600 m at 50 m/h: 12 hours
    const sim = prepareSimulation(r, plan);
    const start = frameAt(sim, 0);
    expect(start.row).toBe(3);
    expect(start.col).toBeGreaterThan(0); // after the first hour it has moved 50 m: half a cell
    expect(start.col).toBeCloseTo(0.5, 6);
    expect(start.state).toBe(STATE.DRIVING);
    const end = frameAt(sim, 47);
    expect(end.col).toBe(6);
    expect(end.state).toBe(STATE.ARRIVED);
    expect(end.reached).toEqual([0]);
  });

  it('counts the time in the dark and shows the rover lost', () => {
    const r = fake();
    for (let row = 0; row < 7; row++) if (row !== 3) for (let col = 0; col < 7; col++) r.slope[r.cell(row, col)] = 30;
    r.dark(3, 2, 3, 47); // the rover reaches column 2 at 4 h; it is dark there from 3 h to the end
    const plan = shortestPlan(r, at(3, 0), [at(3, 6)], rover, [0]);
    const sim = prepareSimulation(r, plan);
    const lostStep = sim.plan.drive.timeline.indexOf(STATE.LOST);
    expect(lostStep).toBeGreaterThan(0);
    const f = frameAt(sim, lostStep);
    expect(f.state).toBe(STATE.LOST);
    expect(f.lit).toBe(false);
    expect(f.darkRunH).toBeGreaterThan(rover.maxDarknessHours);
  });

  it('lists the steps where the rover changes what it is doing', () => {
    const r = fake();
    const plan = planMission(r, at(3, 0), [at(3, 6)], rover);
    const keys = keySteps(prepareSimulation(r, plan));
    expect(keys[0]).toBe(0);
    expect(keys.length).toBe(2); // driving, then arrived
  });

  it('returns nothing for a plan without a route', () => {
    expect(prepareSimulation(fake(), { path: null, drive: null })).toBe(null);
  });
});
