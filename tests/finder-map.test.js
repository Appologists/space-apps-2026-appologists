import { describe, expect, it } from 'vitest';
import { FAIL } from '../src/finder/score.js';
import { MAP_LAYERS, describeCell, hillshade, layerLegend, layerPixel } from '../src/finder/map-layers.js';
import { SLOPE_MAX_DEG } from '../src/surface/lenses.js';

const n = 8;
function fakeResult() {
  const size = n * n;
  const fill = (v) => new Float32Array(size).fill(v);
  return {
    n,
    cellM: 100,
    halfSizeM: (n * 100) / 2,
    center: { lat: -89, lon: 0 },
    radiusKm: 0.4,
    windowHours: 100,
    params: { maxDarknessHours: 50 },
    sites: [],
    elevation: fill(0),
    slope: fill(5),
    ellipseSlope: fill(5),
    sunFraction: fill(0.5),
    longestLitH: fill(10),
    longestDarkH: fill(20),
    earthFraction: fill(0.5),
    fail: new Uint8Array(size),
    score: fill(0.5),
  };
}

describe('hillshade', () => {
  it('is uniform on flat ground', () => {
    const s = hillshade(new Float32Array(n * n), n, 100);
    expect(new Set(s).size).toBe(1);
  });
  it('is brighter on north-west-facing ground than south-east-facing', () => {
    const nw = new Float32Array(n * n); // falls toward the north-west
    const se = new Float32Array(n * n); // falls toward the south-east
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        nw[r * n + c] = (c + r) * 20;
        se[r * n + c] = -(c + r) * 20;
      }
    }
    const a = hillshade(nw, n, 100)[3 * n + 3];
    const b = hillshade(se, n, 100)[3 * n + 3];
    expect(a).toBeGreaterThan(b);
  });
  it('gives 0 for no data', () => {
    const e = new Float32Array(n * n).fill(NaN);
    expect(hillshade(e, n, 100)[0]).toBe(0);
  });
});

describe('layerPixel', () => {
  it('uses the background outside the search area on every layer', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.OUTSIDE;
    r.elevation[1] = NaN;
    for (const { id } of MAP_LAYERS) {
      expect(layerPixel(id, r, 0, 100)).toEqual([6, 8, 12]);
      expect(layerPixel(id, r, 1, 100)).toEqual([6, 8, 12]);
    }
  });
  it('draws failing result cells grey and passing cells blue, lighter for higher scores', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.SLOPE;
    const [gr, gg, gb] = layerPixel('result', r, 0, 128);
    expect(gr).toBe(gg);
    expect(gg).toBe(gb);
    r.score[1] = 0.1;
    r.score[2] = 0.9;
    const low = layerPixel('result', r, 1, 0);
    const high = layerPixel('result', r, 2, 0);
    expect(low[2]).toBeGreaterThan(low[0]);
    expect(high[0] + high[1] + high[2]).toBeGreaterThan(low[0] + low[1] + low[2]);
  });
  it('marks never-sunlit and never-Earth-visible ground near-black', () => {
    const r = fakeResult();
    r.sunFraction[0] = 0;
    r.earthFraction[0] = 0;
    expect(layerPixel('sun', r, 0, 0)).toEqual([16, 16, 20]);
    expect(layerPixel('earth', r, 0, 0)).toEqual([16, 16, 20]);
  });
  it('clamps slope at SLOPE_MAX_DEG', () => {
    const r = fakeResult();
    r.slope[0] = SLOPE_MAX_DEG;
    r.slope[1] = SLOPE_MAX_DEG * 3;
    expect(layerPixel('slope', r, 1, 0)).toEqual(layerPixel('slope', r, 0, 0));
  });
  it('makes long darkness darker than short darkness', () => {
    const r = fakeResult();
    r.longestDarkH[0] = 100;
    r.longestDarkH[1] = 0;
    const sum = (p) => p[0] + p[1] + p[2];
    expect(sum(layerPixel('dark', r, 0, 0))).toBeLessThan(sum(layerPixel('dark', r, 1, 0)));
  });
});

describe('layerLegend', () => {
  it('has a title and at least two labelled stops for every layer', () => {
    const r = fakeResult();
    for (const { id } of MAP_LAYERS) {
      const l = layerLegend(id, r);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.note.length).toBeGreaterThan(0);
      expect(l.stops.filter((s) => s.label).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('describeCell', () => {
  it('lists the failure reasons', () => {
    const r = fakeResult();
    r.fail[3 * n + 3] = FAIL.SLOPE | FAIL.DARK_TOO_LONG;
    const text = describeCell(r, 3, 3);
    expect(text).toContain('fails: ground too steep');
    expect(text).toContain('darkness lasts too long');
  });
  it('says a passing cell passes', () => {
    expect(describeCell(fakeResult(), 3, 3)).toContain('passes every check');
  });
  it('says outside cells are outside', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.OUTSIDE;
    expect(describeCell(r, 0, 0)).toBe('outside the search area');
  });
});

describe('reach layer', () => {
  const reachFor = (r, dists, rangeM = 1000) => {
    const dist = new Float32Array(r.n * r.n).fill(Infinity);
    for (const [i, d] of Object.entries(dists)) dist[i] = d;
    return { dist, rangeM, maxSlopeDeg: 15 };
  };
  const sum = (p) => p[0] + p[1] + p[2];
  it('is registered as the last layer', () => {
    expect(MAP_LAYERS.at(-1)).toEqual({ id: 'reach', label: 'Reach' });
  });
  it('draws reachable cells blue, lighter when nearer, and others grey', () => {
    const r = fakeResult();
    const reach = reachFor(r, { 0: 100, 1: 900 });
    const near = layerPixel('reach', r, 0, 100, { reach });
    const far = layerPixel('reach', r, 1, 100, { reach });
    expect(near[2]).toBeGreaterThan(near[0]);
    expect(sum(near)).toBeGreaterThan(sum(far));
    const grey = layerPixel('reach', r, 2, 100, { reach });
    expect(grey[0]).toBe(grey[1]);
    expect(grey[1]).toBe(grey[2]);
    const none = layerPixel('reach', r, 0, 100);
    expect(none[0]).toBe(none[1]);
  });
  it('keeps the background outside the search area', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.OUTSIDE;
    expect(layerPixel('reach', r, 0, 0, { reach: reachFor(r, { 0: 10 }) })).toEqual([6, 8, 12]);
  });
  it('has legend labels for the range and the grey swatch', () => {
    const r = fakeResult();
    const l = layerLegend('reach', r, { reach: reachFor(r, {}, 5000) });
    const labels = l.stops.filter((s) => s.label).map((s) => s.label);
    expect(labels).toEqual(['5 km', '0 km']);
    expect(l.swatches[0].label).toBe('too steep or out of range');
    expect(l.note).toContain('15°');
    expect(layerLegend('reach', r).note).toContain('No reach data yet');
  });
  it('adds the drive distance to the cell description', () => {
    const r = fakeResult();
    const reach = reachFor(r, { [3 * n + 3]: 1234 });
    expect(describeCell(r, 3, 3, { reach })).toContain(' · 1.2 km drive from the start');
    expect(describeCell(r, 3, 4, { reach })).toContain(' · not reachable from the start');
    expect(describeCell(r, 3, 3)).not.toContain('start');
  });
});
