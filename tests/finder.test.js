import { describe, expect, it } from 'vitest';
import { cellOffset, cellToLatLon, latLonToCell, searchGrid } from '../src/finder/grid.js';
import { FAIL, cellScore, describeFail, pickSites } from '../src/finder/score.js';
import { decodeRasters, encodeRasters } from '../src/finder/wire.js';
import { searchLanding } from '../server/landing-search.mjs';

describe('finder grid', () => {
  it('sizes the raster from the radius', () => {
    expect(searchGrid(10)).toMatchObject({ n: 250, cellM: 80 });
    expect(searchGrid(20)).toMatchObject({ n: 400, cellM: 100 });
    expect(searchGrid(40)).toMatchObject({ n: 400, cellM: 200 });
  });
  it('puts row 0 / col 0 at the north-west corner', () => {
    const g = searchGrid(10);
    const nw = cellOffset(g, 0, 0);
    expect(nw.east).toBeCloseTo(-g.halfSizeM + g.cellM / 2);
    expect(nw.north).toBeCloseTo(g.halfSizeM - g.cellM / 2);
    const se = cellOffset(g, g.n - 1, g.n - 1);
    expect(se.east).toBeGreaterThan(0);
    expect(se.north).toBeLessThan(0);
  });
  it.each([
    [{ lat: -89.45, lon: -137.31 }],
    [{ lat: -89.95, lon: 20 }], // raster straddles the pole
  ])('round-trips cells through latitude/longitude around %j', (center) => {
    const g = searchGrid(10);
    for (const [row, col] of [[0, 0], [0, 249], [249, 0], [249, 249], [125, 125], [17, 200], [200, 33], [124, 126]]) {
      const { lat, lon } = cellToLatLon(g, center, row, col);
      expect(latLonToCell(g, center, lat, lon)).toEqual({ row, col });
    }
  });
});

describe('finder wire format', () => {
  it('round-trips rasters of different types and lengths', () => {
    const f = new Float32Array([1.5, NaN, -3, 0]);
    const u8 = new Uint8Array([1, 2, 3, 4, 5]);
    const u16 = new Uint16Array([0, 65535, 300]);
    const header = { n: 2, name: 'x', nested: { a: [1, 2] } };
    const bytes = encodeRasters(header, { f, u8, u16 });
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const out = decodeRasters(buffer);
    expect(out.header).toEqual(header);
    expect(out.rasters.f).toBeInstanceOf(Float32Array);
    expect(Array.from(out.rasters.f)).toEqual([1.5, NaN, -3, 0]);
    expect(Array.from(out.rasters.u8)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(out.rasters.u16)).toEqual([0, 65535, 300]);
  });
});

describe('finder score', () => {
  it('describes failures', () => {
    expect(describeFail(0)).toEqual([]);
    expect(describeFail(FAIL.SLOPE)).toHaveLength(1);
    expect(describeFail(FAIL.NO_EARTH_AT_LANDING)[0]).toMatch(/Earth/);
    expect(describeFail(FAIL.OUTSIDE)[0]).toMatch(/outside/);
    expect(describeFail(FAIL.SLOPE + FAIL.DARK_TOO_LONG)).toHaveLength(2);
    expect(describeFail(31)).toHaveLength(5);
  });
  it('scores extremes and weights', () => {
    const w = { sunlight: 1, earthComms: 0.7 };
    expect(cellScore(100, 100, 1, w)).toBeCloseTo(1);
    expect(cellScore(0, 100, 0, w)).toBe(0);
    expect(cellScore(50, 100, 0, { sunlight: 1, earthComms: 0 })).toBeCloseTo(0.5);
    expect(cellScore(0, 100, 1, { sunlight: 1, earthComms: 1 })).toBeCloseTo(0.5);
    expect(cellScore(0, 100, 1, { sunlight: 0, earthComms: 0 })).toBe(0);
    expect(cellScore(200, 100, 0, { sunlight: 1, earthComms: 0 })).toBe(1); // capped
  });
  it('picks sites in score order, spaced apart, ties to the gentler ellipse', () => {
    const n = 10;
    const cellM = 100;
    const score = new Float32Array(n * n).fill(NaN);
    const ellipseSlope = new Float32Array(n * n).fill(5);
    const at = (r, c) => r * n + c;
    score[at(0, 0)] = 0.9;
    score[at(0, 1)] = 0.8; // 100 m from the best: too close
    score[at(0, 5)] = 0.7;
    score[at(5, 5)] = 0.5;
    score[at(9, 9)] = 0.5;
    ellipseSlope[at(9, 9)] = 1; // same score as (5,5), gentler
    const sites = pickSites({ n, cellM, score, ellipseSlope }, { count: 10, minSeparationM: 300 });
    expect(sites.map((s) => s.index)).toEqual([at(0, 0), at(0, 5), at(9, 9), at(5, 5)]);
    for (let i = 0; i < sites.length; i++)
      for (let j = i + 1; j < sites.length; j++) expect(Math.hypot(sites[i].row - sites[j].row, sites[i].col - sites[j].col) * cellM).toBeGreaterThanOrEqual(300);
    expect(pickSites({ n, cellM, score, ellipseSlope }, { count: 2, minSeparationM: 300 })).toHaveLength(2);
  });
});

describe('searchLanding on a perfectly smooth Moon', () => {
  const dem = {
    id: 'flat',
    label: {
      lines: 1400, samples: 1400, sampleBits: 16, sampleType: 'LSB_INTEGER', scalingFactor: 0.5, radiusM: 1737400,
      projection: 'POLAR STEREOGRAPHIC', centerLat: -90, centerLon: 0, scaleM: 400, edgeLat: -80, lineOffset: 699.5, sampleOffset: 699.5,
    },
    data: new Int16Array(1400 * 1400),
  };
  const result = searchLanding(dem, {
    center: { lat: -89.9, lon: 0 },
    radiusKm: 10,
    start: '2026-11-14T19:00:00Z',
    durationHours: 48,
    stepMinutes: 120,
    ellipseRadiusM: 200,
  });

  it('fills every raster', () => {
    expect(result).not.toBeNull();
    const { header, rasters } = result;
    for (const name of ['elevation', 'slope', 'ellipseSlope', 'sunFraction', 'longestLitH', 'longestDarkH', 'earthFraction', 'fail', 'score'])
      expect(rasters[name]).toHaveLength(header.n * header.n);
  });
  it('is flat, evenly lit inside the circle, and marks the outside', () => {
    const { header, rasters } = result;
    const { n, cellM, halfSizeM } = header;
    const g = { n, cellM, halfSizeM };
    let minSun = Infinity, maxSun = -Infinity, minEarth = Infinity, maxEarth = -Infinity;
    let inside = 0;
    let outsideWithout = 0;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const c = row * n + col;
        const { east, north } = cellOffset(g, row, col);
        const isInside = Math.hypot(east, north) <= 10_000;
        if (!isInside) {
          if (!(rasters.fail[c] & FAIL.OUTSIDE)) outsideWithout++;
          continue;
        }
        inside++;
        expect(rasters.slope[c]).toBeCloseTo(0, 3);
        expect(rasters.fail[c] & FAIL.SLOPE).toBe(0);
        minSun = Math.min(minSun, rasters.sunFraction[c]);
        maxSun = Math.max(maxSun, rasters.sunFraction[c]);
        minEarth = Math.min(minEarth, rasters.earthFraction[c]);
        maxEarth = Math.max(maxEarth, rasters.earthFraction[c]);
      }
    }
    expect(outsideWithout).toBe(0);
    const tolerance = 2 / header.steps;
    expect(maxSun - minSun).toBeLessThanOrEqual(tolerance);
    expect(maxEarth - minEarth).toBeLessThanOrEqual(tolerance);
    expect(header.counts.evaluated).toBe(inside);
    expect(header.counts.passing).toBeLessThanOrEqual(inside);
  });
  it('only returns sites that pass', () => {
    const { header, rasters } = result;
    for (const s of header.sites) expect(rasters.fail[s.row * header.n + s.col]).toBe(0);
  });
});
