// The landing-site finder: for every cell of a search area, is it flat enough to land on, sunlit and in view
// of Earth at touchdown, and never dark for longer than the rover survives? Node only (dev server and tools).
//
// Method. The terrain around the search centre is laid out in a flat frame (x east, y up, z south; the
// Moon's curvature is built into y), on two grids: a fine one over the search area and a coarse one reaching
// 150 km further, far enough to hold any mountain that could block a low Sun. For each time step the shadow
// sweep from src/surface/shadows.js gives the height of the lowest unblocked sunbeam above every cell; a
// solar panel is lit when it stands above that height. Earth is treated the same way, for the antenna.
// "Visible" means the centre of the Sun's or Earth's disc clears the terrain.
// Each grid asks for terrain as fine as its own cells, so "best available" terrain (server/composite.mjs)
// reads its finest data for the search area and coarser data for the far grid.
import { MOON_RADIUS_KM } from '../src/astro/coords.js';
import { ephemerisSeries } from '../src/astro/ephemeris.js';
import { altAz } from '../src/astro/sky.js';
import { cellOffset, offsetToLatLon, searchGrid } from '../src/finder/grid.js';
import { FAIL, cellScore, defaultFinder, pickSites } from '../src/finder/score.js';
import { buildShadowGrid, sampleGrid, sweepShadows } from '../src/surface/shadows.js';
import { heightAt, sampleAt } from './lola-polar.mjs';

const R = MOON_RADIUS_KM * 1000;
const DEG = Math.PI / 180;
const FAR_MARGIN_M = 150_000; // a 6 km peak drops below the horizon about 145 km away
const COARSE_CELL_M = 500;
const MAX_ELLIPSE_CELLS = 30; // keeps the "whole ellipse must pass" step quick

/** Unit vector toward a compass direction and elevation, in the flat frame. */
function direction(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return { x: Math.cos(el) * Math.sin(az), y: Math.sin(el), z: -Math.cos(el) * Math.cos(az) };
}

/** Bump when lightMaps() changes what it computes: maps stored by tools/precompute-light.mjs are then ignored. */
export const LIGHT_VERSION = 1;

const withDefaults = (params) => ({ stepMinutes: 60, panelHeightM: 2, antennaHeightM: 2, weights: { sunlight: 1, earthComms: 0.7 }, ...defaultFinder(), ...params });

/**
 * The expensive part of a search: for every time step of `series`, which cells see the Sun (from panel height)
 * and which see Earth (from antenna height), one bit per cell. Depends only on the place, the grid, the two
 * heights, the terrain and the times; not on any landing limit. tools/precompute-light.mjs stores these for the
 * mission regions over a stretch of dates, so a search there need not compute them again.
 * @returns {{sunMask: Uint8Array, earthMask: Uint8Array, maskStride: number, steps: number}|null}
 */
export function lightMaps(dem, params, series) {
  const p = withDefaults(params);
  const { center } = p;
  const groundHeightM = heightAt(dem, center.lat, center.lon);
  if (Number.isNaN(groundHeightM)) return null;
  const grid = searchGrid(p.radiusKm);
  const { n, cellM, halfSizeM } = grid;
  const count = n * n;
  const sceneHeight = (wantM) => (x, z) => {
    const d = Math.hypot(x, z);
    const at = offsetToLatLon(center, x, -z);
    const h = heightAt(dem, at.lat, at.lon, wantM);
    return Number.isNaN(h) ? NaN : (R + h) * Math.cos(d / R) - (R + groundHeightM);
  };
  const fine = buildShadowGrid(halfSizeM, cellM, sceneHeight(cellM));
  const coarseHalf = Math.ceil((halfSizeM + FAR_MARGIN_M) / COARSE_CELL_M) * COARSE_CELL_M;
  const coarse = buildShadowGrid(coarseHalf, COARSE_CELL_M, sceneHeight(COARSE_CELL_M));
  const beyondFine = (x, z) => sampleGrid(coarse, coarse.M, x, z);

  // Each cell's own "up", for one extra test: is the body above a smooth Moon's horizon here at all? (The sweep
  // covers real terrain; this catches night caused by the Moon's bulk beyond the coarse grid.)
  const valid = new Uint8Array(count);
  const upX = new Float32Array(count);
  const upY = new Float32Array(count);
  const upZ = new Float32Array(count);
  const sinDipPanel = new Float32Array(count);
  const sinDipAntenna = new Float32Array(count);
  const cell = [0, 0];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const c = row * n + col;
      const { east, north } = cellOffset(grid, row, col);
      const at = offsetToLatLon(center, east, north);
      const h = sampleAt(dem, at.lat, at.lon, cell, cellM)[0];
      if (Number.isNaN(h)) continue;
      valid[c] = 1;
      const y = fine.Y[c] + R + groundHeightM;
      const length = Math.hypot(east, y, north);
      upX[c] = east / length;
      upY[c] = y / length;
      upZ[c] = -north / length;
      const above = Math.max(h, 0);
      sinDipPanel[c] = Math.sin(Math.acos(R / (R + above + p.panelHeightM)));
      sinDipAntenna[c] = Math.sin(Math.acos(R / (R + above + p.antennaHeightM)));
    }
  }

  const steps = series.samples.length;
  const site = { lat: center.lat, lon: center.lon, elevationM: groundHeightM };
  const maskStride = Math.ceil(count / 8);
  const sunMask = new Uint8Array(steps * maskStride);
  const earthMask = new Uint8Array(steps * maskStride);
  for (let i = 0; i < steps; i++) {
    const sample = series.samples[i];
    const sun = altAz(site, sample.sunKm);
    const s = direction(sun.azimuth, sun.elevation);
    sweepShadows(coarse, s);
    sweepShadows(fine, s, beyondFine);
    for (let c = 0; c < count; c++) {
      if (valid[c] && fine.Y[c] + p.panelHeightM > fine.S[c] && upX[c] * s.x + upY[c] * s.y + upZ[c] * s.z > -sinDipPanel[c]) {
        sunMask[i * maskStride + (c >> 3)] |= 1 << (c & 7);
      }
    }
    const earth = altAz(site, sample.earthKm);
    const e = direction(earth.azimuth, earth.elevation);
    sweepShadows(coarse, e);
    sweepShadows(fine, e, beyondFine);
    for (let c = 0; c < count; c++) {
      if (valid[c] && fine.Y[c] + p.antennaHeightM > fine.S[c] && upX[c] * e.x + upY[c] * e.y + upZ[c] * e.z > -sinDipAntenna[c]) {
        earthMask[i * maskStride + (c >> 3)] |= 1 << (c & 7);
      }
    }
  }
  return { sunMask, earthMask, maskStride, steps };
}

/**
 * @param {{label: object, data: Int16Array, id?: string}} dem  from openLolaPolar()
 * @param {import('../src/finder/types.js').FinderParams} params
 * @param {{storedLight?: (p: object, series: object) => ({sunMask: Uint8Array, earthMask: Uint8Array}|null)}} [options]
 *        storedLight: maps computed in advance for exactly these times (light-store.mjs); null means compute them
 * @returns {{header: object, rasters: Object<string, Float32Array|Uint8Array>}|null} null if the centre has no terrain data
 */
export function searchLanding(dem, params, { storedLight = null } = {}) {
  const started = performance.now();
  const p = withDefaults(params);
  const { center } = p;
  const groundHeightM = heightAt(dem, center.lat, center.lon);
  if (Number.isNaN(groundHeightM)) return null;

  const grid = searchGrid(p.radiusKm);
  const { n, cellM, halfSizeM } = grid;
  const count = n * n;

  // ---- What does not change with time: height and slope ------------------------------------------------------
  const elevation = new Float32Array(count).fill(NaN);
  const slope = new Float32Array(count).fill(NaN);
  const valid = new Uint8Array(count); // has terrain data
  const inside = new Uint8Array(count); // within the search circle
  const radiusM = p.radiusKm * 1000;
  const cell = [0, 0]; // reused: [height, slope] of the current cell
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const c = row * n + col;
      const { east, north } = cellOffset(grid, row, col);
      const at = offsetToLatLon(center, east, north);
      const h = sampleAt(dem, at.lat, at.lon, cell, cellM)[0];
      if (Number.isNaN(h)) continue;
      valid[c] = 1;
      inside[c] = Math.hypot(east, north) <= radiusM ? 1 : 0;
      elevation[c] = h;
      slope[c] = cell[1];
    }
  }

  // ---- Step through the mission: the sunlight and Earth maps, stored in advance or computed now ------------------
  const series = ephemerisSeries(new Date(p.start), p.durationHours, p.stepMinutes);
  const { stepHours } = series;
  const stored = storedLight?.(p, series) ?? null;
  const { sunMask, earthMask } = stored ?? lightMaps(dem, p, series);
  const steps = series.samples.length;
  const maskStride = Math.ceil(count / 8);
  const sunCount = new Uint16Array(count);
  const earthCount = new Uint16Array(count);
  const litRun = new Uint16Array(count);
  const darkRun = new Uint16Array(count);
  const maxLit = new Uint16Array(count);
  const maxDark = new Uint16Array(count);
  const sunAtStart = new Uint8Array(count);
  const earthAtStart = new Uint8Array(count);
  for (let i = 0; i < steps; i++) {
    const base = i * maskStride;
    for (let c = 0; c < count; c++) {
      if (!valid[c]) continue;
      const lit = (sunMask[base + (c >> 3)] >> (c & 7)) & 1;
      if (lit) {
        sunCount[c]++;
        darkRun[c] = 0;
        if (++litRun[c] > maxLit[c]) maxLit[c] = litRun[c];
      } else {
        litRun[c] = 0;
        if (++darkRun[c] > maxDark[c]) maxDark[c] = darkRun[c];
      }
      const inView = (earthMask[base + (c >> 3)] >> (c & 7)) & 1;
      if (inView) earthCount[c]++;
      if (i === 0) {
        sunAtStart[c] = lit;
        earthAtStart[c] = inView;
      }
    }
  }

  // ---- Per-cell results ------------------------------------------------------------------------------------
  const windowHours = Math.max(steps - 1, 1) * stepHours;
  const sunFraction = new Float32Array(count).fill(NaN);
  const earthFraction = new Float32Array(count).fill(NaN);
  const longestLitH = new Float32Array(count).fill(NaN);
  const longestDarkH = new Float32Array(count).fill(NaN);
  const pointFail = new Uint8Array(count);
  for (let c = 0; c < count; c++) {
    if (!valid[c]) {
      pointFail[c] = FAIL.OUTSIDE;
      continue;
    }
    sunFraction[c] = sunCount[c] / steps;
    earthFraction[c] = earthCount[c] / steps;
    // A run of k samples in a row spans about k time steps. Runs touching the start or end of the mission
    // are cut short by the window, so these are lower bounds there.
    longestLitH[c] = Math.min(maxLit[c] * stepHours, windowHours);
    longestDarkH[c] = Math.min(maxDark[c] * stepHours, windowHours);
    let bits = 0;
    if (slope[c] > p.maxLandingSlopeDeg) bits |= FAIL.SLOPE;
    if (p.needSunAtLanding && !sunAtStart[c]) bits |= FAIL.NO_SUN_AT_LANDING;
    if (longestDarkH[c] > p.maxDarknessHours) bits |= FAIL.DARK_TOO_LONG;
    if (p.needEarthAtLanding && !earthAtStart[c]) bits |= FAIL.NO_EARTH_AT_LANDING;
    pointFail[c] = bits;
  }

  // ---- The lander may come down anywhere in its ellipse, so every point of the ellipse must pass ---------------
  const reach = Math.min(Math.round(p.ellipseRadiusM / cellM), MAX_ELLIPSE_CELLS);
  const offsets = [];
  for (let dr = -reach; dr <= reach; dr++) {
    for (let dc = -reach; dc <= reach; dc++) if (dr * dr + dc * dc <= reach * reach) offsets.push([dr, dc]);
  }
  const fail = new Uint8Array(count);
  const ellipseSlope = new Float32Array(count).fill(NaN);
  const score = new Float32Array(count).fill(NaN);
  const counts = { evaluated: 0, passing: 0, slope: 0, noSun: 0, dark: 0, noEarth: 0 };
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const c = row * n + col;
      if (!valid[c]) {
        fail[c] = FAIL.OUTSIDE;
        continue;
      }
      let bits = inside[c] ? 0 : FAIL.OUTSIDE;
      let steepest = 0;
      for (const [dr, dc] of offsets) {
        const r2 = row + dr;
        const c2 = col + dc;
        if (r2 < 0 || c2 < 0 || r2 >= n || c2 >= n) {
          bits |= FAIL.OUTSIDE;
          continue;
        }
        const j = r2 * n + c2;
        bits |= pointFail[j];
        if (slope[j] > steepest) steepest = slope[j];
      }
      fail[c] = bits;
      ellipseSlope[c] = steepest;
      if (!inside[c]) continue;
      counts.evaluated++;
      if (bits === 0) {
        counts.passing++;
        score[c] = cellScore(longestLitH[c], windowHours, earthFraction[c], p.weights);
      } else {
        if (bits & FAIL.SLOPE) counts.slope++;
        if (bits & FAIL.NO_SUN_AT_LANDING) counts.noSun++;
        if (bits & FAIL.DARK_TOO_LONG) counts.dark++;
        if (bits & FAIL.NO_EARTH_AT_LANDING) counts.noEarth++;
      }
    }
  }

  // ---- The best sites, spaced apart ---------------------------------------------------------------------------
  const picked = pickSites({ n, cellM, score, ellipseSlope }, { count: 10, minSeparationM: Math.max(2 * p.ellipseRadiusM, 1000) });
  const sites = picked.map(({ row, col, index }, i) => {
    const { east, north } = cellOffset(grid, row, col);
    const at = offsetToLatLon(center, east, north);
    return {
      rank: i + 1,
      lat: at.lat,
      lon: at.lon,
      row,
      col,
      score: score[index],
      sunFraction: sunFraction[index],
      longestLitH: longestLitH[index],
      longestDarkH: longestDarkH[index],
      earthFraction: earthFraction[index],
      ellipseSlopeDeg: ellipseSlope[index],
      elevationM: elevation[index],
    };
  });

  return {
    header: {
      n,
      cellM,
      halfSizeM,
      center: { lat: center.lat, lon: center.lon },
      radiusKm: p.radiusKm,
      groundHeightM,
      stepHours,
      steps,
      windowHours,
      maskStride,
      params: p,
      sites,
      counts,
      computeMs: Math.round(performance.now() - started),
      lightStored: !!stored, // the sunlight and Earth maps came from tools/precompute-light.mjs
      dataset: dem.id ?? 'lola',
      terrainPixelM: dem.pixelM ?? dem.label?.scaleM ?? null,
    },
    rasters: { elevation, slope, ellipseSlope, sunFraction, longestLitH, longestDarkH, earthFraction, fail, score, sunMask, earthMask },
  };
}
