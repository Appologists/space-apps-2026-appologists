import { describe, expect, it } from 'vitest';
import { whyNot } from '../src/finder/why-not.js';
import { planMission } from '../src/finder/planner.js';
import { shortestPlan } from '../src/finder/route-options.js';

const setBit = (mask, stride, step, cell, v = 1) => {
  const i = step * stride + (cell >> 3);
  if (v) mask[i] |= 1 << (cell & 7);
  else mask[i] &= ~(1 << (cell & 7));
};
function fake({ steps = 72, n = 7 } = {}) {
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
const ask = (r, start, targets, limits = rover) => {
  const fastest = planMission(r, start, targets, limits);
  return whyNot(r, start, targets, limits, fastest, null);
};

describe('whyNot', () => {
  it('says nothing when the drive works', () => {
    expect(ask(fake(), at(3, 0), [at(3, 6)])).toBe(null);
  });

  it('marks a destination on ground that is too steep, with its slope', () => {
    const r = fake();
    r.slope[r.cell(3, 6)] = 22;
    const why = ask(r, at(3, 0), [at(3, 6)]);
    expect(why.problems[0].text).toContain('22°');
    expect(why.problems[0].layer).toBe('slope');
    expect(why.marks).toEqual([{ row: 3, col: 6, kind: 'steep', label: '!' }]);
  });

  it('marks a destination walled in by steep ground', () => {
    const r = fake();
    for (let row = 0; row < 7; row++) r.slope[r.cell(row, 4)] = 30;
    const why = ask(r, at(3, 0), [at(3, 6)]);
    expect(why.marks[0].kind).toBe('walled');
    expect(why.problems[0].layer).toBe('reach');
  });

  it('marks a destination beyond range', () => {
    const why = ask(fake(), at(3, 0), [at(3, 6)], { ...rover, rangeM: 300 });
    expect(why.marks[0].kind).toBe('far');
  });

  it('has nothing to say when the destination goes dark after the rover gets there (decision U)', () => {
    const r = fake();
    r.dark(3, 6, 20, 71);
    expect(ask(r, at(3, 0), [at(3, 6)])).toBe(null);
  });

  it('with the old rule, says when the rover gets there but the spot stays dark too long', () => {
    const r = fake();
    r.dark(3, 6, 20, 71);
    const why = ask(r, at(3, 0), [at(3, 6)], { ...rover, surviveAfterArrival: true });
    expect(why.title).toContain('does not survive');
    expect(why.marks.some((m) => m.kind === 'dark' && m.row === 3 && m.col === 6)).toBe(true);
  });

  it('marks where the sunlight-blind shortest route gets lost', () => {
    const r = fake();
    for (let row = 0; row < 7; row++) if (row !== 3) for (let col = 0; col < 7; col++) r.slope[r.cell(row, col)] = 30; // one corridor
    r.dark(3, 3, 2, 71); // dark for the rest of the mission: no way past
    const fastest = planMission(r, at(3, 0), [at(3, 6)], rover);
    const shortest = shortestPlan(r, at(3, 0), [at(3, 6)], rover, [0]);
    const why = whyNot(r, at(3, 0), [at(3, 6)], rover, fastest, shortest);
    expect(why).not.toBe(null);
    const lost = why.marks.find((m) => m.kind === 'lost');
    expect(lost).toEqual({ row: 3, col: 3, kind: 'lost', label: '✕' });
  });
});
