import { describe, expect, it } from 'vitest';
import { FAIL } from '../src/finder/score.js';
import { pathStats, pathTo, reachFrom } from '../src/finder/route.js';

function fake(n = 10) {
  const size = n * n;
  const fill = (v) => new Float32Array(size).fill(v);
  return { n, cellM: 100, elevation: fill(0), slope: fill(0), fail: new Uint8Array(size), sunFraction: fill(0.5), longestDarkH: fill(10), earthFraction: fill(0.5) };
}
const opts = { maxSlopeDeg: 15, rangeM: 1e9 };

describe('reachFrom / pathTo', () => {
  it('measures straight-line distance on flat ground', () => {
    const r = fake();
    const reach = reachFrom(r, { row: 5, col: 1 }, opts);
    expect(reach.dist[5 * 10 + 6]).toBeCloseTo(500, 3);
    const d = reachFrom(r, { row: 1, col: 1 }, opts);
    expect(d.dist[4 * 10 + 4]).toBeCloseTo(300 * Math.SQRT2, 2);
    expect(d.dist[1 * 10 + 1]).toBe(0);
  });

  it('detours through a gap in a steep wall and avoids every steep cell', () => {
    const r = fake(11);
    for (let row = 0; row < 11; row++) if (row !== 8) r.slope[row * 11 + 5] = 30;
    const reach = reachFrom(r, { row: 2, col: 1 }, opts);
    const path = pathTo(reach, { row: 2, col: 9 });
    expect(path).not.toBeNull();
    for (const i of path) expect(r.slope[i]).toBeLessThanOrEqual(15);
    expect(reach.dist[2 * 11 + 9]).toBeGreaterThan(800);
    expect(path).toContain(8 * 11 + 5);
  });

  it('does not cut corners between two diagonal obstacles', () => {
    const r = fake();
    // Obstacles at (4,5) and (5,4): a diagonal step (4,4) -> (5,5) would squeeze between them.
    r.slope[4 * 10 + 5] = 30;
    r.slope[5 * 10 + 4] = 30;
    const reach = reachFrom(r, { row: 4, col: 4 }, opts);
    expect(reach.prev[5 * 10 + 5]).not.toBe(4 * 10 + 4);
    expect(reach.dist[5 * 10 + 5]).toBeGreaterThan(100 * Math.SQRT2 + 1);
  });

  it('stops at rangeM', () => {
    const r = fake();
    const reach = reachFrom(r, { row: 5, col: 0 }, { maxSlopeDeg: 15, rangeM: 350 });
    expect(reach.dist[5 * 10 + 3]).toBeCloseTo(300, 3);
    expect(reach.dist[5 * 10 + 4]).toBe(Infinity);
    expect(reach.prev[5 * 10 + 4]).toBe(-1);
    expect(pathTo(reach, { row: 5, col: 8 })).toBeNull();
  });

  it('treats OUTSIDE and NaN-elevation cells as undrivable', () => {
    const r = fake();
    for (let row = 0; row < 10; row++) r.fail[row * 10 + 5] = FAIL.OUTSIDE;
    const a = reachFrom(r, { row: 5, col: 1 }, opts);
    expect(a.dist[5 * 10 + 5]).toBe(Infinity);
    expect(a.dist[5 * 10 + 8]).toBe(Infinity);
    const r2 = fake();
    for (let row = 0; row < 10; row++) r2.elevation[row * 10 + 5] = NaN;
    expect(reachFrom(r2, { row: 5, col: 1 }, opts).dist[5 * 10 + 8]).toBe(Infinity);
  });

  it('reaches nothing from an undrivable start', () => {
    const r = fake();
    r.slope[5 * 10 + 5] = 40;
    const reach = reachFrom(r, { row: 5, col: 5 }, opts);
    expect(reach.dist.every((v) => v === Infinity)).toBe(true);
    expect(pathTo(reach, { row: 5, col: 6 })).toBeNull();
  });

  it('returns the path from start to target inclusive', () => {
    const r = fake();
    const reach = reachFrom(r, { row: 5, col: 1 }, opts);
    const path = pathTo(reach, { row: 5, col: 4 });
    expect(path).toEqual([51, 52, 53, 54]);
    expect(pathTo(reach, { row: 5, col: 1 })).toEqual([51]);
  });

  it('handles a 400 x 400 flat grid in under a second', () => {
    const r = fake(400);
    const t0 = performance.now();
    const reach = reachFrom(r, { row: 200, col: 200 }, { maxSlopeDeg: 15, rangeM: 1e9 });
    const ms = performance.now() - t0;
    console.log(`400x400 reachFrom: ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
    expect(Number.isFinite(reach.dist[0])).toBe(true);
  });
});

describe('pathStats', () => {
  it('sums distance, climb and descent and takes extremes along the path', () => {
    const r = fake();
    r.elevation[5 * 10 + 2] = 30;
    r.elevation[5 * 10 + 3] = 40;
    r.elevation[5 * 10 + 4] = 10;
    r.slope[5 * 10 + 3] = 12;
    r.longestDarkH[5 * 10 + 2] = 33;
    r.sunFraction[5 * 10 + 4] = 0.2;
    r.earthFraction[5 * 10 + 1] = 0.1;
    const path = [51, 52, 53, 54];
    const s = pathStats(r, path, { speedMPerHour: 200 });
    const expected = Math.hypot(100, 30) + Math.hypot(100, 10) + Math.hypot(100, 30);
    expect(s.distanceM).toBeCloseTo(expected, 3);
    expect(s.hours).toBeCloseTo(s.distanceM / 200, 6);
    expect(s.climbM).toBeCloseTo(40);
    expect(s.descentM).toBeCloseTo(30);
    expect(s.steepestDeg).toBe(12);
    expect(s.longestDarkH).toBe(33);
    expect(s.minSunFraction).toBeCloseTo(0.2);
    expect(s.minEarthFraction).toBeCloseTo(0.1);
  });
});

describe('reach with no range limit', () => {
  it('reaches every drivable cell and reports the farthest drive', async () => {
    const { layerPixel, reachScaleM } = await import('../src/finder/map-layers.js');
    const n = 6;
    const r = {
      n,
      cellM: 100,
      elevation: new Float32Array(n * n),
      slope: new Float32Array(n * n).fill(2),
      fail: new Uint8Array(n * n),
    };
    const reach = reachFrom(r, { row: 0, col: 0 }, { maxSlopeDeg: 15, rangeM: Infinity });
    expect([...reach.dist].every(Number.isFinite)).toBe(true);
    expect(reach.farthestM).toBeCloseTo(5 * 100 * Math.SQRT2, 3); // the far corner, on the diagonal
    expect(reachScaleM(reach)).toBe(reach.farthestM);
    // The start is drawn lightest and the far corner darkest, as with a range.
    const sum = (rgb) => rgb[0] + rgb[1] + rgb[2];
    expect(sum(layerPixel('reach', r, 0, 100, { reach }))).toBeGreaterThan(sum(layerPixel('reach', r, n * n - 1, 100, { reach })));
  });
});
