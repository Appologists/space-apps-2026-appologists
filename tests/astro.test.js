import { describe, expect, it } from 'vitest';
import { angularDistanceDeg, latLonToVec, lon360, vecToLatLon, wrapLon } from '../src/astro/coords.js';
import { ephemerisSeries, subPoints, sunEarthFromMoon } from '../src/astro/ephemeris.js';
import { horizonDipDeg, skyAt, skySeries, visibilityStats } from '../src/astro/sky.js';

// Reference values from NASA JPL Horizons (DE441), fetched 2026-11-14:
// observer on the Moon's surface (CENTER='coord@301', MEAN_ME frame), QUANTITIES=4, airless apparent az/el.
// Regenerate with `npm run check:horizons`.
const HORIZONS = [
  { site: { lat: 0.674, lon: 23.473 }, t: '2026-11-14T18:00Z', sun: [91.513739, -4.02159], earth: [276.860382, 64.00282] },
  { site: { lat: 0.674, lon: 23.473 }, t: '2026-11-16T18:00Z', sun: [91.907623, 20.323521], earth: [270.984925, 61.486602] },
  { site: { lat: -89.5, lon: 0 }, t: '2026-11-14T18:00Z', sun: [117.488482, 1.325769], earth: [357.72922, -3.342564] },
  { site: { lat: -89.5, lon: 0 }, t: '2026-11-16T06:00Z', sun: [99.220033, 1.474712], earth: [355.698355, -1.484428] },
];

describe('Sun and Earth positions', () => {
  it('match JPL Horizons within 0.02°', () => {
    for (const ref of HORIZONS) {
      const sky = skyAt(ref.site, new Date(ref.t));
      for (const body of ['sun', 'earth']) {
        const [azimuth, elevation] = ref[body];
        expect(Math.abs(sky[body].elevation - elevation)).toBeLessThan(0.02);
        const azError = Math.abs(((sky[body].azimuth - azimuth + 540) % 360) - 180) * Math.cos((elevation * Math.PI) / 180);
        expect(azError).toBeLessThan(0.02);
      }
    }
  });

  it('keeps Earth near the middle of the near side and the Sun near the equator', () => {
    const { subEarth, subSolar } = subPoints(sunEarthFromMoon(new Date('2027-03-05T06:00Z')));
    expect(Math.abs(subEarth.lat)).toBeLessThan(7); // libration in latitude
    expect(Math.abs(subEarth.lon)).toBeLessThan(8.5); // libration in longitude
    expect(Math.abs(subSolar.lat)).toBeLessThan(1.7); // the Moon's small axial tilt
  });

  it('builds an evenly spaced series', () => {
    const series = ephemerisSeries(new Date('2026-11-14T00:00Z'), 24, 60);
    expect(series.samples).toHaveLength(25);
    expect(series.stepHours).toBe(1);
    expect(series.samples[24].date.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    const sky = skySeries({ lat: 0, lon: 0 }, series);
    expect(sky.sunEl).toHaveLength(25);
    expect(sky.earthEl[0]).toBeGreaterThan(80); // Earth is nearly overhead at the centre of the near side
  });
});

describe('coordinates', () => {
  it('round-trips latitude and longitude', () => {
    for (const [lat, lon] of [[0.674, 23.473], [-43.3, -11.2], [-89.5, 0], [10, 179.9], [60, -120]]) {
      const back = vecToLatLon(latLonToVec(lat, lon, 1737.4));
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lon).toBeCloseTo(lon, 9);
    }
  });
  it('uses +X for 0°E, +Y for 90°E, +Z for the north pole', () => {
    expect(latLonToVec(0, 0)[0]).toBeCloseTo(1);
    expect(latLonToVec(0, 90)[1]).toBeCloseTo(1);
    expect(latLonToVec(90, 0)[2]).toBeCloseTo(1);
  });
  it('wraps longitudes', () => {
    expect(wrapLon(190)).toBe(-170);
    expect(wrapLon(-180)).toBe(180);
    expect(wrapLon(360)).toBe(0);
    expect(lon360(-20)).toBe(340);
    expect(angularDistanceDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 90 })).toBeCloseTo(90);
  });
});

describe('horizon and visibility', () => {
  it('computes the horizon dip from height', () => {
    expect(horizonDipDeg(0)).toBe(0);
    expect(horizonDipDeg(2)).toBeCloseTo(0.0869, 3);
    expect(horizonDipDeg(10)).toBeCloseTo(0.1944, 3);
  });
  it('finds the longest unbroken run, not the total', () => {
    //                 up up up dn up up up up up dn
    const elevations = [1, 1, 1, -1, 1, 1, 1, 1, 1, -1];
    const stats = visibilityStats(elevations, 0, 1);
    expect(stats.windowHours).toBe(9);
    expect(stats.longestRunHours).toBe(4); // samples 4..8
    expect(stats.longestRunStartHours).toBe(4);
    expect(stats.interruptions).toBe(1);
    expect(stats.fraction).toBeCloseTo(0.8);
    expect(stats.upAtStart).toBe(true);
    expect(stats.hoursUntilChange).toBe(3);
  });
  it('handles always-up and never-up', () => {
    const up = visibilityStats([5, 5, 5, 5], 0, 2);
    expect(up.longestRunHours).toBe(6);
    expect(up.fraction).toBe(1);
    expect(up.hoursUntilChange).toBeNull();
    const down = visibilityStats([-5, -5, -5], 0, 2);
    expect(down.longestRunHours).toBe(0);
    expect(down.runs).toHaveLength(0);
    expect(down.upAtStart).toBe(false);
  });
});
