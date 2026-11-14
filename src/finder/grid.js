// The landing-site finder's map grid: a square raster centred on the search centre, north up.
// A cell's position is its distance east and north of the centre, measured along the ground, so the
// raster is a small flat map (azimuthal equidistant) that is true to scale near its middle.
// Shared by the server and the browser: no Node or browser APIs here.
import { DEG, MOON_RADIUS_KM } from '../astro/coords.js';
import { destination } from '../terrain/polar-grid.js';

const R = MOON_RADIUS_KM * 1000;

/**
 * Raster for a search radius: about 400 cells across at most, and never finer than the 80 m terrain data.
 * @returns {{n: number, cellM: number, halfSizeM: number}}
 */
export function searchGrid(radiusKm) {
  const width = 2 * radiusKm * 1000;
  const cellM = Math.max(80, Math.ceil(width / 400 / 20) * 20);
  const n = Math.ceil(width / cellM / 2) * 2; // even, so the centre sits on a cell corner
  return { n, cellM, halfSizeM: (n * cellM) / 2 };
}

/** Metres east and north of the centre for the middle of a cell. Row 0 is the north edge, column 0 the west edge. */
export function cellOffset(grid, row, col) {
  return { east: (col + 0.5) * grid.cellM - grid.halfSizeM, north: grid.halfSizeM - (row + 0.5) * grid.cellM };
}

/** Latitude/longitude of the point `east` and `north` metres from the centre. */
export function offsetToLatLon(center, east, north) {
  const d = Math.hypot(east, north);
  if (d < 1e-6) return { lat: center.lat, lon: center.lon };
  return destination(center.lat, center.lon, Math.atan2(east, north) / DEG, d);
}

export function cellToLatLon(grid, center, row, col) {
  const { east, north } = cellOffset(grid, row, col);
  return offsetToLatLon(center, east, north);
}

/** The reverse: metres east and north of the centre for a latitude/longitude. */
export function latLonToOffset(center, lat, lon) {
  const p1 = center.lat * DEG;
  const p2 = lat * DEG;
  const dLon = (lon - center.lon) * DEG;
  // Haversine distance: stays accurate for the short distances and near-polar latitudes used here.
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  const bearing = Math.atan2(Math.sin(dLon) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon));
  return { east: d * Math.sin(bearing), north: d * Math.cos(bearing) };
}

/** Which cell holds a latitude/longitude, or null if it is off the raster. */
export function latLonToCell(grid, center, lat, lon) {
  const { east, north } = latLonToOffset(center, lat, lon);
  const col = Math.floor((east + grid.halfSizeM) / grid.cellM);
  const row = Math.floor((grid.halfSizeM - north) / grid.cellM);
  return row < 0 || col < 0 || row >= grid.n || col >= grid.n ? null : { row, col };
}
