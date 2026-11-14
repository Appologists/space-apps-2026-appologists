import { describe, expect, it } from 'vitest';
import { BLUE_RAMP, LENSES, NO_DATA_HEX, ORANGE_RAMP, SLOPE_MAX_DEG, elevationDomain, hexToLinear, lensById, rampColor } from '../src/surface/lenses.js';
import { ringDistances } from '../src/terrain/polar-grid.js';

/** Perceived lightness (OKLab L) of a linear-light colour. */
function lightness([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

function fakePatch(heightFn, groundHeightM = 0) {
  const nAz = 36;
  const distances = ringDistances(150_000);
  const heights = new Float32Array(distances.length * nAz);
  const slopes = new Float32Array(distances.length * nAz);
  for (let k = 0; k < distances.length; k++) {
    for (let j = 0; j < nAz; j++) {
      heights[k * nAz + j] = heightFn(distances[k], j * 10);
      slopes[k * nAz + j] = j; // 0° to 35°
    }
  }
  return { lat: -89, lon: 0, groundHeightM, groundSlopeDeg: 3, nAz, distances, heights, slopes, coverage: 1, dataset: 'fake', pixelM: 80 };
}

describe('lens colour ramps', () => {
  it('get steadily lighter from the low end to the high end, so brightness can be read as amount', () => {
    for (const ramp of [BLUE_RAMP, ORANGE_RAMP]) {
      const L = Array.from({ length: 64 }, (_, i) => lightness(rampColor(ramp, i / 63)));
      for (let i = 1; i < L.length; i++) expect(L[i]).toBeGreaterThan(L[i - 1]);
      expect(L[0]).toBeLessThan(0.36); // dark end recedes into the dark view
      expect(L.at(-1)).toBeGreaterThan(0.88);
    }
  });
  it('step through the same lightness values, so the two lenses read alike', () => {
    BLUE_RAMP.forEach((hex, i) => expect(lightness(hexToLinear(hex))).toBeCloseTo(lightness(hexToLinear(ORANGE_RAMP[i])), 2));
  });
  it('keep "no data" neutral: no tint, and unlike either end of a ramp', () => {
    const [r, g, b] = hexToLinear(NO_DATA_HEX);
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.01);
  });
  it('clamp out-of-range positions', () => {
    expect(rampColor(BLUE_RAMP, -1)).toEqual(rampColor(BLUE_RAMP, 0));
    expect(rampColor(BLUE_RAMP, 2)).toEqual(rampColor(BLUE_RAMP, 1));
  });
});

describe('elevation lens', () => {
  const patch = fakePatch((d) => -1000 + d / 100, 420); // rises 10 m per km: −1,000 m here to 0 m at 100 km
  it('spreads its colours over the nearby terrain, in round numbers, ignoring terrain beyond 100 km', () => {
    const domain = elevationDomain(patch);
    expect(Math.abs(domain.min % 100)).toBe(0);
    expect(Math.abs(domain.max % 100)).toBe(0);
    expect(domain.min).toBeLessThanOrEqual(-900);
    expect(domain.max).toBeLessThanOrEqual(100); // the 500 m of climb beyond 100 km is left out
  });
  it('gives higher ground a lighter colour and marks where the viewer stands', () => {
    const { color, legend } = lensById('elevation').build(patch);
    expect(lightness(color(-200))).toBeGreaterThan(lightness(color(-800)));
    expect(legend.stops.filter((s) => s.label)).toHaveLength(3);
    expect(legend.marker.label).toContain('420 m');
    expect(legend.marker.at).toBe(1); // 420 m is above the range, so the marker pins to the top end
  });
  it('reads the value for each vertex: vertex 0 is the ground under the viewer', () => {
    const lens = lensById('elevation');
    expect(lens.value(patch, 0)).toBe(420);
    expect(lens.value(patch, 1)).toBe(patch.heights[0]);
  });
});

describe('slope lens', () => {
  const patch = fakePatch(() => 0);
  it('gives steeper ground a lighter colour, up to the cap', () => {
    const { color, legend } = lensById('slope').build(patch);
    expect(lightness(color(25))).toBeGreaterThan(lightness(color(5)));
    expect(color(SLOPE_MAX_DEG + 20)).toBe(color(SLOPE_MAX_DEG));
    expect(legend.stops.filter((s) => s.label).map((s) => s.label)).toEqual(['0°', '10°', '20°', '30°', '40°+']);
  });
  it('has no value where the patch has no slopes', () => {
    const lens = lensById('slope');
    expect(lens.value({ ...patch, slopes: undefined }, 5)).toBeNaN();
    expect(lens.value(patch, 0)).toBe(3);
  });
});

describe('lens list', () => {
  it('starts with the natural view and falls back to it for unknown ids', () => {
    expect(LENSES[0].id).toBe('natural');
    expect(LENSES[0].build).toBeUndefined();
    expect(lensById('nope').id).toBe('natural');
  });
});
