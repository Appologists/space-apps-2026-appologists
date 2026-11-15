// Colours and wording for the landing-site finder's map. Pure functions: no DOM, no three.js, so they run in tests.
//
// Layer colours follow the lens rules in ../surface/lenses.js: one hue dark to light, drawn flat, so brightness is
// the data. Only the "Landing sites" layer shows terrain shape, and only on ground that fails a check.
import { FAIL, describeFail } from './score.js';
import { BLUE_RAMP, ORANGE_RAMP, rampColor } from '../surface/lenses.js';
import { SLOPE_BANDS, slopeBand } from './slope-bands.js';
import { formatHours, formatLatLon } from '../format.js';
import { cellToLatLon } from './grid.js';

export const MAP_LAYERS = [
  { id: 'result', label: 'Landing sites' },
  { id: 'sun', label: 'Sunlight' },
  { id: 'dark', label: 'Darkness' },
  { id: 'earth', label: 'Earth in view' },
  { id: 'slope', label: 'Slope' },
  { id: 'reach', label: 'Reach' },
];

/**
 * Not in the list above: the map at one moment of the mission, sunlit ground against ground in shadow.
 * The drive playback switches to it (see map-view.js setTime). Pass the time step as `extra.step`.
 */
export const TIME_LAYER = 'now';

const BACKGROUND = [6, 8, 12];
// Ground the landing search did not judge (outside its circle, or so near the map's edge that the landing
// accuracy would run off it): its relief, dimmed, so the map is one square of terrain. Darker than "fails".
const NOT_CHECKED_HEX = '#1f2024';
const notChecked = (shade) => {
  const v = Math.round(14 + shade * 0.16);
  return [v, v, v];
};
const NEVER = [16, 16, 20];
const NEVER_HEX = '#101014';
const FAIL_GREY_HEX = '#6a6a70';

const toSrgb = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
/** 256 sRGB entries (each [r, g, b], 0-255) along a ramp. Built once at module load. */
const lookup = (ramp) => Array.from({ length: 256 }, (_, i) => rampColor(ramp, i / 255).map(toSrgb));
const BLUE = lookup(BLUE_RAMP);
const ORANGE = lookup(ORANGE_RAMP);
const at = (table, t) => table[Math.round(Math.min(Math.max(Number.isNaN(t) ? 0 : t, 0), 1) * 255)];

/**
 * Hillshade of an elevation raster: light from the north-west (azimuth 315 degrees), 40 degrees above the horizon.
 * Row 0 is north, so rows increase southward. NaN elevation gives 0; NaN neighbours are treated as level.
 * @returns {Uint8Array} n * n values, 0-255
 */
export function hillshade(elevation, n, cellM) {
  const out = new Uint8Array(n * n);
  const az = (315 * Math.PI) / 180;
  const alt = (40 * Math.PI) / 180;
  const lx = Math.sin(az) * Math.cos(alt);
  const ly = Math.cos(az) * Math.cos(alt);
  const lz = Math.sin(alt);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const i = r * n + c;
      const z = elevation[i];
      if (Number.isNaN(z)) continue;
      const pick = (rr, cc) => {
        const v = elevation[Math.min(Math.max(rr, 0), n - 1) * n + Math.min(Math.max(cc, 0), n - 1)];
        return Number.isNaN(v) ? z : v;
      };
      const w = Math.max(c, 1) - 1;
      const e = Math.min(c + 1, n - 1);
      const north = Math.max(r, 1) - 1;
      const south = Math.min(r + 1, n - 1);
      const dzdx = (pick(r, e) - pick(r, w)) / ((e - w || 1) * cellM);
      const dzdy = (pick(north, c) - pick(south, c)) / ((south - north || 1) * cellM); // per metre northward
      const norm = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
      const shade = (-dzdx * lx + -dzdy * ly + lz) / norm;
      out[i] = Math.round(Math.min(Math.max(shade, 0), 1) * 255);
    }
  }
  return out;
}

/**
 * sRGB [r, g, b] (0-255) for one cell on a layer. `shade` is that cell's hillshade value.
 * Colours from the ramps are shared table entries: do not modify the returned array.
 */
export function layerPixel(layerId, result, index, shade, extra) {
  const fail = result.fail[index];
  if (Number.isNaN(result.elevation[index])) return BACKGROUND; // no terrain data
  // Sunlight, darkness, Earth and slope are measured on the whole square, so those layers show it all.
  // Only the landing verdict and the rover's reach stop at the search area.
  const judged = !(fail & FAIL.OUTSIDE);
  switch (layerId) {
    case 'result': {
      if (!judged) return notChecked(shade);
      if (fail === 0) return at(BLUE, result.score[index]);
      const v = Math.round(28 + shade * 0.42);
      return [v, v, v];
    }
    case 'sun': {
      const f = result.sunFraction[index];
      return f === 0 ? NEVER : at(ORANGE, f);
    }
    case 'dark':
      return at(BLUE, 1 - Math.min(result.longestDarkH[index] / result.windowHours, 1));
    case 'earth': {
      const f = result.earthFraction[index];
      return f === 0 ? NEVER : at(BLUE, f);
    }
    case 'slope': {
      // The route's four bands (Daniel, 2026-11-14), lightly shaded by the relief so the ground keeps its shape;
      // the shading changes brightness by at most a quarter, never the hue.
      const rgb = BAND_RGB[slopeBand(result.slope[index]).id];
      const k = 0.75 + (0.25 * shade) / 255;
      return [Math.round(rgb[0] * k), Math.round(rgb[1] * k), Math.round(rgb[2] * k)];
    }
    case 'reach': {
      if (!judged) return notChecked(shade);
      const reach = extra?.reach;
      const d = reach ? reach.dist[index] : Infinity;
      if (Number.isFinite(d)) return at(BLUE, 1 - d / reachScaleM(reach));
      const v = Math.round(28 + shade * 0.42);
      return [v, v, v];
    }
    case TIME_LAYER: {
      // Sunlit ground is a light grey and ground in shadow a dark one, so the pair cannot be mistaken for a
      // measurement. The relief shading keeps the shape readable in both, as in the surface view (decision H).
      const step = extra?.step ?? 0;
      const lit = result.sunMask ? (result.sunMask[step * result.maskStride + (index >> 3)] >> (index & 7)) & 1 : 0;
      const v = lit ? Math.round(96 + shade * 0.55) : Math.round(12 + shade * 0.1);
      return lit ? [v, v, Math.round(v * 0.94)] : [v, v, Math.round(v * 1.25)];
    }
    default:
      return BACKGROUND;
  }
}

const pct = (v) => `${Math.round(v * 100)}%`;
const BAND_RGB = Object.fromEntries(SLOPE_BANDS.map((band) => [band.id, [1, 3, 5].map((i) => parseInt(band.hex.slice(i, i + 2), 16))]));

/** The distance the Reach layer's colours run up to: the rover's range, or with no range limit the farthest spot it reaches. */
export const reachScaleM = (reach) => (Number.isFinite(reach.rangeM) ? reach.rangeM : Math.max(reach.farthestM ?? 0, 1));

/** What the legend shows for a layer, in the shape the surface view's legend uses, plus optional `swatches`. */
export function layerLegend(layerId, result, extra) {
  const blue = BLUE_RAMP.filter((_, i) => i % 3 === 0 || i === BLUE_RAMP.length - 1);
  const orange = ORANGE_RAMP.filter((_, i) => i % 3 === 0 || i === ORANGE_RAMP.length - 1);
  const withLabels = (stops, first, last) => stops.map((hex, i) => ({ hex, ...(i === 0 ? { label: first } : i === stops.length - 1 ? { label: last } : {}) }));
  switch (layerId) {
    case 'sun':
      return {
        title: 'Sunlight',
        note: 'How much of the mission the solar panel is in sunlight.',
        stops: withLabels(orange, '0%', '100%'),
        swatches: [{ hex: NEVER_HEX, label: 'never sunlit' }],
      };
    case 'dark': {
      const limit = result?.params?.maxDarknessHours;
      return {
        title: 'Longest darkness',
        note: `Longest unbroken stretch without sunlight. Darker means longer.${limit != null ? ` The rover can survive ${limit} h.` : ''}`,
        stops: withLabels(blue, `${Math.round(result?.windowHours ?? 0)} h`, '0 h'),
      };
    }
    case 'earth':
      return {
        title: 'Earth in view',
        note: 'How much of the mission Earth is in view of the antenna: when it is, the geometry allows a direct link (antennas and station schedules are not checked).',
        stops: withLabels(blue, '0%', '100%'),
        swatches: [{ hex: NEVER_HEX, label: 'Earth never in view' }],
      };
    case 'slope':
      return {
        title: 'Slope',
        note: 'Steepness of the ground at each point, in the same colours as the route.',
        stops: [],
        swatches: SLOPE_BANDS.map((band) => ({ hex: band.hex, label: band.label })),
      };
    case 'reach': {
      const reach = extra?.reach;
      const km = (m) => `${Math.round((m / 1000) * 10) / 10} km`;
      return {
        title: 'Reach',
        note: reach
          ? `How far the rover must drive from the start to get there, on slopes up to ${reach.maxSlopeDeg}°.`
          : 'Pick a start point to see how far the rover can drive. No reach data yet.',
        stops: withLabels(blue, reach ? km(reachScaleM(reach)) : 'range', '0 km'),
        swatches: [{ hex: FAIL_GREY_HEX, label: reach && !Number.isFinite(reach.rangeM) ? 'too steep, or cut off by steep ground' : 'too steep or out of range' }],
      };
    }
    case TIME_LAYER:
      return {
        title: 'Sunlight at the time shown',
        note: 'Where a solar panel is in sunlight at this moment of the mission, from the terrain and the Sun\'s position. The soft shading only shows the shape of the ground.',
        stops: [],
        swatches: [
          { hex: '#c8c8bd', label: 'in sunlight' },
          { hex: '#12121a', label: 'in shadow' },
        ],
      };
    default:
      return {
        title: 'Landing sites',
        note: 'Blue ground passes every check; lighter is better. Grey ground fails at least one.',
        stops: withLabels(blue, 'lower score', 'higher score'),
        swatches: [
          { hex: FAIL_GREY_HEX, label: 'fails a check' },
          { hex: NOT_CHECKED_HEX, label: 'not checked: outside the search circle' },
        ],
      };
  }
}

/** One plain-text line describing a cell, for the hover tooltip. */
export function describeCell(result, row, col, extra) {
  const i = row * result.n + col;
  if (Number.isNaN(result.elevation[i])) return 'no terrain data here';
  const judged = !(result.fail[i] & FAIL.OUTSIDE);
  const { lat, lon } = cellToLatLon(result, result.center, row, col);
  const verdict = !judged
    ? 'not checked for landing: outside the search circle, or too near the map edge for the landing accuracy'
    : result.fail[i] === 0
      ? 'passes every check'
      : `fails: ${describeFail(result.fail[i]).join('; ')}`;
  const reach = extra?.reach;
  const drive = !reach ? [] : [Number.isFinite(reach.dist[i]) ? `${(reach.dist[i] / 1000).toFixed(1)} km drive from the start` : 'not reachable from the start'];
  return [
    formatLatLon(lat, lon, 3),
    `${Math.round(result.elevation[i]).toLocaleString('en-US')} m`,
    `slope ${result.slope[i].toFixed(1)}°`,
    `sunlit ${pct(result.sunFraction[i])}`,
    `longest darkness ${formatHours(result.longestDarkH[i])}`,
    `Earth in view ${pct(result.earthFraction[i])}`,
    verdict,
    ...drive,
  ].join(' · ');
}
