// Terrain around one point, sampled on a polar grid: rings of growing distance, spokes every half degree
// of compass direction. The same samples draw the surface view's ground and give the real horizon.
//
// Shared by the browser and by Node (server/, tests): no browser or Node APIs here.
import { DEG, MOON_RADIUS_KM } from '../astro/coords.js';
import { visibilityStats } from '../astro/sky.js';

const R = MOON_RADIUS_KM * 1000; // metres

export const DEFAULT_AZIMUTHS = 720; // one spoke every 0.5°
export const DEFAULT_MAX_DISTANCE_M = 300_000;

/**
 * Distances of the rings from the viewer, in metres along the ground. Dense where the data has detail
 * and close terrain matters; sparser far away, where only big mountains reach above the horizon.
 */
export function ringDistances(maxDistanceM = DEFAULT_MAX_DISTANCE_M) {
  const out = [];
  let d = 2;
  while (d < maxDistanceM) {
    out.push(d);
    if (d < 2000) d += Math.max(d * 0.08, 0.5); // near ground: the 80 m data is smooth here anyway
    else if (d < 8000) d += 80; // the data's own spacing
    else if (d < 50_000) d += d * 0.01;
    else if (d < 120_000) d += 500;
    else d += 1000;
  }
  return Float64Array.from(out);
}

/** Point reached by travelling `distanceM` along the ground from (lat, lon) on compass bearing `azimuthDeg`. */
export function destination(latDeg, lonDeg, azimuthDeg, distanceM) {
  const la = latDeg * DEG;
  const az = azimuthDeg * DEG;
  const g = distanceM / R;
  const sinLat = Math.sin(la) * Math.cos(g) + Math.cos(la) * Math.sin(g) * Math.cos(az);
  const lat = Math.asin(Math.min(1, Math.max(-1, sinLat)));
  const lon = lonDeg * DEG + Math.atan2(Math.sin(az) * Math.sin(g) * Math.cos(la), Math.cos(g) - Math.sin(la) * sinLat);
  return { lat: lat / DEG, lon: ((((lon / DEG + 180) % 360) + 360) % 360) - 180 };
}

/**
 * Where a terrain point sits relative to the ground under the viewer, with the Moon's curvature included.
 * @returns {{x: number, z: number}} x = horizontal distance, z = height above the viewer's ground (metres)
 */
export function localXZ(distanceM, heightM, groundHeightM) {
  const g = distanceM / R;
  return { x: (R + heightM) * Math.sin(g), z: (R + heightM) * Math.cos(g) - (R + groundHeightM) };
}

/**
 * @typedef {Object} TerrainPatch
 * @property {number} lat
 * @property {number} lon
 * @property {number} groundHeightM   height of the ground under the viewer, relative to the 1737.4 km sphere
 * @property {number} nAz             number of spokes; spoke j points to azimuth j * 360 / nAz
 * @property {Float64Array|number[]} distances  ring distances in metres
 * @property {Float32Array} heights   heights in metres, ring by ring: heights[ring * nAz + spoke]; NaN = no data
 * @property {Float32Array} [slopes]  ground slope in degrees at the same points (measured over one 80 m pixel); NaN = no data
 * @property {number} [groundSlopeDeg] slope under the viewer
 * @property {number} coverage        share of samples that had data (0–1)
 * @property {string} dataset
 */

/**
 * The real horizon: for each spoke, the highest elevation angle any terrain reaches, seen from
 * `observerHeightM` above the ground. Degrees. On a smooth Moon every value would be the small
 * negative horizon dip.
 * @param {TerrainPatch} patch
 */
export function horizonProfile(patch, observerHeightM = 0) {
  const { nAz, distances, heights, groundHeightM } = patch;
  const profile = new Float32Array(nAz).fill(-90);
  for (let k = 0; k < distances.length; k++) {
    const g = distances[k] / R;
    const sinG = Math.sin(g);
    const cosG = Math.cos(g);
    const row = k * nAz;
    for (let j = 0; j < nAz; j++) {
      const h = heights[row + j];
      if (Number.isNaN(h)) continue;
      const x = (R + h) * sinG;
      const z = (R + h) * cosG - (R + groundHeightM) - observerHeightM;
      const angle = Math.atan2(z, x) / DEG;
      if (angle > profile[j]) profile[j] = angle;
    }
  }
  return profile;
}

/** Horizon elevation at any azimuth, interpolated between spokes. */
export function horizonAt(profile, azimuthDeg) {
  const n = profile.length;
  const f = ((((azimuthDeg % 360) + 360) % 360) / 360) * n;
  const j = Math.floor(f) % n;
  const t = f - Math.floor(f);
  return profile[j] * (1 - t) + profile[(j + 1) % n] * t;
}

/**
 * How far a body clears the real horizon at each time step: elevation minus the terrain's elevation in
 * that compass direction. Positive means visible.
 */
export function clearanceSeries(elevations, azimuths, profile) {
  const out = new Float64Array(elevations.length);
  for (let i = 0; i < out.length; i++) out[i] = elevations[i] - horizonAt(profile, azimuths[i]);
  return out;
}

/** Like visibilityStats, but "up" means clear of the real terrain horizon, not the smooth one. */
export function terrainVisibility(elevations, azimuths, profile, minClearanceDeg, stepHours) {
  return visibilityStats(clearanceSeries(elevations, azimuths, profile), minClearanceDeg, stepHours);
}

// ---- Wire format: a small JSON header, the heights as raw 32-bit floats, then slopes as single bytes ----

const SLOPE_STEPS_PER_DEGREE = 3; // slopes travel as one byte each: a third of a degree is plenty
const NO_SLOPE = 255;

/** @returns {Uint8Array} */
export function encodePatch(patch) {
  const { heights, slopes, ...header } = patch;
  const json = new TextEncoder().encode(JSON.stringify({ ...header, distances: Array.from(patch.distances), hasSlopes: !!slopes }));
  const headerBytes = Math.ceil(json.length / 4) * 4; // keep the floats 4-byte aligned
  const out = new Uint8Array(4 + headerBytes + heights.byteLength + (slopes ? slopes.length : 0));
  new DataView(out.buffer).setUint32(0, headerBytes, true);
  out.set(json, 4);
  out.fill(0x20, 4 + json.length, 4 + headerBytes); // pad with spaces, which JSON.parse ignores
  out.set(new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength), 4 + headerBytes);
  if (slopes) {
    const start = 4 + headerBytes + heights.byteLength;
    for (let i = 0; i < slopes.length; i++) {
      out[start + i] = Number.isNaN(slopes[i]) ? NO_SLOPE : Math.min(Math.round(slopes[i] * SLOPE_STEPS_PER_DEGREE), NO_SLOPE - 1);
    }
  }
  return out;
}

/** @param {ArrayBuffer} buffer  @returns {TerrainPatch} */
export function decodePatch(buffer) {
  const headerBytes = new DataView(buffer).getUint32(0, true);
  const { hasSlopes, ...header } = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerBytes)));
  const count = header.nAz * header.distances.length;
  const start = 4 + headerBytes;
  const heights = new Float32Array(buffer.slice(start, start + count * 4));
  const patch = { ...header, distances: Float64Array.from(header.distances), heights };
  if (hasSlopes) {
    const bytes = new Uint8Array(buffer, start + count * 4, count);
    patch.slopes = Float32Array.from(bytes, (b) => (b === NO_SLOPE ? NaN : b / SLOPE_STEPS_PER_DEGREE));
  }
  return patch;
}
