// Solar power at a landing spot: how much of the Sun clears the terrain, how strong sunlight is at that
// distance, and how squarely it hits the panel. Pure functions, no DOM.
//
// The model, in one line (see decision Z in docs/decisions.md):
//
//   P = 1361 W/m² / d² × area × efficiency × cos(angle to panel) × share of the Sun's disc in view × other losses
//
// It is an estimate for the panel the user describes. Left out on purpose: panel temperature, dust, ageing,
// sunlight bounced off nearby slopes (a few percent at most) and the Sun's corona (about a millionth of
// the Sun's light). Eclipses by Earth are not marked.

/** Sunlight at 1 AU, W/m² (total solar irradiance, NASA/NOAA). */
export const SOLAR_CONSTANT_W_M2 = 1361;
/** The Sun's apparent radius seen from the Moon, degrees (its disc is about 0.53° across). */
export const SUN_RADIUS_DEG = 0.267;
const DEG = Math.PI / 180;

/**
 * How the panel is mounted. `cosine` gives how squarely the Sun hits it, from the Sun's elevation.
 * Vertical panels that turn to face the Sun are what polar landers and rovers usually carry, because the
 * Sun sits near the horizon there.
 */
export const MOUNTS = {
  tracking: { label: 'points at the Sun', cosine: () => 1 },
  vertical: { label: 'upright, turns to face the Sun', cosine: (elDeg) => Math.max(0, Math.cos(elDeg * DEG)) },
  flat: { label: 'lying flat', cosine: (elDeg) => Math.max(0, Math.sin(elDeg * DEG)) },
};

/** Example panel, shown to the user as an example to change, not as anyone's real hardware. */
export const EXAMPLE_PANEL = { areaM2: 1, efficiency: 0.3, mount: 'vertical', otherLosses: 0.1, loadW: 50 };

/**
 * Share of the Sun's disc above the terrain, 0–1, treating the skyline as a straight edge across the disc.
 * `clearDeg` is how far the Sun's centre is above the terrain horizon (negative: below).
 * Centre exactly on the skyline gives one half.
 */
export function sunVisibleFraction(clearDeg, radiusDeg = SUN_RADIUS_DEG) {
  if (!Number.isFinite(clearDeg)) return NaN;
  if (clearDeg >= radiusDeg) return 1;
  if (clearDeg <= -radiusDeg) return 0;
  const r = radiusDeg;
  const c = clearDeg;
  return (r * r * Math.acos(-c / r) + c * Math.sqrt(r * r - c * c)) / (Math.PI * r * r);
}

/** Sunlight at a distance from the Sun, W/m² (inverse square). */
export function irradiance(sunDistanceAU) {
  return SOLAR_CONSTANT_W_M2 / (sunDistanceAU * sunDistanceAU);
}

/**
 * Panel output for every sample, watts.
 * @param {object} input
 * @param {ArrayLike<number>} input.sunClear       Sun centre's clearance above the terrain horizon, degrees
 * @param {ArrayLike<number>} input.sunEl          Sun elevation above the level horizon, degrees
 * @param {ArrayLike<number>} input.sunDistanceAU  distance to the Sun, AU
 * @param {{ areaM2: number, efficiency: number, mount: keyof MOUNTS, otherLosses?: number }} input.panel
 * @returns {Float64Array}
 */
export function powerSeries({ sunClear, sunEl, sunDistanceAU, panel }) {
  const n = sunClear.length;
  const out = new Float64Array(n);
  const mount = MOUNTS[panel.mount] ?? MOUNTS.vertical;
  const keep = 1 - (panel.otherLosses ?? 0);
  const perIrradiance = panel.areaM2 * panel.efficiency * keep;
  for (let i = 0; i < n; i++) {
    const visible = sunVisibleFraction(sunClear[i]);
    out[i] = visible > 0 ? irradiance(sunDistanceAU[i]) * perIrradiance * mount.cosine(sunEl[i]) * visible : 0;
  }
  return out;
}

/**
 * Energy over a stay, and the battery it would need for a steady load.
 * Each sample stands for one step of time. The battery figure is the largest shortfall the panel leaves
 * at any point of the stay (the deepest the battery is drawn down from its fullest), starting full.
 * @param {ArrayLike<number>} powerW   from powerSeries
 * @param {number} from               first sample (landing)
 * @param {number} count              samples in the stay
 * @param {number} stepHours
 * @param {number} loadW              what the lander uses all the time
 */
export function energySummary(powerW, from, count, stepHours, loadW = 0) {
  let energyWh = 0;
  let peakW = 0;
  let net = 0;
  let top = 0;
  let deepest = 0;
  let zeroHours = 0;
  const end = Math.min(powerW.length, from + count);
  for (let i = from; i < end; i++) {
    const p = powerW[i];
    energyWh += p * stepHours;
    if (p > peakW) peakW = p;
    if (p <= 0) zeroHours += stepHours;
    net += (p - loadW) * stepHours;
    if (net > top) top = net;
    if (top - net > deepest) deepest = top - net;
  }
  const hours = (end - from) * stepHours;
  return {
    energyWh,
    averageW: hours > 0 ? energyWh / hours : 0,
    peakW,
    zeroHours,
    batteryWh: deepest,
    coversLoad: energyWh >= loadW * hours,
  };
}

/** Hours from sample `from` until a series first drops to or below `limit` (null if it never does in range). */
export function hoursUntilBelow(values, from, limit, stepHours) {
  for (let i = from; i < values.length; i++) if (!(values[i] > limit)) return (i - from) * stepHours;
  return null;
}
