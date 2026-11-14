// The sky from a point on the Moon: elevation and azimuth of the Sun and Earth, and when they are up.
//
// The horizon here is the ideal one of a smooth sphere. Real terrain (ridges, crater rims) is NOT included yet;
// when it is, it plugs in as a per-azimuth horizon elevation that replaces the flat threshold in visibilityStats.
import { MOON_RADIUS_KM, DEG, clamp, dot, latLonToVec, norm, scale, sub } from './coords.js';
import { sunEarthFromMoon } from './ephemeris.js';

/**
 * @typedef {Object} Site
 * @property {number} lat         degrees, north positive
 * @property {number} lon         degrees, east positive
 * @property {number} [elevationM] ground height above the 1737.4 km reference sphere (0 if unknown)
 */

/** Local east / north / up unit vectors at a site, in the Moon-fixed frame. */
export function siteAxes(lat, lon) {
  const la = lat * DEG;
  const lo = lon * DEG;
  return {
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
  };
}

/**
 * Elevation above the ideal horizon and azimuth (clockwise from north, like a compass) of a body.
 * @param {Site} site
 * @param {number[]} bodyKm body position relative to the Moon's centre, Moon-fixed frame, km
 */
export function altAz(site, bodyKm) {
  const axes = siteAxes(site.lat, site.lon);
  const sitePos = scale(axes.up, MOON_RADIUS_KM + (site.elevationM ?? 0) / 1000);
  const toBody = sub(bodyKm, sitePos);
  const range = norm(toBody);
  const e = dot(toBody, axes.east);
  const n = dot(toBody, axes.north);
  const u = dot(toBody, axes.up);
  return {
    elevation: Math.asin(clamp(u / range, -1, 1)) / DEG,
    azimuth: ((Math.atan2(e, n) / DEG) + 360) % 360,
    rangeKm: range,
  };
}

/**
 * How far the horizon drops when you look from a height above the ground, on a smooth sphere.
 * A 2 m mast sees 0.09° below the flat horizon; near the poles that is worth hours of sunlight.
 */
export function horizonDipDeg(heightM) {
  if (!(heightM > 0)) return 0;
  return Math.acos(MOON_RADIUS_KM / (MOON_RADIUS_KM + heightM / 1000)) / DEG;
}

/** Sun and Earth in a site's sky at one instant. */
export function skyAt(site, date) {
  const eph = sunEarthFromMoon(date);
  return { date, sun: altAz(site, eph.sunKm), earth: altAz(site, eph.earthKm), sunDistanceAU: eph.sunDistanceAU };
}

/**
 * Sun and Earth elevation at a site for every sample of an ephemeris series.
 * @param {Site} site
 * @param {ReturnType<import('./ephemeris.js').ephemerisSeries>} series
 */
export function skySeries(site, series) {
  const n = series.samples.length;
  const sunEl = new Float64Array(n);
  const sunAz = new Float64Array(n);
  const earthEl = new Float64Array(n);
  const earthAz = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = altAz(site, series.samples[i].sunKm);
    const e = altAz(site, series.samples[i].earthKm);
    sunEl[i] = s.elevation;
    sunAz[i] = s.azimuth;
    earthEl[i] = e.elevation;
    earthAz[i] = e.azimuth;
  }
  return { start: series.start, stepHours: series.stepHours, sunEl, sunAz, earthEl, earthAz };
}

/**
 * When is a body above a threshold elevation?
 * Times are rounded to the sampling step (a 30-minute step gives rise/set times good to about 30 minutes).
 * @param {ArrayLike<number>} elevations degrees, evenly sampled
 * @param {number} thresholdDeg          "up" means elevation > threshold
 * @param {number} stepHours
 */
export function visibilityStats(elevations, thresholdDeg, stepHours) {
  const n = elevations.length;
  const runs = [];
  let upCount = 0;
  let runStart = -1;
  for (let i = 0; i < n; i++) {
    const up = elevations[i] > thresholdDeg;
    if (up) {
      upCount++;
      if (runStart < 0) runStart = i;
    }
    if ((!up || i === n - 1) && runStart >= 0) {
      const end = up ? i : i - 1;
      runs.push({ startIndex: runStart, endIndex: end, startHours: runStart * stepHours, hours: (end - runStart) * stepHours });
      runStart = -1;
    }
  }
  const windowHours = Math.max(n - 1, 0) * stepHours;
  const longest = runs.reduce((best, r) => (r.hours > best.hours ? r : best), { hours: 0, startHours: 0 });
  const upAtStart = n > 0 && elevations[0] > thresholdDeg;
  // Hours from the start of the window until the state flips; null if it never flips inside the window.
  let hoursUntilChange = null;
  for (let i = 1; i < n; i++) {
    if (elevations[i] > thresholdDeg !== upAtStart) {
      hoursUntilChange = i * stepHours;
      break;
    }
  }
  return {
    windowHours,
    fraction: n > 0 ? upCount / n : 0,
    upHours: n > 1 ? (upCount / n) * windowHours : 0,
    longestRunHours: Math.min(longest.hours, windowHours),
    longestRunStartHours: longest.startHours,
    interruptions: Math.max(runs.length - 1, 0),
    runs,
    upAtStart,
    hoursUntilChange,
  };
}
