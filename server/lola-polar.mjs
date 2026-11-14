// Reads a LOLA polar elevation grid (NASA PDS, "LDEM_80S_80M" and friends) and samples it.
// Node only: this runs inside the dev server (server/terrain-plugin.mjs) and in scripts, never in the browser.
//
// The grid is a south polar stereographic map of 16-bit integers. From the PDS label:
//   height in metres = value × SCALING_FACTOR, relative to a sphere of radius OFFSET (1737.4 km)
//   pixel spacing MAP_SCALE metres; the pole sits at (SAMPLE_PROJECTION_OFFSET, LINE_PROJECTION_OFFSET)
//   longitude 0° points up the image, 90° E points right (checked against known craters in tests).
import { readFile } from 'node:fs/promises';
import { DEFAULT_AZIMUTHS, destination, ringDistances } from '../src/terrain/polar-grid.js';

const DEG = Math.PI / 180;

/** Pull the numbers we need out of a PDS3 label. */
export function parseLabel(text) {
  const num = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(-?[0-9.]+)`, 'm'));
    if (!m) throw new Error(`Label has no ${key}`);
    return parseFloat(m[1]);
  };
  const str = (key) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))?.[1] ?? null;
  const label = {
    lines: num('LINES'),
    samples: num('LINE_SAMPLES'),
    sampleBits: num('SAMPLE_BITS'),
    sampleType: str('SAMPLE_TYPE'),
    scalingFactor: num('SCALING_FACTOR'),
    radiusM: num('OFFSET'),
    projection: str('MAP_PROJECTION_TYPE'),
    centerLat: num('CENTER_LATITUDE'),
    centerLon: num('CENTER_LONGITUDE'),
    scaleM: num('MAP_SCALE'),
    edgeLat: num('MAXIMUM_LATITUDE'),
    lineOffset: num('LINE_PROJECTION_OFFSET'),
    sampleOffset: num('SAMPLE_PROJECTION_OFFSET'),
  };
  if (label.projection !== 'POLAR STEREOGRAPHIC' || label.centerLat !== -90 || label.centerLon !== 0) {
    throw new Error('Only south polar stereographic grids centred on 0° longitude are supported so far');
  }
  if (label.sampleBits !== 16 || label.sampleType !== 'LSB_INTEGER') throw new Error('Expected 16-bit little-endian integers');
  return label;
}

/** Latitude/longitude to fractional pixel position (0-based: x across, y down). */
export function latLonToPixel(label, latDeg, lonDeg) {
  const r = 2 * label.radiusM * Math.tan(((90 + latDeg) / 2) * DEG); // distance from the pole on the map plane
  const lo = lonDeg * DEG;
  return {
    x: (r * Math.sin(lo)) / label.scaleM + label.sampleOffset,
    y: label.lineOffset - (r * Math.cos(lo)) / label.scaleM,
  };
}

/**
 * @param {{label: ReturnType<typeof parseLabel>, data: Int16Array}} dem
 * @returns {number} height in metres relative to the reference sphere, or NaN outside the grid
 */
export function heightAt(dem, latDeg, lonDeg) {
  const { label, data } = dem;
  const { x, y } = latLonToPixel(label, latDeg, lonDeg);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  if (x0 < 0 || y0 < 0 || x0 >= label.samples - 1 || y0 >= label.lines - 1) return NaN;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * label.samples + x0;
  const top = data[i] * (1 - fx) + data[i + 1] * fx;
  const bottom = data[i + label.samples] * (1 - fx) + data[i + label.samples + 1] * fx;
  return (top * (1 - fy) + bottom * fy) * label.scalingFactor;
}

/** Load a grid into memory (the 80 m file is 115 MB; it loads in a fraction of a second). */
export async function openLolaPolar({ imgPath, lblPath, id = 'lola' }) {
  const label = parseLabel(await readFile(lblPath, 'latin1'));
  const buffer = await readFile(imgPath);
  if (buffer.length !== label.lines * label.samples * 2) throw new Error(`${imgPath} is ${buffer.length} bytes; the label expects ${label.lines * label.samples * 2}`);
  const aligned = buffer.byteOffset % 2 === 0 ? buffer : Buffer.from(buffer);
  return { id, label, data: new Int16Array(aligned.buffer, aligned.byteOffset, aligned.length / 2) };
}

/** Does the grid cover this point? */
export const covers = (dem, latDeg, lonDeg) => !Number.isNaN(heightAt(dem, latDeg, lonDeg));

/**
 * Sample the terrain around a point on the polar grid described in src/terrain/polar-grid.js.
 * @returns {import('../src/terrain/polar-grid.js').TerrainPatch|null} null if the point is outside the grid
 */
export function samplePolarPatch(dem, latDeg, lonDeg, { nAz = DEFAULT_AZIMUTHS, distances = ringDistances() } = {}) {
  const groundHeightM = heightAt(dem, latDeg, lonDeg);
  if (Number.isNaN(groundHeightM)) return null;
  const heights = new Float32Array(distances.length * nAz);
  let withData = 0;
  let dataEdgeM = Infinity; // nearest distance at which any spoke runs off the grid
  for (let k = 0; k < distances.length; k++) {
    for (let j = 0; j < nAz; j++) {
      const p = destination(latDeg, lonDeg, (j * 360) / nAz, distances[k]);
      const h = heightAt(dem, p.lat, p.lon);
      heights[k * nAz + j] = h;
      if (Number.isNaN(h)) dataEdgeM = Math.min(dataEdgeM, distances[k]);
      else withData++;
    }
  }
  return {
    lat: latDeg,
    lon: lonDeg,
    groundHeightM,
    nAz,
    distances,
    heights,
    coverage: withData / heights.length,
    dataEdgeM: Number.isFinite(dataEdgeM) ? dataEdgeM : null,
    dataset: dem.id,
    pixelM: dem.label.scaleM,
  };
}
