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
  { id: 'earth', label: 'Earth link' },
  { id: 'slope', label: 'Slope' },
  { id: 'reach', label: 'Reach' },
];

/**
 * Not in the list above: the map at one moment of the mission, sunlit ground against ground in shadow.
 * It can be chosen like a layer, and any other layer gives way to it while the map has a time step
 * (see map-view.js setTime). Pass the time step as `extra.step`.
 */
export const TIME_LAYER = 'time';

/**
 * Not in the list above either: the one map (Daniel, 2026-11-14), which shows sunlight, steepness and landing
 * ground together. Brightness is sunlight at one moment (the landing hour unless the map is given a time step);
 * colour marks steep ground in the route's colours, and ground under 10 degrees is left plain; landing ground is
 * blue with a bright outline, a lighter blue where it has more room to miss. It is drawn finer than the search's cells (ALL_SCALE picture pixels per cell side),
 * with the shading and the slope smoothed between cells, so it is built as whole pictures: allPictures() and
 * composeAll() below. This is a picture of three yes-or-no facts, not a lens: it does not follow the lens rules.
 */
export const ALL_LAYER = 'all';
export const ALL_SCALE = 3;

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
 * The range the landing ground's blues run over, in metres of room to miss: from the landing accuracy (a spot
 * that only just passes) to the most room any passing cell of this result has. Kept per result.
 */
const roomRanges = new WeakMap();
export function roomRange(result) {
  let range = roomRanges.get(result);
  if (!range) {
    const lo = result.params?.ellipseRadiusM ?? 0;
    let hi = lo;
    if (result.room) for (let i = 0; i < result.fail.length; i++) if (result.fail[i] === 0 && result.room[i] > hi) hi = result.room[i];
    range = { lo, hi };
    roomRanges.set(result, range);
  }
  return range;
}
/** Where a cell's room to miss falls in that range, 0–1. 0 where the result has no room raster. */
const roomShare = (result, index) => {
  const { lo, hi } = roomRange(result);
  return hi > lo && result.room ? Math.min(Math.max((result.room[index] - lo) / (hi - lo), 0), 1) : 0;
};

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
      if (fail === 0) return at(BLUE, roomShare(result, index)); // lighter = more room to miss
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

// ---- The one map -------------------------------------------------------------------------------------------------
// Landing ground on the one map takes the upper part of the blue ramp, so its darkest blue in sunlight is still
// lighter than any shadow, and it is dimmed in shadow so that it never is as bright as sunlit ground (tested).
const LANDING_FROM = 0.35;
const LANDING_IN_SHADOW = 0.28;
const LANDING_EDGE = [150, 215, 255];
const LANDING_CASING = [6, 12, 30];

/**
 * Colour of a piece of ground on the one map, sRGB [r, g, b] (0-255).
 * @param {number} light     1 = in sunlight, 0 = in shadow (values between blend the two)
 * @param {number} shade     hillshade there, 0-255: it changes brightness a little, never the hue
 * @param {number} slopeDeg  under 10 degrees the ground is a plain grey; steeper ground takes its slope band's colour
 * @param {number|null} room landing ground: where its room to miss falls between the least and the most, 0–1
 *                           (lighter blue = more room; drawn flat). null for ground that is not landing ground
 */
export function allPixel(light, shade, slopeDeg, room = null) {
  const lit = [0, 0, 0];
  const dark = [0, 0, 0];
  groundInto(lit, dark, 0, shade, slopeDeg, room);
  const t = Math.min(Math.max(light, 0), 1);
  return lit.map((v, k) => Math.round(dark[k] + (v - dark[k]) * t));
}

const BAND_LIST = SLOPE_BANDS.map((band) => ({ maxDeg: band.maxDeg, rgb: [1, 3, 5].map((i) => parseInt(band.hex.slice(i, i + 2), 16)) }));

/** The colour of ground in full sunlight and in shadow, written into `lit` and `dark` at `at` (no new arrays: this runs per pixel). */
function groundInto(lit, dark, at_, shade, slopeDeg, room) {
  if (room != null) {
    const blue = at(BLUE, LANDING_FROM + (1 - LANDING_FROM) * room);
    for (let k = 0; k < 3; k++) {
      lit[at_ + k] = blue[k];
      dark[at_ + k] = Math.round(blue[k] * LANDING_IN_SHADOW);
    }
    return;
  }
  const s = shade / 255;
  let band = 0;
  while (band < BAND_LIST.length - 1 && !(slopeDeg < BAND_LIST[band].maxDeg)) band++;
  if (Number.isNaN(slopeDeg)) band = 0;
  const rgb = BAND_LIST[band].rgb;
  for (let k = 0; k < 3; k++) {
    // Plain ground: a light grey in sunlight (a little warm), a near-black in shadow (a little blue).
    lit[at_ + k] = Math.round(band === 0 ? (96 + s * 140) * (k === 2 ? 0.94 : 1) : rgb[k] * (0.72 + 0.28 * s));
    dark[at_ + k] = Math.round(band === 0 ? (14 + s * 30) * (k === 2 ? 1.25 : 1) : rgb[k] * (0.15 + 0.07 * s));
  }
}

/**
 * The one map's two pictures of a search result, one with every cell in sunlight and one with every cell in
 * shadow, `scale` picture pixels per cell side. composeAll() then picks between them cell by cell for a moment
 * of the mission, which is quick enough to do on every step of the playback.
 * The hillshade and the slope are blended between cell centres (a drawing aid: the data is still one value per
 * cell); sunlight and the landing verdict keep the cells' own edges.
 * @param {import('./types.js').FinderResult} result
 * @param {Uint8Array} shade  hillshade(result.elevation, ...)
 * @returns {{size: number, scale: number, lit: Uint8ClampedArray, dark: Uint8ClampedArray}} RGBA, size * size pixels each
 */
export function allPictures(result, shade, scale = ALL_SCALE) {
  const { n, elevation, slope, fail } = result;
  const size = n * scale;
  const lit = new Uint8ClampedArray(size * size * 4).fill(255); // alpha stays 255; the colours are written below
  const dark = new Uint8ClampedArray(size * size * 4).fill(255);
  const missing = (i) => Number.isNaN(elevation[i]);
  // Value of a per-cell array at a point given in cells (cell centres are at .5), blended from the four cells around.
  const blend = (values, x, y) => {
    const fx = Math.min(Math.max(x - 0.5, 0), n - 1);
    const fy = Math.min(Math.max(y - 0.5, 0), n - 1);
    const c = Math.min(Math.floor(fx), n - 2);
    const r = Math.min(Math.floor(fy), n - 2);
    const i = r * n + c;
    if (n < 2 || missing(i) || missing(i + 1) || missing(i + n) || missing(i + n + 1)) return values[Math.min(Math.floor(y), n - 1) * n + Math.min(Math.floor(x), n - 1)];
    const u = fx - c;
    const v = fy - r;
    return values[i] * (1 - u) * (1 - v) + values[i + 1] * u * (1 - v) + values[i + n] * (1 - u) * v + values[i + n + 1] * u * v;
  };
  const passes = (x, y) => x >= 0 && y >= 0 && x < size && y < size && fail[Math.floor(y / scale) * n + Math.floor(x / scale)] === 0;
  // Cells that are landing ground or touch some: only their pixels can be on the outline.
  const nearLanding = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (fail[i] !== 0) continue;
    const row = Math.floor(i / n);
    const col = i % n;
    for (let r = Math.max(row - 1, 0); r <= Math.min(row + 1, n - 1); r++) for (let c = Math.max(col - 1, 0); c <= Math.min(col + 1, n - 1); c++) nearLanding[r * n + c] = 1;
  }
  const put = (at, rgb) => {
    for (let k = 0; k < 3; k++) lit[at + k] = dark[at + k] = rgb[k];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const cell = Math.floor(y / scale) * n + Math.floor(x / scale);
      if (missing(cell)) {
        put(at, BACKGROUND);
        continue;
      }
      const landing = fail[cell] === 0;
      if (nearLanding[cell]) {
        // Landing ground's outline: two bright pixels just inside its edge, one dark pixel just outside.
        const d = landing ? 2 : 1;
        const all = passes(x - d, y) && passes(x + d, y) && passes(x, y - d) && passes(x, y + d);
        const any = passes(x - d, y) || passes(x + d, y) || passes(x, y - d) || passes(x, y + d);
        if (landing ? !all : any) {
          put(at, landing ? LANDING_EDGE : LANDING_CASING);
          continue;
        }
      }
      const cx = (x + 0.5) / scale;
      const cy = (y + 0.5) / scale;
      const sh = blend(shade, cx, cy);
      const deg = blend(slope, cx, cy);
      groundInto(lit, dark, at, sh, deg, landing ? roomShare(result, cell) : null);
    }
  }
  return { size, scale, lit, dark };
}

/**
 * The one map at one time step: each cell's block of pixels copied from the sunlit or the shadowed picture.
 * @param {ReturnType<typeof allPictures>} pictures
 * @param {import('./types.js').FinderResult} result  for its sunMask; without one, every cell is drawn in shadow
 * @param {number} step
 * @param {Uint8ClampedArray} out  RGBA, the size of the pictures
 */
export function composeAll(pictures, result, step, out) {
  const { size, scale } = pictures;
  const { n, sunMask, maskStride } = result;
  const lit = new Uint32Array(pictures.lit.buffer);
  const dark = new Uint32Array(pictures.dark.buffer);
  const to = new Uint32Array(out.buffer, out.byteOffset, size * size);
  const base = step * maskStride;
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const i = row * n + col;
      const from = sunMask && (sunMask[base + (i >> 3)] >> (i & 7)) & 1 ? lit : dark;
      for (let dy = 0; dy < scale; dy++) {
        const start = (row * scale + dy) * size + col * scale;
        for (let k = start; k < start + scale; k++) to[k] = from[k];
      }
    }
  }
}

const rgbHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

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
        title: 'Earth link',
        note: 'How much of the mission Earth is in view of the antenna.',
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
    case ALL_LAYER:
      return {
        title: 'Sunlight, slope and landing ground',
        note: 'Brightness is sunlight at the time shown. Colour marks steep ground, in the route\'s colours; ground under 10° is left plain. Blue ground passes every landing check; lighter blue has more room to miss. The soft shading only shows the shape of the ground; it and the slope colours are smoothed between the search\'s cells.',
        stops: [],
        swatches: [
          { hex: rgbHex(allPixel(1, 150, 0)), label: 'in sunlight' },
          { hex: rgbHex(allPixel(0, 150, 0)), label: 'in shadow' },
          ...SLOPE_BANDS.slice(1).map((band) => ({ hex: rgbHex(allPixel(1, 200, band.maxDeg === Infinity ? 90 : band.maxDeg - 1)), label: `slope ${band.label}` })),
          { hex: rgbHex(allPixel(1, 150, 0, 0.5)), label: 'landing ground' },
        ],
      };
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
    default: {
      const { lo, hi } = result ? roomRange(result) : { lo: 0, hi: 0 };
      const m = (v) => `${Math.round(v / 10) * 10} m`;
      return {
        title: 'Landing sites',
        note: 'Blue ground passes every check. Lighter blue has more room to miss: the nearest ground that fails a check is farther away. Measured between the search\'s cells, so it knows nothing of rocks or craters smaller than a cell. Grey ground fails at least one check.',
        stops: withLabels(blue, hi > lo ? `${m(lo)} room to miss` : 'less room to miss', hi > lo ? m(hi) : 'more'),
        swatches: [
          { hex: FAIL_GREY_HEX, label: 'fails a check' },
          { hex: NOT_CHECKED_HEX, label: 'not checked: outside the search circle' },
        ],
      };
    }
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
      ? `passes every check${result.room ? `, room to miss ${Math.round(result.room[i])} m` : ''}`
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
