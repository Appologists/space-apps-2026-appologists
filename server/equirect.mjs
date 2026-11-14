// Reads a whole-Moon elevation map stored as an uncompressed 32-bit float TIFF in an equirectangular
// (plate carrée) layout, such as NASA's CGI Moon Kit `ldem_16.tif` (5760×2880) and `ldem_64.tif` (23040×11520).
// Values are heights in kilometres relative to a sphere of radius 1737.4 km (so unitM = 1000).
// Node only: this runs in the dev server and in scripts, never in the browser.
//
// Layout: row 0 is the north edge (+90°), the last row the south edge. Column 0 starts at `westLonDeg`
// (default -180°) and longitude increases eastward. Pixel centres sit half a pixel in from the edges.
import fs from 'node:fs';

const DEG = Math.PI / 180;
const MAX_READ = 256 * 1024 * 1024;

const TAG = {
  width: 256,
  height: 257,
  bits: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  sampleFormat: 339,
  tileWidth: 322,
  tileLength: 323,
  tileOffsets: 324,
  tileByteCounts: 325,
};

const COMPRESSION_NAMES = { 1: 'none', 5: 'LZW', 6: 'old JPEG', 7: 'JPEG', 8: 'Deflate', 32773: 'PackBits', 32946: 'Deflate' };

/**
 * Parse the TIFF structure only (first IFD). `read(position, length)` returns a Buffer/Uint8Array with those bytes.
 * @returns {{width:number,height:number,littleEndian:boolean,chunks:{offset:number,byteCount:number,row0:number,rows:number}[],
 *   bitsPerSample:number,sampleFormat:number,compression:number}}
 */
export function readTiffLayout(read) {
  const view = (pos, len) => {
    const b = read(pos, len);
    if (b.length < len) throw new Error(`TIFF is truncated: wanted ${len} bytes at ${pos}, got ${b.length}`);
    return new DataView(b.buffer, b.byteOffset, b.length);
  };
  const head = view(0, 8);
  const order = String.fromCharCode(head.getUint8(0), head.getUint8(1));
  if (order !== 'II' && order !== 'MM') throw new Error('Not a TIFF file (no II or MM byte-order mark)');
  const le = order === 'II';
  const magic = head.getUint16(2, le);
  if (magic === 43) throw new Error('BigTIFF (magic 43) is not supported; only classic TIFF (magic 42)');
  if (magic !== 42) throw new Error(`Not a classic TIFF (magic ${magic})`);
  const ifd = head.getUint32(4, le);
  const count = view(ifd, 2).getUint16(0, le);
  const entries = view(ifd + 2, count * 12);

  const tags = new Map();
  for (let i = 0; i < count; i++) {
    const o = i * 12;
    const tag = entries.getUint16(o, le);
    const type = entries.getUint16(o + 2, le);
    const n = entries.getUint32(o + 4, le);
    const size = type === 3 ? 2 : type === 4 ? 4 : 0;
    if (!size) continue; // only SHORT and LONG matter here
    const values = new Array(n);
    let dv;
    let base;
    if (size * n <= 4) {
      dv = entries;
      base = o + 8;
    } else {
      dv = view(entries.getUint32(o + 8, le), size * n);
      base = 0;
    }
    for (let k = 0; k < n; k++) values[k] = size === 2 ? dv.getUint16(base + k * 2, le) : dv.getUint32(base + k * 4, le);
    tags.set(tag, values);
  }
  const one = (tag, dflt) => (tags.has(tag) ? tags.get(tag)[0] : dflt);

  const width = one(TAG.width);
  const height = one(TAG.height);
  if (!width || !height) throw new Error('TIFF has no ImageWidth/ImageLength');
  const compression = one(TAG.compression, 1);
  const bitsPerSample = one(TAG.bits, 1);
  const sampleFormat = one(TAG.sampleFormat, 1);
  const samples = one(TAG.samplesPerPixel, 1);

  if (compression !== 1) {
    throw new Error(`compression ${compression} (${COMPRESSION_NAMES[compression] ?? 'unknown'}) is not supported; need uncompressed (1)`);
  }
  if (tags.has(TAG.tileOffsets)) throw new Error('Tiled TIFF layout is not supported; need strips');
  if (samples !== 1) throw new Error(`${samples} samples per pixel is not supported; need 1`);
  if (bitsPerSample !== 32) throw new Error(`${bitsPerSample} bits per sample is not supported; need 32`);
  if (sampleFormat !== 3) throw new Error(`sample format ${sampleFormat} is not supported; need 3 (IEEE float)`);

  const offsets = tags.get(TAG.stripOffsets);
  if (!offsets) throw new Error('TIFF has no StripOffsets');
  const rowsPerStrip = Math.min(one(TAG.rowsPerStrip, height), height);
  const counts = tags.get(TAG.stripByteCounts);
  const chunks = [];
  for (let s = 0; s < offsets.length; s++) {
    const row0 = s * rowsPerStrip;
    if (row0 >= height) break;
    const rows = Math.min(rowsPerStrip, height - row0);
    const need = rows * width * 4;
    const byteCount = counts ? counts[s] : need;
    if (byteCount < need) throw new Error(`Strip ${s} holds ${byteCount} bytes but ${need} are needed`);
    chunks.push({ offset: offsets[s], byteCount: need, row0, rows });
  }
  const covered = chunks.reduce((n, c) => n + c.rows, 0);
  if (covered !== height) throw new Error(`Strips cover ${covered} of ${height} rows`);
  return { width, height, littleEndian: le, chunks, bitsPerSample, sampleFormat, compression };
}

/** Open a file and read the pixels straight into one Float32Array. */
export function openEquirect({ path, id = 'equirect', westLonDeg = -180, unitM = 1000 }) {
  const fd = fs.openSync(path, 'r');
  try {
    const read = (position, length) => {
      const buf = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const n = fs.readSync(fd, buf, got, length - got, position + got);
        if (n === 0) break;
        got += n;
      }
      return got < length ? buf.subarray(0, got) : buf;
    };
    const layout = readTiffLayout(read);
    const { width, height } = layout;
    if (width !== 2 * height) throw new Error(`Expected an equirectangular image twice as wide as tall, got ${width}×${height}`);
    const data = new Float32Array(width * height);
    const bytes = new Uint8Array(data.buffer);
    for (const chunk of layout.chunks) {
      const dest0 = chunk.row0 * width * 4;
      for (let done = 0; done < chunk.byteCount; ) {
        const len = Math.min(MAX_READ, chunk.byteCount - done);
        const n = fs.readSync(fd, bytes, dest0 + done, len, chunk.offset + done);
        if (n === 0) throw new Error(`${path} ended early while reading pixel data`);
        done += n;
      }
    }
    if (!layout.littleEndian) {
      const u32 = new Uint32Array(data.buffer);
      for (let i = 0; i < u32.length; i++) {
        const v = u32[i];
        u32[i] = (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0;
      }
    }
    const pixelsPerDegree = width / 360;
    return {
      kind: 'equirect',
      id,
      width,
      height,
      pixelsPerDegree,
      pixelM: (Math.PI * 1737400) / 180 / pixelsPerDegree,
      westLonDeg,
      unitM,
      data,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/** Fractional pixel position and the four surrounding pixel indices. */
function cell(dem, latDeg, lonDeg) {
  const { width, height, pixelsPerDegree: ppd, westLonDeg } = dem;
  const x = (lonDeg - westLonDeg) * ppd - 0.5;
  const y = Math.min(Math.max((90 - latDeg) * ppd - 0.5, 0), height - 1);
  const xf = Math.floor(x);
  const y0 = Math.min(Math.floor(y), height - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const x0 = ((xf % width) + width) % width;
  const x1 = (x0 + 1) % width;
  return { fx: x - xf, fy: y - y0, i00: y0 * width + x0, i01: y0 * width + x1, i10: y1 * width + x0, i11: y1 * width + x1 };
}

/** Height in metres at a latitude/longitude; bilinear; NaN only if the data is NaN. */
export function equirectHeightAt(dem, latDeg, lonDeg) {
  const { fx, fy, i00, i01, i10, i11 } = cell(dem, latDeg, lonDeg);
  const d = dem.data;
  return ((d[i00] * (1 - fx) + d[i01] * fx) * (1 - fy) + (d[i10] * (1 - fx) + d[i11] * fx) * fy) * dem.unitM;
}

/** out[0] = height in metres, out[1] = slope in degrees, from the four pixels around the point. Returns out. */
export function equirectSample(dem, latDeg, lonDeg, out) {
  const { fx, fy, i00, i01, i10, i11 } = cell(dem, latDeg, lonDeg);
  const d = dem.data;
  const a = d[i00];
  const b = d[i01];
  const c = d[i10];
  const e = d[i11];
  out[0] = ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy) * dem.unitM;
  const dx = ((b - a) * (1 - fy) + (e - c) * fy) * dem.unitM; // metres of height per pixel, east-west
  const dy = ((c - a) * (1 - fx) + (e - b) * fx) * dem.unitM; // and north-south
  const ewDist = dem.pixelM * Math.max(Math.cos(latDeg * DEG), 1e-6);
  out[1] = Math.atan(Math.sqrt((dx / ewDist) ** 2 + (dy / dem.pixelM) ** 2)) / DEG;
  return out;
}
