// Reads a whole-Moon elevation map that comes as sixteen tiles too big to load: NASA's LOLA "LDEM_512"
// (`lola-global-512` in data/catalog.json), 512 pixels per degree, about 59 m per pixel, 34 GB in all.
// Node only: this runs in the dev server and in scripts, never in the browser.
//
// Layout, from the PDS labels (checked 2026-11-14 against ldem_512_45n_90n_000_090.lbl and
// ldem_512_90s_45s_270_360.lbl): each tile is 90° of longitude by 45° of latitude, "simple cylindrical",
// 46080 × 23040 16-bit little-endian integers, height in metres = value × 0.5 relative to a 1737.4 km
// sphere. Row 0 is the tile's north edge, column 0 its west edge, longitudes run 0–360° east, and pixel
// centres sit half a pixel in from the edges. The labels give no "missing" value: every pixel is a height.
//
// Nothing is loaded up front. The sixteen tiles are treated as one big grid cut into small blocks
// (1024 × 128 pixels, 256 kB). A block is read from disk the first time a sample needs it and kept in a
// cache that is capped (1024 blocks, 268 MB, by default); the blocks used longest ago are dropped first.
// Tiles that are not on disk yet simply have no data (NaN), so a half-finished download works for the
// tiles that are there, and tiles that arrive later are noticed without a restart.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEG = Math.PI / 180;
const MOON_RADIUS_M = 1737400;
const LAT_BANDS = ['45n_90n', '00n_45n', '45s_00s', '90s_45s']; // north to south
const LON_BANDS = ['000_090', '090_180', '180_270', '270_360']; // eastward from 0° E
const TILE_ROWS = LAT_BANDS.length;
const TILE_COLS = LON_BANDS.length;

/** File name (without extension) of the tile in a row (0 = northernmost) and column (0 = starts at 0° E). */
export const tileName = (pixelsPerDegree, row, col) => `ldem_${pixelsPerDegree}_${LAT_BANDS[row]}_${LON_BANDS[col]}`;

/** Pull what we check out of a tile's PDS3 label. */
export function parseTileLabel(text) {
  const num = (key) => {
    const m = text.match(new RegExp(`^\\s*${key}\\s*=\\s*(-?[0-9.]+)`, 'm'));
    if (!m) throw new Error(`Label has no ${key}`);
    return parseFloat(m[1]);
  };
  const str = (key) => text.match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\n]+?)"?\\s*$`, 'm'))?.[1] ?? null;
  return {
    lines: num('LINES'),
    samples: num('LINE_SAMPLES'),
    sampleBits: num('SAMPLE_BITS'),
    sampleType: str('SAMPLE_TYPE'),
    scalingFactor: num('SCALING_FACTOR'),
    radiusM: num('OFFSET'),
    projection: str('MAP_PROJECTION_TYPE'),
    pixelsPerDegree: num('MAP_RESOLUTION'),
    maxLat: num('MAXIMUM_LATITUDE'),
    minLat: num('MINIMUM_LATITUDE'),
    westLon: num('WESTERNMOST_LONGITUDE'),
    eastLon: num('EASTERNMOST_LONGITUDE'),
  };
}

/** Why a label does not describe the tile we expect at (row, col), or null if it does. */
function labelProblem(label, dem, row, col) {
  const expect = {
    lines: dem.tileH,
    samples: dem.tileW,
    sampleBits: 16,
    sampleType: 'LSB_INTEGER',
    scalingFactor: dem.scale,
    radiusM: MOON_RADIUS_M,
    projection: 'SIMPLE CYLINDRICAL',
    pixelsPerDegree: dem.pixelsPerDegree,
    maxLat: 90 - row * 45,
    minLat: 45 - row * 45,
    westLon: col * 90,
    eastLon: col * 90 + 90,
  };
  for (const [key, want] of Object.entries(expect)) {
    if (label[key] !== want) return `its label says ${key} = ${label[key]}, expected ${want}`;
  }
  return null;
}

/** Which tiles of a dataset are complete on disk. Cheap: looks at file sizes only. */
export function tilesOnDisk(dir, { pixelsPerDegree = 512 } = {}) {
  const bytes = 90 * pixelsPerDegree * 45 * pixelsPerDegree * 2;
  const present = [];
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const name = tileName(pixelsPerDegree, row, col);
      const size = fs.statSync(path.join(dir, `${name}.img`), { throwIfNoEntry: false })?.size;
      if (size === bytes) present.push(name);
    }
  }
  return { present, total: TILE_ROWS * TILE_COLS };
}

/** Open any complete tiles that are not open yet. A file of the wrong size (a download in progress) is left alone. */
function scanTiles(dem) {
  dem.lastScan = Date.now();
  const bytes = dem.tileW * dem.tileH * 2;
  for (let row = 0; row < TILE_ROWS; row++) {
    for (let col = 0; col < TILE_COLS; col++) {
      const t = row * TILE_COLS + col;
      if (dem.tiles[t]) continue;
      const name = tileName(dem.pixelsPerDegree, row, col);
      const imgPath = path.join(dem.dir, `${name}.img`);
      const size = fs.statSync(imgPath, { throwIfNoEntry: false })?.size;
      if (size == null) continue;
      if (size !== bytes) {
        dem.skipped.set(name, `it is ${size} bytes, expected ${bytes}`);
        continue;
      }
      const lblPath = path.join(dem.dir, `${name}.lbl`);
      if (fs.existsSync(lblPath)) {
        let problem;
        try {
          problem = labelProblem(parseTileLabel(fs.readFileSync(lblPath, 'latin1')), dem, row, col);
        } catch (error) {
          problem = error.message;
        }
        if (problem) {
          dem.skipped.set(name, problem);
          continue;
        }
      }
      dem.skipped.delete(name);
      dem.tiles[t] = { name, fd: fs.openSync(imgPath, 'r') };
    }
  }
}

/**
 * Open the tiles found in a folder. Reads nothing but (small) labels until a height is asked for.
 * @param {Object} options
 * @param {string} options.dir               folder holding the `.img` (and `.lbl`) files
 * @param {number} [options.pixelsPerDegree] 512 for the real data; tests use tiny tiles
 * @param {number} [options.scalingFactor]   metres per stored unit
 * @param {number} [options.blockW]          cache block width in pixels (must divide the tile width)
 * @param {number} [options.blockH]          cache block height in pixels (must divide the tile height)
 * @param {number} [options.maxBlocks]       most blocks kept in memory at once
 * @param {number} [options.recheckMs]       how often to look for tiles that have arrived since
 */
export function openEquirectTiles({ dir, id = 'equirect-tiles', pixelsPerDegree = 512, scalingFactor = 0.5, blockW = 1024, blockH = 128, maxBlocks = 1024, recheckMs = 15_000 }) {
  if (os.endianness() !== 'LE') throw new Error('The tile reader expects a little-endian computer');
  const tileW = 90 * pixelsPerDegree;
  const tileH = 45 * pixelsPerDegree;
  if (tileW % blockW !== 0 || tileH % blockH !== 0) throw new Error(`Blocks of ${blockW} × ${blockH} do not divide a ${tileW} × ${tileH} tile`);
  const blocksAcross = (TILE_COLS * tileW) / blockW;
  const blocksDown = (TILE_ROWS * tileH) / blockH;
  const dem = {
    kind: 'equirect-tiles',
    id,
    dir,
    pixelsPerDegree,
    pixelM: (Math.PI * MOON_RADIUS_M) / 180 / pixelsPerDegree,
    scale: scalingFactor,
    width: TILE_COLS * tileW,
    height: TILE_ROWS * tileH,
    tileW,
    tileH,
    blockW,
    blockH,
    blocksAcross,
    tileBlocksAcross: tileW / blockW,
    tileBlocksDown: tileH / blockH,
    tiles: new Array(TILE_ROWS * TILE_COLS).fill(null), // {name, fd} once a tile is open
    skipped: new Map(), // tile name -> why a file that is there was not used
    blocks: new Array(blocksAcross * blocksDown), // Int16Array per loaded block, by block number
    stamps: new Float64Array(blocksAcross * blocksDown), // when each block was last used
    loaded: [], // block numbers in memory
    free: [], // buffers of dropped blocks, reused
    tick: 0,
    maxBlocks: Math.max(4, maxBlocks),
    recheckMs,
    lastScan: 0,
    stats: { blocksRead: 0, bytesRead: 0, dropped: 0 },
  };
  scanTiles(dem);
  return dem;
}

/** Close the tile files and forget the cache. */
export function closeEquirectTiles(dem) {
  for (const tile of dem.tiles) if (tile) fs.closeSync(tile.fd);
  dem.tiles.fill(null);
  for (const key of dem.loaded) dem.blocks[key] = undefined;
  dem.loaded.length = 0;
  dem.free.length = 0;
}

/** Names of the tiles that are open, re-checking the folder first. */
export function openTileNames(dem) {
  scanTiles(dem);
  return dem.tiles.filter(Boolean).map((tile) => tile.name);
}

/** Memory held by cached blocks, in bytes. */
export const cacheBytes = (dem) => (dem.loaded.length + dem.free.length) * dem.blockW * dem.blockH * 2;

/** Drop the quarter of the cache that was used longest ago. */
function evict(dem) {
  const { loaded, stamps, blocks, free } = dem;
  loaded.sort((a, b) => stamps[a] - stamps[b]);
  const drop = Math.max(1, loaded.length >> 2);
  for (let i = 0; i < drop; i++) {
    free.push(blocks[loaded[i]]);
    blocks[loaded[i]] = undefined;
  }
  loaded.splice(0, drop);
  dem.stats.dropped += drop;
}

/** Read one block from its tile, or return null if that tile is not on disk. */
function loadBlock(dem, bx, by, key) {
  const tileCol = Math.floor(bx / dem.tileBlocksAcross);
  const tileRow = Math.floor(by / dem.tileBlocksDown);
  const t = tileRow * TILE_COLS + tileCol;
  if (!dem.tiles[t]) {
    if (Date.now() - dem.lastScan > dem.recheckMs) scanTiles(dem);
    if (!dem.tiles[t]) return null;
  }
  const { fd, name } = dem.tiles[t];
  const { blockW, blockH, tileW } = dem;
  if (dem.loaded.length >= dem.maxBlocks) evict(dem);
  const block = dem.free.pop() ?? new Int16Array(blockW * blockH);
  const bytes = new Uint8Array(block.buffer);
  const col0 = bx * blockW - tileCol * tileW;
  const row0 = by * blockH - tileRow * dem.tileH;
  const rowBytes = blockW * 2;
  for (let r = 0; r < blockH; r++) {
    const position = ((row0 + r) * tileW + col0) * 2;
    for (let got = 0; got < rowBytes; ) {
      const n = fs.readSync(fd, bytes, r * rowBytes + got, rowBytes - got, position + got);
      if (n === 0) {
        dem.free.push(block);
        throw new Error(`${name}.img ended early`);
      }
      got += n;
    }
  }
  dem.blocks[key] = block;
  dem.loaded.push(key);
  dem.stamps[key] = ++dem.tick;
  dem.stats.blocksRead++;
  dem.stats.bytesRead += rowBytes * blockH;
  return block;
}

function blockAt(dem, bx, by) {
  const key = by * dem.blocksAcross + bx;
  const block = dem.blocks[key];
  if (block !== undefined) {
    dem.stamps[key] = ++dem.tick;
    return block;
  }
  return loadBlock(dem, bx, by, key);
}

/** One stored value by its column and row in the whole-Moon grid, or NaN if its tile is missing. */
function pixel(dem, x, y) {
  const bx = Math.floor(x / dem.blockW);
  const by = Math.floor(y / dem.blockH);
  const block = blockAt(dem, bx, by);
  return block === null ? NaN : block[(y - by * dem.blockH) * dem.blockW + (x - bx * dem.blockW)];
}

// The four stored values around the last point looked up, and where the point sits between them.
// Module-level so the hot path allocates nothing; everything here is synchronous.
let A = 0;
let B = 0;
let C = 0;
let D = 0;
let FX = 0;
let FY = 0;

/** Fill A–D, FX, FY for a point. False if any of the four pixels is in a tile that is not on disk. */
function corners(dem, latDeg, lonDeg) {
  const { pixelsPerDegree: ppd, width, height, blockW, blockH } = dem;
  let lon = lonDeg % 360;
  if (lon < 0) lon += 360;
  const x = lon * ppd - 0.5;
  const y = Math.min(Math.max((90 - latDeg) * ppd - 0.5, 0), height - 1);
  const xf = Math.floor(x);
  const y0 = Math.floor(y);
  FX = x - xf;
  FY = y - y0;
  const x0 = xf < 0 ? width - 1 : Math.min(xf, width - 1); // west of the first pixel centre: wrap round the Moon
  const bx = Math.floor(x0 / blockW);
  const by = Math.floor(y0 / blockH);
  const ox = x0 - bx * blockW;
  const oy = y0 - by * blockH;
  if (ox < blockW - 1 && oy < blockH - 1) {
    // The usual case: all four pixels are in one block.
    const block = blockAt(dem, bx, by);
    if (block === null) return false;
    const i = oy * blockW + ox;
    A = block[i];
    B = block[i + 1];
    C = block[i + blockW];
    D = block[i + blockW + 1];
    return true;
  }
  const x1 = x0 + 1 >= width ? 0 : x0 + 1;
  const y1 = Math.min(y0 + 1, height - 1);
  A = pixel(dem, x0, y0);
  B = pixel(dem, x1, y0);
  C = pixel(dem, x0, y1);
  D = pixel(dem, x1, y1);
  return !Number.isNaN(A + B + C + D);
}

/** Height in metres at a latitude/longitude (bilinear), or NaN where the tile is not on disk. */
export function tilesHeightAt(dem, latDeg, lonDeg) {
  if (!corners(dem, latDeg, lonDeg)) return NaN;
  return ((A * (1 - FX) + B * FX) * (1 - FY) + (C * (1 - FX) + D * FX) * FY) * dem.scale;
}

/**
 * out[0] = height in metres, out[1] = slope in degrees, from the four pixels around the point (so the slope
 * is measured over one pixel, about 59 m). Both NaN where the tile is not on disk. Returns out.
 */
export function tilesSample(dem, latDeg, lonDeg, out) {
  if (!corners(dem, latDeg, lonDeg)) {
    out[0] = NaN;
    out[1] = NaN;
    return out;
  }
  out[0] = ((A * (1 - FX) + B * FX) * (1 - FY) + (C * (1 - FX) + D * FX) * FY) * dem.scale;
  const dx = ((B - A) * (1 - FY) + (D - C) * FY) * dem.scale; // metres of height per pixel, east-west
  const dy = ((C - A) * (1 - FX) + (D - B) * FX) * dem.scale; // and north-south
  const ewDist = dem.pixelM * Math.max(Math.cos(latDeg * DEG), 1e-6); // pixels narrow toward the poles
  out[1] = Math.atan(Math.sqrt((dx / ewDist) ** 2 + (dy / dem.pixelM) ** 2)) / DEG;
  return out;
}
