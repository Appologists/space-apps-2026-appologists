// Colours and wording for the landing-site finder's map. Pure functions: no DOM, no three.js, so they run in tests.
//
// Layer colours follow the lens rules in ../surface/lenses.js: one hue dark to light, drawn flat, so brightness is
// the data. Only the "Landing sites" layer shows terrain shape, and only on ground that fails a check.
import { FAIL, describeFail } from './score.js';
import { BLUE_RAMP, ORANGE_RAMP, SLOPE_MAX_DEG, rampColor } from '../surface/lenses.js';
import { formatHours, formatLatLon } from '../format.js';
import { cellToLatLon } from './grid.js';

export const MAP_LAYERS = [
  { id: 'result', label: 'Landing sites' },
  { id: 'sun', label: 'Sunlight' },
  { id: 'dark', label: 'Darkness' },
  { id: 'earth', label: 'Earth link' },
  { id: 'slope', label: 'Slope' },
  { id: 'reach', label: 'Reach' },
];

const BACKGROUND = [6, 8, 12];
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
  if (fail & FAIL.OUTSIDE || Number.isNaN(result.elevation[index])) return BACKGROUND;
  switch (layerId) {
    case 'result': {
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
    case 'slope':
      return at(ORANGE, Math.min(result.slope[index] / SLOPE_MAX_DEG, 1));
    case 'reach': {
      const reach = extra?.reach;
      const d = reach ? reach.dist[index] : Infinity;
      if (Number.isFinite(d)) return at(BLUE, 1 - d / reach.rangeM);
      const v = Math.round(28 + shade * 0.42);
      return [v, v, v];
    }
    default:
      return BACKGROUND;
  }
}

const pct = (v) => `${Math.round(v * 100)}%`;

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
        title: 'Earth link',
        note: 'How much of the mission Earth is in view of the antenna.',
        stops: withLabels(blue, '0%', '100%'),
        swatches: [{ hex: NEVER_HEX, label: 'Earth never in view' }],
      };
    case 'slope':
      return {
        title: 'Slope',
        note: `Steepness of the ground at each point. ${SLOPE_MAX_DEG}° or more gets the lightest colour.`,
        stops: withLabels(orange, '0°', `${SLOPE_MAX_DEG}°`),
      };
    case 'reach': {
      const reach = extra?.reach;
      const km = (m) => `${Math.round((m / 1000) * 10) / 10} km`;
      return {
        title: 'Reach',
        note: reach
          ? `How far the rover must drive from the start to get there, on slopes up to ${reach.maxSlopeDeg}°.`
          : 'Pick a start point to see how far the rover can drive. No reach data yet.',
        stops: withLabels(blue, reach ? km(reach.rangeM) : 'range', '0 km'),
        swatches: [{ hex: FAIL_GREY_HEX, label: 'too steep or out of range' }],
      };
    }
    default:
      return {
        title: 'Landing sites',
        note: 'Blue ground passes every check; lighter is better. Grey ground fails at least one.',
        stops: withLabels(blue, 'lower score', 'higher score'),
        swatches: [{ hex: FAIL_GREY_HEX, label: 'fails a check' }],
      };
  }
}

/** One plain-text line describing a cell, for the hover tooltip. */
export function describeCell(result, row, col, extra) {
  const i = row * result.n + col;
  if (result.fail[i] & FAIL.OUTSIDE || Number.isNaN(result.elevation[i])) return 'outside the search area';
  const { lat, lon } = cellToLatLon(result, result.center, row, col);
  const verdict = result.fail[i] === 0 ? 'passes every check' : `fails: ${describeFail(result.fail[i]).join('; ')}`;
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
