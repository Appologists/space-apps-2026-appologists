// Where the Sun and Earth are, as seen from the Moon, in the Moon-fixed frame (see coords.js).
//
// Source: Astronomy Engine (https://github.com/cosinekitty/astronomy), about 1 arcminute accuracy, runs locally
// with no network. The Moon's orientation is the IAU/WGCCRE rotation model (RotationAxis).
// Checked against JPL Horizons: see tools/check-horizons.mjs and tests/astro.test.js.
import { Body, GeoMoon, GeoVector, Illumination, MakeTime, MoonPhase, RotationAxis } from 'astronomy-engine';
import { AU_KM, DEG, cross, dot, normalize, scale, add, vecToLatLon, norm } from './coords.js';

/** Unit vectors of the Moon-fixed axes, expressed in J2000 equatorial coordinates (EQJ). */
export function moonAxesEQJ(time) {
  const axis = RotationAxis(Body.Moon, time);
  const Z = normalize([axis.north.x, axis.north.y, axis.north.z]);
  // Ascending node of the Moon's equator on the J2000 equator, then spin by the prime-meridian angle W.
  const node = normalize(cross([0, 0, 1], Z));
  const inPlane = cross(Z, node);
  const W = axis.spin * DEG;
  const X = add(scale(node, Math.cos(W)), scale(inPlane, Math.sin(W)));
  return { X, Y: cross(Z, X), Z };
}

/**
 * Sun and Earth positions relative to the Moon's centre at one instant.
 * @param {Date} date
 * @returns {{date: Date, sunKm: number[], earthKm: number[], sunDistanceAU: number}} vectors in the Moon-fixed frame, km
 */
export function sunEarthFromMoon(date) {
  const time = MakeTime(date);
  const moon = GeoMoon(time); // Earth → Moon, AU, EQJ
  const sun = GeoVector(Body.Sun, time, true); // Earth → Sun, AU, EQJ (light-time and aberration applied)
  const axes = moonAxesEQJ(time);
  const toMoonFrame = (v) => [dot(v, axes.X), dot(v, axes.Y), dot(v, axes.Z)];
  const sunKm = scale(toMoonFrame([sun.x - moon.x, sun.y - moon.y, sun.z - moon.z]), AU_KM);
  const earthKm = scale(toMoonFrame([-moon.x, -moon.y, -moon.z]), AU_KM);
  return { date, sunKm, earthKm, sunDistanceAU: norm(sunKm) / AU_KM };
}

/** The points on the Moon with the Sun, and with Earth, straight overhead. */
export function subPoints(eph) {
  return { subSolar: vecToLatLon(eph.sunKm), subEarth: vecToLatLon(eph.earthKm) };
}

/**
 * Sun/Earth positions at evenly spaced times. This is the expensive part and does not depend on the site,
 * so compute it once per mission window and reuse it for every site.
 * @returns {{start: Date, stepHours: number, samples: ReturnType<typeof sunEarthFromMoon>[]}}
 */
export function ephemerisSeries(start, durationHours, stepMinutes) {
  const stepMs = stepMinutes * 60_000;
  const count = Math.floor((durationHours * 3_600_000) / stepMs) + 1;
  const samples = new Array(count);
  for (let i = 0; i < count; i++) samples[i] = sunEarthFromMoon(new Date(start.getTime() + i * stepMs));
  return { start, stepHours: stepMinutes / 60, samples };
}

/** Moon phase as seen from Earth: angle 0–360° (0 new, 180 full) and lit fraction 0–1. */
export function moonPhase(date) {
  const time = MakeTime(date);
  return { angleDeg: MoonPhase(time), litFraction: Illumination(Body.Moon, time).phase_fraction };
}
