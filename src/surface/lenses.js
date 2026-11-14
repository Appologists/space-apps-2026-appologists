// Lenses for the surface view: ways to colour the ground by a measured quantity instead of by sunlight.
//
// Colour rules (so every lens reads the same way):
//   - A lens shows "how much", so each uses ONE hue running dark to light. Never a rainbow.
//   - The view is dark (black sky), so low values are dark and recede, high values are light and stand out.
//   - Lens colours are drawn flat, with no sunlight, shadow or grain on top: brightness is the data.
//   - Ground with no data is neutral grey, which belongs to no ramp.
// Both ramps step through the same lightness values, checked in tests/lenses.test.js.
//
// No browser or three.js code here, so this runs in tests.

/** Dark to light. Blue is the default hue for "how much"; orange is the second, used for slope. */
export const BLUE_RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb'];
export const ORANGE_RAMP = ['#621d00', '#752500', '#8a2e00', '#9e3601', '#b53e00', '#c74b12', '#d85a27', '#e96a38', '#f97948', '#fe9068', '#ffa98a', '#ffbfa9', '#fed5c7'];
export const NO_DATA_HEX = '#3a3a37';

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** '#rrggbb' to linear-light [r, g, b], which is what the renderer's vertex colours expect. */
export const hexToLinear = (hex) => [1, 3, 5].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255));
const toHex = (linear) =>
  `#${linear.map((c) => Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) * 255).toString(16).padStart(2, '0')).join('')}`;

/** Colour at position t (0–1) along a ramp, as linear [r, g, b]. */
export function rampColor(ramp, t) {
  const f = Math.min(Math.max(t, 0), 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(f), ramp.length - 2);
  const a = hexToLinear(ramp[i]);
  const b = hexToLinear(ramp[i + 1]);
  return a.map((v, c) => v + (b[c] - v) * (f - i));
}

/**
 * The range of heights to spread the elevation colours over: the middle 96% of the terrain within 100 km,
 * rounded outward to whole hundreds of metres, so one odd peak does not flatten everything else.
 * @param {import('../terrain/polar-grid.js').TerrainPatch} patch
 */
export function elevationDomain(patch, withinM = 100_000) {
  const rings = patch.distances.findIndex((d) => d > withinM);
  const end = (rings < 0 ? patch.distances.length : rings) * patch.nAz;
  const values = [];
  for (let i = 0; i < end; i += 7) if (!Number.isNaN(patch.heights[i])) values.push(patch.heights[i]);
  values.push(patch.groundHeightM);
  values.sort((a, b) => a - b);
  const at = (q) => values[Math.round(q * (values.length - 1))];
  const min = Math.floor(at(0.02) / 100) * 100;
  const max = Math.ceil(at(0.98) / 100) * 100;
  return { min, max: max > min ? max : min + 100 };
}

/** Slopes at or above this get the lightest colour. Few vehicles are meant for anything steeper. */
export const SLOPE_MAX_DEG = 40;

const CONTOUR_NOTE = 'Lines join points of equal height: thin every 10 m, thick every 100 m. Faint rings mark every 10 m, 100 m and 1 km from you.';

const metres = (m) => `${m < 0 ? '−' : ''}${Math.abs(Math.round(m)).toLocaleString('en-US')} m`;

/**
 * @typedef {Object} Lens
 * @property {string} id
 * @property {string} label    on the switch
 * @property {(patch: import('../terrain/polar-grid.js').TerrainPatch) => {
 *   color: (value: number) => ArrayLike<number>,  linear [r, g, b] for a value
 *   legend: {title: string, note: string, kind: 'ramp', stops: {hex: string, label?: string}[], positioned?: boolean, marker?: {at: number, label: string}}
 * }} [build]  absent for the natural view
 * @property {(patch: import('../terrain/polar-grid.js').TerrainPatch, vertex: number) => number} [value]
 */

/** @type {Lens[]} */
export const LENSES = [
  { id: 'natural', label: 'Sunlight' },
  {
    id: 'elevation',
    label: 'Elevation',
    // Vertex 0 is the ground under the viewer; vertex v > 0 is sample v − 1 of the patch.
    value: (patch, v) => (v === 0 ? patch.groundHeightM : patch.heights[v - 1]),
    build(patch) {
      const { min, max } = elevationDomain(patch);
      const t = (h) => (h - min) / (max - min);
      const stops = Array.from({ length: 25 }, (_, i) => ({ hex: toHex(rampColor(BLUE_RAMP, i / 24)) }));
      stops[0].label = metres(min);
      stops[12].label = metres((min + max) / 2);
      stops[24].label = metres(max);
      // A 256-step lookup, so colouring half a million vertices allocates nothing.
      const lookup = Array.from({ length: 256 }, (_, i) => rampColor(BLUE_RAMP, i / 255));
      return {
        color: (h) => lookup[Math.round(Math.min(Math.max(t(h), 0), 1) * 255)],
        legend: {
          title: 'Elevation',
          note: `Height above the Moon’s mean radius (1,737.4 km). Colours span the terrain within 100 km of you. ${CONTOUR_NOTE}`,
          kind: 'ramp',
          stops,
          marker: { at: Math.min(Math.max(t(patch.groundHeightM), 0), 1), label: `You: ${metres(patch.groundHeightM)}` },
        },
      };
    },
  },
  {
    id: 'slope',
    label: 'Slope',
    value: (patch, v) => (v === 0 ? (patch.groundSlopeDeg ?? NaN) : patch.slopes ? patch.slopes[v - 1] : NaN),
    build(patch) {
      const lookup = Array.from({ length: 256 }, (_, i) => rampColor(ORANGE_RAMP, i / 255));
      const stops = Array.from({ length: 25 }, (_, i) => ({ hex: toHex(rampColor(ORANGE_RAMP, i / 24)) }));
      [0, 10, 20, 30].forEach((deg) => (stops[Math.round((deg / SLOPE_MAX_DEG) * 24)].label = `${deg}°`));
      stops[24].label = `${SLOPE_MAX_DEG}°+`; // steeper ground shares the lightest colour
      return {
        color: (deg) => lookup[Math.round(Math.min(Math.max(deg / SLOPE_MAX_DEG, 0), 1) * 255)],
        legend: {
          title: 'Slope',
          note: `Steepness measured over ${patch.pixelM ?? 80} m, one terrain pixel: rocks and small craters do not show. ${CONTOUR_NOTE}`,
          kind: 'ramp',
          stops,
          positioned: true, // tick labels sit at their place on the scale, not evenly spread
        },
      };
    },
  },
];

export const lensById = (id) => LENSES.find((l) => l.id === id) ?? LENSES[0];
