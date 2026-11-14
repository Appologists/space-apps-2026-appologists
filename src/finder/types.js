// The data contract of the landing-site finder: what the browser asks for and what the server answers.
// JSDoc only; nothing to import at run time.
//
// The answer is a set of square rasters covering the search area, north up:
//   index = row * n + col;  row 0 is the NORTH edge, col 0 is the WEST edge.
// Cell (row, col) maps to latitude/longitude with cellToLatLon() in ./grid.js (and back with latLonToCell()).

/**
 * @typedef {Object} FinderParams
 * @property {{lat: number, lon: number}} center   middle of the search area (must be on the terrain data)
 * @property {number} radiusKm                     search radius
 * @property {string} start                        landing time, ISO 8601 UTC
 * @property {number} durationHours                mission length
 * @property {number} stepMinutes                  time step for the Sun/Earth check
 * @property {number} panelHeightM                 solar panel height above the ground
 * @property {number} antennaHeightM               antenna height above the ground
 * @property {number} ellipseRadiusM               landing accuracy: every point within this distance must pass
 * @property {number} maxLandingSlopeDeg           steepest ground the lander accepts
 * @property {number} maxDarknessHours             longest unbroken darkness the rover survives
 * @property {boolean} needSunAtLanding
 * @property {boolean} needEarthAtLanding
 * @property {{sunlight: number, earthComms: number}} weights  same weights as the ranked list
 */

/**
 * @typedef {Object} FoundSite
 * @property {number} rank            1 = best
 * @property {number} lat
 * @property {number} lon
 * @property {number} row
 * @property {number} col
 * @property {number} score           0–1
 * @property {number} sunFraction     share of the mission with the panel in sunlight
 * @property {number} longestLitH     longest unbroken sunlight, hours
 * @property {number} longestDarkH    longest unbroken darkness, hours
 * @property {number} earthFraction   share of the mission with Earth in view of the antenna
 * @property {number} ellipseSlopeDeg steepest slope anywhere in the landing ellipse
 * @property {number} elevationM
 */

/**
 * @typedef {Object} FinderResult
 * Header fields:
 * @property {number} n                 cells per side
 * @property {number} cellM             cell size in metres
 * @property {number} halfSizeM         half the raster's width (n * cellM / 2)
 * @property {{lat: number, lon: number}} center
 * @property {number} radiusKm
 * @property {number} groundHeightM     height of the centre
 * @property {number} stepHours
 * @property {number} steps
 * @property {number} windowHours
 * @property {FinderParams} params      what was asked, with defaults filled in
 * @property {FoundSite[]} sites        best passing sites, spaced apart
 * @property {{evaluated: number, passing: number, slope: number, noSun: number, dark: number, noEarth: number}} counts
 *           cells inside the search circle: evaluated, passing, and failing each check (a cell can fail several)
 * @property {number} computeMs
 * @property {string} dataset
 * Rasters (each n * n long):
 * @property {Float32Array} elevation     metres above the mean radius; NaN = no data
 * @property {Float32Array} slope         degrees, at the cell
 * @property {Float32Array} ellipseSlope  degrees, steepest within the landing ellipse around the cell
 * @property {Float32Array} sunFraction   0–1
 * @property {Float32Array} longestLitH   hours
 * @property {Float32Array} longestDarkH  hours
 * @property {Float32Array} earthFraction 0–1
 * @property {Uint8Array}   fail          0 = passes; otherwise a sum of the FAIL bits in ./score.js
 * @property {Float32Array} score         0–1 where fail is 0, NaN elsewhere
 */

export {};
