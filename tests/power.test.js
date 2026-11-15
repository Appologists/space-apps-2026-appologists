import { describe, expect, it } from 'vitest';
import { SUN_RADIUS_DEG, energySummary, hoursUntilBelow, irradiance, powerSeries, sunVisibleFraction } from '../src/finder/power.js';

const r = SUN_RADIUS_DEG;

describe('sunVisibleFraction', () => {
  it('is all of the Sun when its edge clears the skyline, none when its top is below, half when centred on it', () => {
    expect(sunVisibleFraction(r)).toBe(1);
    expect(sunVisibleFraction(5)).toBe(1);
    expect(sunVisibleFraction(-r)).toBe(0);
    expect(sunVisibleFraction(-5)).toBe(0);
    expect(sunVisibleFraction(0)).toBeCloseTo(0.5, 12);
  });

  it('fades smoothly and evenly: what shows at +c is what is hidden at −c', () => {
    for (const c of [0.05, 0.1, 0.2, 0.26]) expect(sunVisibleFraction(c) + sunVisibleFraction(-c)).toBeCloseTo(1, 12);
    expect(sunVisibleFraction(0.1)).toBeGreaterThan(sunVisibleFraction(0.05));
  });

  it('keeps missing data missing', () => {
    expect(Number.isNaN(sunVisibleFraction(NaN))).toBe(true);
  });
});

describe('irradiance', () => {
  it('is 1361 W/m² at 1 AU and falls with the square of the distance', () => {
    expect(irradiance(1)).toBe(1361);
    expect(irradiance(2)).toBeCloseTo(1361 / 4, 9);
    // The yearly swing: about 1408 W/m² at the nearest, about 1316 at the farthest.
    expect(irradiance(0.983)).toBeCloseTo(1408.5, 0);
    expect(irradiance(1.017)).toBeCloseTo(1315.9, 0);
  });
});

describe('powerSeries', () => {
  const panel = (mount) => ({ areaM2: 1, efficiency: 0.3, mount, otherLosses: 0.1 });
  const one = (clear, el, mount) => powerSeries({ sunClear: [clear], sunEl: [el], sunDistanceAU: [1], panel: panel(mount) })[0];

  it('gives 1361 × area × efficiency × (1 − losses) for a panel pointed at a fully visible Sun', () => {
    expect(one(5, 1.5, 'tracking')).toBeCloseTo(1361 * 0.3 * 0.9, 9); // 367.47 W
  });

  it('gives a flat panel only sin(elevation) of that with the Sun low, as at the pole', () => {
    expect(one(5, 1.5, 'flat')).toBeCloseTo(367.47 * Math.sin((1.5 * Math.PI) / 180), 6); // about 9.6 W
    expect(one(5, 1.5, 'vertical')).toBeCloseTo(367.47 * Math.cos((1.5 * Math.PI) / 180), 6);
  });

  it('halves when the skyline cuts the Sun through its centre, and is zero behind the terrain', () => {
    expect(one(0, 1.5, 'tracking')).toBeCloseTo(367.47 / 2, 6);
    expect(one(-1, 1.5, 'tracking')).toBe(0);
  });
});

describe('energySummary', () => {
  it('adds up energy over the stay', () => {
    const s = energySummary(new Float64Array(10).fill(100), 0, 10, 1, 0);
    expect(s.energyWh).toBe(1000);
    expect(s.averageW).toBe(100);
    expect(s.peakW).toBe(100);
    expect(s.zeroHours).toBe(0);
  });

  it('sizes the battery by the deepest shortfall, not by the dark hours alone', () => {
    // 50 W load. Net energy: +50, +100, +50, 0, −50, 0 → fullest at +100, lowest at −50: 150 Wh needed.
    const s = energySummary([100, 100, 0, 0, 0, 100], 0, 6, 1, 50);
    expect(s.batteryWh).toBe(150);
    expect(s.zeroHours).toBe(3);
  });

  it('counts only the stay it is given', () => {
    const s = energySummary([0, 0, 100, 100, 0], 2, 2, 1, 0);
    expect(s.energyWh).toBe(200);
  });
});

describe('hoursUntilBelow', () => {
  it('finds when the Sun (or Earth) first goes behind the terrain, or says it does not within the data', () => {
    expect(hoursUntilBelow([2, 1, 0.5, -1, 3], 0, 0, 1)).toBe(3);
    expect(hoursUntilBelow([2, 1, 0.5], 0, 0, 1)).toBe(null);
    expect(hoursUntilBelow([-1, 2], 0, 0, 1)).toBe(0);
  });
});
