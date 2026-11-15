import { describe, expect, it } from 'vitest';
import { SLOPE_BANDS } from '../src/finder/slope-bands.js';
import { FAIL } from '../src/finder/score.js';
import { ALL_LAYER, ALL_SCALE, MAP_LAYERS, allPictures, allPixel, composeAll, describeCell, hillshade, layerLegend, layerPixel } from '../src/finder/map-layers.js';
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
  it('uses the background where there is no terrain data, on every layer', () => {
    const r = fakeResult();
    r.elevation[1] = NaN;
    for (const { id } of MAP_LAYERS) expect(layerPixel(id, r, 1, 100)).toEqual([6, 8, 12]);
  });
  it('outside the search circle: dim relief for the landing verdict and reach, measured colours for the rest', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.OUTSIDE;
    r.fail[1] = FAIL.SLOPE;
    const notChecked = layerPixel('result', r, 0, 128);
    const failing = layerPixel('result', r, 1, 128);
    expect(notChecked[0]).toBe(notChecked[2]);
    expect(notChecked[0]).toBeLessThan(failing[0]); // darker than ground that fails a check
    expect(layerPixel('reach', r, 0, 128)).toEqual(notChecked);
    for (const id of ['sun', 'dark', 'earth', 'slope']) expect(layerPixel(id, r, 0, 128)).toEqual(layerPixel(id, r, 2, 128));
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
  it('colours slope by the route\'s bands: one colour per band, shaded only in brightness', () => {
    const r = fakeResult();
    r.slope[0] = 5;
    r.slope[1] = 8;
    r.slope[2] = 25;
    expect(layerPixel('slope', r, 0, 255)).toEqual(layerPixel('slope', r, 1, 255)); // same band
    expect(layerPixel('slope', r, 0, 255)).not.toEqual(layerPixel('slope', r, 2, 255)); // under 10° vs over 20°
    const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    expect(hex(layerPixel('slope', r, 0, 255))).toBe(SLOPE_BANDS[0].hex); // full light: the band's own colour
    const dim = layerPixel('slope', r, 0, 0);
    expect(dim[0] / dim[1]).toBeCloseTo(0x7b / 0xd8, 1); // darker, same hue
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
  it('has a title and at least two labelled stops or swatches for every layer', () => {
    const r = fakeResult();
    for (const { id } of MAP_LAYERS) {
      const l = layerLegend(id, r);
      expect(l.title.length).toBeGreaterThan(0);
      expect(l.note.length).toBeGreaterThan(0);
      const labelled = l.stops.filter((s) => s.label).length || (l.swatches ?? []).filter((s) => s.label).length;
      expect(labelled, id).toBeGreaterThanOrEqual(2);
    }
  });

  it('keys the Slope view with the route\'s four bands', () => {
    const l = layerLegend('slope', fakeResult());
    expect(l.swatches.map((s) => s.hex)).toEqual(SLOPE_BANDS.map((b) => b.hex));
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
  it('says outside cells were not checked for landing, and still gives what was measured there', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.OUTSIDE;
    expect(describeCell(r, 0, 0)).toMatch(/not checked for landing/);
    expect(describeCell(r, 0, 0)).toMatch(/sunlit 50%/);
    r.elevation[0] = NaN;
    expect(describeCell(r, 0, 0)).toBe('no terrain data here');
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
  it('draws ground outside the search area as dim relief, not as reachable', () => {
    const r = fakeResult();
    r.fail[0] = FAIL.OUTSIDE;
    expect(layerPixel('reach', r, 0, 0, { reach: reachFor(r, { 0: 10 }) })).toEqual(layerPixel('result', r, 0, 0));
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

describe('the one map (All)', () => {
  const brightness = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  it('leaves ground under 10 degrees a plain grey, lighter in sunlight than in shadow', () => {
    for (const shade of [0, 120, 255]) {
      const lit = allPixel(1, shade, 5, false);
      const dark = allPixel(0, shade, 5, false);
      expect(lit[0]).toBe(lit[1]);
      expect(dark[0]).toBe(dark[1]);
      expect(brightness(lit)).toBeGreaterThan(brightness(dark) + 50);
    }
  });

  it('colours steeper ground with its slope band, in sunlight and in shadow', () => {
    for (const band of SLOPE_BANDS.slice(1)) {
      const deg = band.maxDeg === Infinity ? 40 : band.maxDeg - 1;
      const rgb = [1, 3, 5].map((i) => parseInt(band.hex.slice(i, i + 2), 16));
      for (const light of [0, 1]) {
        const got = allPixel(light, 255, deg, false);
        // The same hue as the band: the channels keep the band's proportions (to rounding).
        const k = got[0] / rgb[0];
        expect(Math.abs(got[1] - rgb[1] * k)).toBeLessThanOrEqual(1);
        expect(Math.abs(got[2] - rgb[2] * k)).toBeLessThanOrEqual(1);
      }
      expect(allPixel(1, 255, deg, false)).toEqual(rgb); // full strength on the brightest relief
    }
  });

  it('keeps every piece of shadowed ground darker than every piece of sunlit ground', () => {
    let darkestLit = Infinity;
    let lightestDark = 0;
    for (const deg of [0, 9.9, 12, 17, 30]) {
      for (const shade of [0, 128, 255]) {
        for (const landing of [false, true]) {
          if (landing && deg >= 10) continue; // landing ground is never that steep
          darkestLit = Math.min(darkestLit, brightness(allPixel(1, shade, deg, landing)));
          lightestDark = Math.max(lightestDark, brightness(allPixel(0, shade, deg, landing)));
        }
      }
    }
    expect(darkestLit).toBeGreaterThan(lightestDark);
  });

  it('washes landing ground blue', () => {
    const plain = allPixel(1, 150, 3, false);
    const landing = allPixel(1, 150, 3, true);
    expect(landing[2] - landing[0]).toBeGreaterThan(plain[2] - plain[0] + 40);
  });

  it('treats a slope with no value as plain ground', () => {
    expect(allPixel(1, 150, NaN, false)).toEqual(allPixel(1, 150, 0, false));
  });

  function resultWithOneLandingCell() {
    const r = fakeResult();
    r.fail.fill(FAIL.SLOPE);
    r.fail[3 * n + 3] = 0;
    r.elevation[0] = NaN;
    r.maskStride = Math.ceil((n * n) / 8);
    r.steps = 2;
    r.sunMask = new Uint8Array(2 * r.maskStride);
    r.sunMask[r.maskStride] = 0b00000100; // at step 1 only cell 2 is sunlit
    return r;
  }
  const pixel = (picture, size, x, y) => [...picture.slice((y * size + x) * 4, (y * size + x) * 4 + 4)];

  it('builds a sunlit and a shadowed picture, finer than the cells, with the background where there is no data', () => {
    const r = resultWithOneLandingCell();
    const { size, scale, lit, dark } = allPictures(r, hillshade(r.elevation, n, r.cellM));
    expect(scale).toBe(ALL_SCALE);
    expect(size).toBe(n * ALL_SCALE);
    expect(lit.length).toBe(size * size * 4);
    expect(pixel(lit, size, 0, 0)).toEqual([6, 8, 12, 255]);
    expect(pixel(dark, size, 0, 0)).toEqual([6, 8, 12, 255]);
    const far = pixel(lit, size, size - 2, size - 2);
    expect(far[0]).toBe(far[1]); // slope 5 degrees: plain grey
    expect(far[0]).toBeGreaterThan(pixel(dark, size, size - 2, size - 2)[0] + 50);
  });

  it('outlines landing ground the same way in both pictures: bright inside the edge, dark just outside', () => {
    const r = resultWithOneLandingCell();
    const { size, lit, dark } = allPictures(r, hillshade(r.elevation, n, r.cellM));
    const x = 3 * ALL_SCALE;
    const y = 3 * ALL_SCALE;
    expect(pixel(lit, size, x, y)).toEqual([150, 215, 255, 255]);
    expect(pixel(dark, size, x, y)).toEqual([150, 215, 255, 255]);
    expect(pixel(lit, size, x - 1, y)).toEqual([6, 12, 30, 255]);
    expect(pixel(dark, size, x - 1, y)).toEqual([6, 12, 30, 255]);
    expect(pixel(lit, size, x - 2, y)[0]).toBeGreaterThan(90); // beyond the outline: ordinary ground again
  });

  it('composes a moment from the two pictures: sunlit cells from one, the rest from the other', () => {
    const r = resultWithOneLandingCell();
    const pictures = allPictures(r, hillshade(r.elevation, n, r.cellM));
    const { size } = pictures;
    const out = new Uint8ClampedArray(size * size * 4);
    composeAll(pictures, r, 1, out);
    const inCell = (cell) => [(cell % n) * ALL_SCALE + 1, Math.floor(cell / n) * ALL_SCALE + 1];
    expect(pixel(out, size, ...inCell(2))).toEqual(pixel(pictures.lit, size, ...inCell(2)));
    expect(pixel(out, size, ...inCell(5))).toEqual(pixel(pictures.dark, size, ...inCell(5)));
    composeAll(pictures, r, 0, out); // at step 0 nothing is sunlit
    expect(out).toEqual(pictures.dark);
    composeAll(pictures, { ...r, sunMask: undefined }, 0, out); // a result without sunlight maps is drawn in shadow
    expect(out).toEqual(pictures.dark);
  });

  it('has a legend naming sunlight, shadow, the three steeper slope bands and landing ground', () => {
    const legend = layerLegend(ALL_LAYER, fakeResult());
    expect(legend.swatches.map((s) => s.label)).toEqual(['in sunlight', 'in shadow', 'slope 10–15°', 'slope 15–20°', 'slope over 20°', 'landing ground']);
    for (const s of legend.swatches) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(legend.note).toMatch(/smoothed/);
  });
});
