// Coordinates and small vector helpers. No dependencies, so this runs in the browser, in Node and in tests.
//
// Moon-fixed frame used everywhere in this project (the "mean Earth / polar axis" frame, same as LRO maps
// and JPL Horizons' MEAN_ME):
//   +X  through latitude 0°, longitude 0°  (the mean point facing Earth)
//   +Y  through latitude 0°, longitude 90° E
//   +Z  through the north pole
// Latitude is positive north. Longitude is positive east, kept in (-180°, 180°].
// Vectors are plain arrays [x, y, z].

export const MOON_RADIUS_KM = 1737.4; // reference sphere used by LOLA and Horizons
export const AU_KM = 149597870.7;
export const DEG = Math.PI / 180;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => scale(a, 1 / norm(a));
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Latitude/longitude in degrees to a vector of length r in the Moon-fixed frame. */
export function latLonToVec(latDeg, lonDeg, r = 1) {
  const la = latDeg * DEG;
  const lo = lonDeg * DEG;
  return [r * Math.cos(la) * Math.cos(lo), r * Math.cos(la) * Math.sin(lo), r * Math.sin(la)];
}

/** Direction of a Moon-fixed vector as latitude/longitude in degrees. */
export function vecToLatLon(v) {
  const n = normalize(v);
  return { lat: Math.asin(clamp(n[2], -1, 1)) / DEG, lon: Math.atan2(n[1], n[0]) / DEG };
}

/** Longitude wrapped to (-180, 180]. */
export function wrapLon(lonDeg) {
  if (lonDeg > -180 && lonDeg <= 180) return lonDeg;
  const w = ((((lonDeg + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
}

/** Longitude on the 0–360° E scale that many lunar datasets use. */
export const lon360 = (lonDeg) => ((lonDeg % 360) + 360) % 360;

/** Great-circle angle between two lat/lon points, degrees. */
export function angularDistanceDeg(a, b) {
  return Math.acos(clamp(dot(latLonToVec(a.lat, a.lon), latLonToVec(b.lat, b.lon)), -1, 1)) / DEG;
}
