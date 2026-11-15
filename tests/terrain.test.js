import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fetchTerrainPatch, forgetTerrainPatches, savedSpot } from '../src/terrain/client.js';
import { horizonDipDeg, visibilityStats } from '../src/astro/sky.js';
import { buildShadowGrid, litFraction, sampleGrid, sweepShadows } from '../src/surface/shadows.js';
import {
  clearanceSeries,
  decodePatch,
  destination,
  encodePatch,
  horizonAt,
  horizonProfile,
  localXZ,
  ringDistances,
  terrainVisibility,
} from '../src/terrain/polar-grid.js';
import { heightAt, latLonToPixel, openLolaPolar, parseLabel, samplePolarPatch, slopeAt } from '../server/lola-polar.mjs';

const LABEL = `
    LINES                 = 7600
    LINE_SAMPLES          = 7600
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
 MAP_PROJECTION_TYPE          = "POLAR STEREOGRAPHIC"
 CENTER_LATITUDE              = -90 <deg>
 CENTER_LONGITUDE             = 0 <deg>
 MAP_SCALE                    = 80 <m/pix>
 MAXIMUM_LATITUDE             = -80 <deg>
 LINE_PROJECTION_OFFSET       = 3799.5 <pix>
 SAMPLE_PROJECTION_OFFSET     = 3799.5 <pix>
`;

/** A terrain patch with the same height everywhere, or a custom height per (distance, azimuth). */
function fakePatch(heightFn = () => 0, groundHeightM = 0) {
  const nAz = 72;
  const distances = ringDistances(60_000);
  const heights = new Float32Array(distances.length * nAz);
  for (let k = 0; k < distances.length; k++) for (let j = 0; j < nAz; j++) heights[k * nAz + j] = heightFn(distances[k], (j * 360) / nAz);
  return { lat: -89, lon: 0, groundHeightM, nAz, distances, heights, coverage: 1, dataset: 'fake', pixelM: 80 };
}

describe('LOLA polar grid', () => {
  const label = parseLabel(LABEL);
  it('reads the label', () => {
    expect(label).toMatchObject({ lines: 7600, samples: 7600, scaleM: 80, scalingFactor: 0.5, radiusM: 1737400, edgeLat: -80 });
  });
  it('puts the pole in the middle, 0° longitude up and 90° E to the right', () => {
    expect(latLonToPixel(label, -90, 0)).toEqual({ x: 3799.5, y: 3799.5 });
    const up = latLonToPixel(label, -89, 0);
    expect(up.x).toBeCloseTo(3799.5);
    expect(3799.5 - up.y).toBeCloseTo(379.05, 1); // 1° of latitude is 30.3 km = 379 pixels of 80 m
    const right = latLonToPixel(label, -89, 90);
    expect(right.x - 3799.5).toBeCloseTo(379.05, 1);
    expect(right.y).toBeCloseTo(3799.5);
  });
  it('interpolates heights and returns NaN off the grid', () => {
    const small = { ...label, lines: 4, samples: 4, lineOffset: 1.5, sampleOffset: 1.5 };
    const data = new Int16Array(16).map((_, i) => (i % 4) * 200); // height rises 100 m per pixel eastward
    const dem = { label: small, data };
    expect(heightAt(dem, -90, 0)).toBeCloseTo(150); // between pixel columns 1 and 2
    expect(heightAt(dem, -80, 0)).toBeNaN();
  });
  it('measures slope from neighbouring pixels', () => {
    const small = { ...label, lines: 4, samples: 4, lineOffset: 1.5, sampleOffset: 1.5 };
    const tilted = { label: small, data: new Int16Array(16).map((_, i) => (i % 4) * 160) }; // 80 m up per 80 m across
    expect(slopeAt(tilted, -90, 0)).toBeCloseTo(45, 1);
    const flat = { label: small, data: new Int16Array(16).fill(500) };
    expect(slopeAt(flat, -90, 0)).toBe(0);
    expect(slopeAt(flat, -80, 0)).toBeNaN();
  });
});

describe('polar terrain patch', () => {
  it('has rings that only grow, fine near the viewer', () => {
    const d = ringDistances();
    expect(d[0]).toBe(2);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
    expect(d.at(-1)).toBeGreaterThan(290_000);
    expect(d.length).toBeLessThan(800);
  });
  it('finds destinations along a compass bearing', () => {
    const north = destination(-89, 40, 0, 30_324);
    expect(north.lat).toBeCloseTo(-88, 2);
    expect(north.lon).toBeCloseTo(40, 4);
    const acrossPole = destination(-89, 40, 180, 2 * 30_324);
    expect(acrossPole.lat).toBeCloseTo(-89, 2);
    expect(Math.abs(acrossPole.lon)).toBeCloseTo(140, 2);
  });
  it('drops distant ground below the viewer\'s level', () => {
    const { x, z } = localXZ(50_000, 0, 0);
    expect(x).toBeCloseTo(50_000, -2);
    expect(z).toBeCloseTo(-719, 0); // d² / 2R
  });
  it('gives a smooth Moon a horizon at exactly the dip angle', () => {
    const profile = horizonProfile(fakePatch(), 2);
    for (const value of profile) expect(value).toBeCloseTo(-horizonDipDeg(2), 2);
  });
  it('sees a wall where the wall is', () => {
    // A 1,000 m wall 10 km away, to the east only.
    const patch = fakePatch((d, az) => (Math.abs(d - 10_000) < 100 && az >= 80 && az <= 100 ? 1000 : 0));
    const profile = horizonProfile(patch, 2);
    expect(horizonAt(profile, 90)).toBeGreaterThan(5.3);
    expect(horizonAt(profile, 90)).toBeLessThan(5.8); // atan(1000 / 10,000) = 5.7°, less a little curvature
    expect(horizonAt(profile, 270)).toBeCloseTo(-horizonDipDeg(2), 2);
    expect(horizonAt(profile, 359.9)).toBeCloseTo(horizonAt(profile, 0), 3); // wraps around
  });
  it('uses the terrain horizon instead of the smooth one', () => {
    const patch = fakePatch((d, az) => (Math.abs(d - 10_000) < 100 && az >= 80 && az <= 100 ? 1000 : 0));
    const profile = horizonProfile(patch, 2);
    const elevations = [3, 3, 3, 3]; // a body 3° up…
    const azimuths = [90, 90, 270, 270]; // …first behind the wall, then in the open
    expect(Array.from(clearanceSeries(elevations, azimuths, profile)).map((c) => c > 0)).toEqual([false, false, true, true]);
    expect(terrainVisibility(elevations, azimuths, profile, 0, 1).fraction).toBe(0.5);
    expect(visibilityStats(elevations, 0, 1).fraction).toBe(1);
  });
  it('survives the trip from server to browser', () => {
    const patch = fakePatch((d, az) => d / 100 + az);
    patch.heights[5] = NaN;
    patch.slopes = Float32Array.from(patch.heights, (_, i) => (i === 7 ? NaN : (i % 90) / 2)); // 0° to 44.5°
    const back = decodePatch(encodePatch(patch).buffer);
    expect(back.slopes).toHaveLength(patch.slopes.length);
    expect(back.slopes[7]).toBeNaN();
    for (const i of [0, 33, 89, 500]) expect(Math.abs(back.slopes[i] - patch.slopes[i])).toBeLessThan(0.2); // sent as thirds of a degree
    expect(back.nAz).toBe(patch.nAz);
    expect(back.groundHeightM).toBe(0);
    expect(Array.from(back.distances)).toEqual(Array.from(patch.distances));
    expect(back.heights[5]).toBeNaN();
    expect(back.heights[100]).toBe(patch.heights[100]);
    expect(back.heights).toHaveLength(patch.heights.length);
  });
});

describe('cast shadows', () => {
  // Flat ground with a 100 m high wall along the line x = 0 (it runs north–south).
  const wall = (x) => (Math.abs(x) < 10 ? 100 : 0);
  const sunAt = (azimuthDeg, elevationDeg) => {
    const az = (azimuthDeg * Math.PI) / 180;
    const el = (elevationDeg * Math.PI) / 180;
    return { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: -Math.cos(el) * Math.cos(az) };
  };
  const isLit = (grid, x, z) => litFraction(wall(x), sampleGrid(grid, grid.S, x, z), grid.dropM) > 0.5;

  it('throws a shadow of the right length, on the far side from the Sun', () => {
    const grid = buildShadowGrid(2000, 10, wall);
    sweepShadows(grid, sunAt(90, 10)); // Sun in the east, 10° up: shadow reaches 100 / tan(10°) = 567 m west
    expect(isLit(grid, 300, 0)).toBe(true); // east of the wall: sunlit
    expect(isLit(grid, -300, 0)).toBe(false); // in the shadow
    expect(isLit(grid, -520, 0)).toBe(false);
    expect(isLit(grid, -620, 0)).toBe(true); // past the end of the shadow
  });
  it('follows the Sun round the compass', () => {
    const grid = buildShadowGrid(2000, 10, wall);
    sweepShadows(grid, sunAt(270, 10)); // Sun in the west
    expect(isLit(grid, 300, 0)).toBe(false);
    expect(isLit(grid, -300, 0)).toBe(true);
    sweepShadows(grid, sunAt(60, 10)); // Sun in the north-east: the shadow falls at a slant, so it reaches
    expect(isLit(grid, -430, 500)).toBe(false); // 567 m × sin(60°) = 491 m west of the wall
    expect(isLit(grid, -550, 500)).toBe(true);
  });
  it('keeps flat ground dark when the Sun is below level', () => {
    const grid = buildShadowGrid(2000, 10, () => 0);
    sweepShadows(grid, sunAt(90, -1));
    expect(litFraction(0, sampleGrid(grid, grid.S, 0, 0), grid.dropM)).toBe(0);
  });
  it('passes shadows from a coarse grid into a fine one', () => {
    const farWall = (x) => (Math.abs(x - 3000) < 60 ? 400 : 0); // a wall outside the fine grid, to the east
    const coarse = buildShadowGrid(6000, 100, farWall);
    const fine = buildShadowGrid(1000, 10, farWall);
    const sun = sunAt(90, 5); // shadow reaches 400 / tan(5°) = 4.6 km west of the wall: across the whole fine grid
    sweepShadows(coarse, sun);
    sweepShadows(fine, sun, (x, z) => sampleGrid(coarse, coarse.M, x, z));
    expect(litFraction(0, sampleGrid(fine, fine.S, 0, 0), fine.dropM)).toBe(0);
    sweepShadows(fine, sun); // without the coarse grid the fine grid knows nothing of the wall
    expect(litFraction(0, sampleGrid(fine, fine.S, 0, 0), fine.dropM)).toBe(1);
  });
});

// These run only on machines that have downloaded the terrain: npm run data:fetch -- lola-south-80s-80m
const dir = new URL('../data/raw/lola-south-80s-80m/', import.meta.url);
const haveData = existsSync(new URL('ldem_80s_80m.img', dir));
describe.skipIf(!haveData)('real LOLA 80 m data', () => {
  const demPromise = haveData
    ? openLolaPolar({ imgPath: new URL('ldem_80s_80m.img', dir).pathname, lblPath: new URL('ldem_80s_80m.lbl', dir).pathname, id: 'lola-south-80s-80m' })
    : null;

  it('finds crater floors at the catalogued crater centres (so east and west are not swapped)', async () => {
    const dem = await demPromise;
    expect(heightAt(dem, -89.67, 129.78)).toBeLessThan(-2500); // Shackleton
    expect(heightAt(dem, -88.1, 44.9)).toBeLessThan(-3000); // Shoemaker
    expect(heightAt(dem, -87.3, 77)).toBeLessThan(-2000); // Faustini
    expect(heightAt(dem, -89.67, -129.78)).toBeGreaterThan(0); // the mirror image of Shackleton is high ground
  });

  it('shows Shackleton\'s floor walled in by its rim, far above where the Sun can reach', async () => {
    const patch = samplePolarPatch(await demPromise, -89.67, 129.78);
    expect(patch.coverage).toBeGreaterThan(0.99);
    const profile = horizonProfile(patch, 2);
    expect(Math.min(...profile)).toBeGreaterThan(15); // the Sun never climbs past about 1.6° here
    // A flat floor and steep walls: the floor under the viewer is gentle, the wall 7 km out is about 30°.
    expect(patch.groundSlopeDeg).toBeLessThan(5);
    const wallRing = patch.distances.findIndex((d) => d > 7000);
    const wall = Array.from(patch.slopes.subarray(wallRing * patch.nAz, (wallRing + 1) * patch.nAz));
    const mean = wall.reduce((sum, v) => sum + v, 0) / wall.length;
    expect(mean).toBeGreaterThan(24);
    expect(mean).toBeLessThan(36);
  });
});

describe('the ground for the ride on the hosted website (no server)', () => {
  const reply = (status, type, body) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => type }, arrayBuffer: async () => body, json: async () => ({}) });
  const withFetch = async (answers, run) => {
    forgetTerrainPatches(); // each case asks afresh, not from the terrain kept in memory
    const asked = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      const answer = answers(String(url));
      if (answer === null) throw new Error('offline');
      return answer;
    };
    try {
      return { result: await run().then((value) => ({ value }), (error) => ({ error })), asked };
    } finally {
      globalThis.fetch = real;
    }
  };

  it('names a saved spot by its place to 5 decimals', () => {
    expect(savedSpot(-89.00320819404627, 122.70685772329182)).toBe('-89.00321_122.70686');
    expect(savedSpot('-88.8', 5)).toBe('-88.80000_5.00000');
  });

  it('reads the saved ground when the terrain service is not there', async () => {
    const bytes = encodePatch(fakePatch((d) => d / 100)).buffer;
    for (const missing of [reply(404, 'text/html'), reply(501, 'text/html'), reply(200, 'text/html'), null]) {
      const { result, asked } = await withFetch((url) => (url.startsWith('/api/') ? missing : reply(200, 'application/octet-stream', bytes)), () => fetchTerrainPatch(-89.00320819, 122.70685772));
      expect(result.error).toBeUndefined();
      expect(result.value.heights.length).toBeGreaterThan(0);
      expect(asked[1]).toBe('/static/polar/-89.00321_122.70686.bin');
    }
  });

  it('uses the terrain service when it answers, and passes on what it says went wrong', async () => {
    const bytes = encodePatch(fakePatch((d) => d / 100)).buffer;
    const live = await withFetch(() => reply(200, 'application/octet-stream', bytes), () => fetchTerrainPatch(-89, 122));
    expect(live.asked).toHaveLength(1);
    expect(live.result.value.heights.length).toBeGreaterThan(0);
    const failed = await withFetch(() => ({ ...reply(400, 'application/json'), json: async () => ({ error: 'No terrain data here.', hint: 'npm run data:fetch' }) }), () => fetchTerrainPatch(10, 20));
    expect(failed.result.error.message).toBe('No terrain data here. Run: npm run data:fetch');
  });

  it('keeps a spot\'s terrain in memory, but not a failure', async () => {
    const bytes = encodePatch(fakePatch((d) => d / 100)).buffer;
    const twice = await withFetch(() => reply(200, 'application/octet-stream', bytes), async () => {
      const first = await fetchTerrainPatch(-88.1, 33);
      const again = await fetchTerrainPatch(-88.1, 33);
      return first === again;
    });
    expect(twice.result.value).toBe(true);
    expect(twice.asked).toHaveLength(1);
    let calls = 0;
    const flaky = await withFetch(() => (++calls === 1 ? ({ ...reply(500, 'application/json'), json: async () => ({ error: 'busy' }) }) : reply(200, 'application/octet-stream', bytes)), async () => {
      await fetchTerrainPatch(-88.2, 33).catch(() => null);
      return fetchTerrainPatch(-88.2, 33);
    });
    expect(flaky.result.value.heights.length).toBeGreaterThan(0);
    expect(flaky.asked).toHaveLength(2);
  });

  it('says so in plain words when a spot is not saved', async () => {
    // a host that answers a missing file with its front page (text/html, 200) must not be read as terrain
    const { result } = await withFetch((url) => (url.startsWith('/api/') ? reply(404, 'text/html') : reply(200, 'text/html')), () => fetchTerrainPatch(-88.5, 10));
    expect(result.error.message).toMatch(/not saved on the website/);
  });
});
