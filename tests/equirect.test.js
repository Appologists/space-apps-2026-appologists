import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { equirectHeightAt, equirectSample, openEquirect, readTiffLayout } from '../server/equirect.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'equirect-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Assemble a classic TIFF: header, pixel strips, then the IFD (with strip arrays stored out of line). */
function buildTiff({ width, height, pixels, order = 'II', rowsPerStrip = height, compression = 1, bits = 32, format = 3 }) {
  const le = order === 'II';
  const nStrips = Math.ceil(height / rowsPerStrip);
  const pix = Buffer.alloc(width * height * 4);
  pixels.forEach((v, i) => (le ? pix.writeFloatLE(v, i * 4) : pix.writeFloatBE(v, i * 4)));
  const stripBytes = [];
  for (let s = 0; s < nStrips; s++) stripBytes.push(Math.min(rowsPerStrip, height - s * rowsPerStrip) * width * 4);
  const stripOffsets = [];
  let pos = 8;
  for (const n of stripBytes) {
    stripOffsets.push(pos);
    pos += n;
  }
  const ifdPos = pos;
  const entries = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, [bits]],
    [259, 3, [compression]],
    [273, 4, stripOffsets],
    [277, 3, [1]],
    [278, 4, [rowsPerStrip]],
    [279, 4, stripBytes],
    [339, 3, [format]],
  ];
  const ifdSize = 2 + entries.length * 12 + 4;
  let extra = ifdPos + ifdSize;
  const extraBufs = [];
  const ifd = Buffer.alloc(ifdSize);
  const w16 = (b, v, o) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b, v, o) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  w16(ifd, entries.length, 0);
  entries.forEach(([tag, type, vals], i) => {
    const o = 2 + i * 12;
    const size = type === 3 ? 2 : 4;
    w16(ifd, tag, o);
    w16(ifd, type, o + 2);
    w32(ifd, vals.length, o + 4);
    const put = (b, v, at) => (size === 2 ? w16(b, v, at) : w32(b, v, at));
    if (size * vals.length <= 4) {
      vals.forEach((v, k) => put(ifd, v, o + 8 + k * size));
    } else {
      const eb = Buffer.alloc(size * vals.length);
      vals.forEach((v, k) => put(eb, v, k * size));
      w32(ifd, extra, o + 8);
      extraBufs.push(eb);
      extra += eb.length;
    }
  });
  const head = Buffer.alloc(8);
  head.write(order, 0, 'latin1');
  w16(head, 42, 2);
  w32(head, ifdPos, 4);
  return Buffer.concat([head, pix, ifd, ...extraBufs]);
}

const W = 8;
const H = 4;
const PIX = Array.from({ length: W * H }, (_, i) => i * 0.5 - 3); // distinct values, all exact in float32

function writeTmp(name, buf) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, buf);
  return p;
}

describe('readTiffLayout', () => {
  for (const order of ['II', 'MM']) {
    for (const rowsPerStrip of [4, 1, 3]) {
      it(`reads ${order} with rowsPerStrip ${rowsPerStrip}`, () => {
        const buf = buildTiff({ width: W, height: H, pixels: PIX, order, rowsPerStrip });
        const layout = readTiffLayout((p, n) => buf.subarray(p, p + n));
        expect(layout).toMatchObject({ width: W, height: H, littleEndian: order === 'II', bitsPerSample: 32, sampleFormat: 3, compression: 1 });
        expect(layout.chunks).toHaveLength(Math.ceil(H / rowsPerStrip));
        expect(layout.chunks.reduce((n, c) => n + c.rows, 0)).toBe(H);
        expect(layout.chunks[0]).toMatchObject({ row0: 0, rows: Math.min(rowsPerStrip, H) });
        expect(layout.chunks[0].byteCount).toBe(layout.chunks[0].rows * W * 4);
      });
    }
  }

  it('rejects BigTIFF', () => {
    const b = Buffer.alloc(16);
    b.write('II', 0, 'latin1');
    b.writeUInt16LE(43, 2);
    expect(() => readTiffLayout((p, n) => b.subarray(p, p + n))).toThrow(/BigTIFF/);
  });

  it('rejects compressed data, naming what it found', () => {
    const buf = buildTiff({ width: W, height: H, pixels: PIX, compression: 5 });
    expect(() => readTiffLayout((p, n) => buf.subarray(p, p + n))).toThrow(/compression 5 \(LZW\)/);
  });

  it('rejects 16-bit and integer samples', () => {
    const a = buildTiff({ width: W, height: H, pixels: PIX, bits: 16 });
    expect(() => readTiffLayout((p, n) => a.subarray(p, p + n))).toThrow(/16 bits/);
    const b = buildTiff({ width: W, height: H, pixels: PIX, format: 2 });
    expect(() => readTiffLayout((p, n) => b.subarray(p, p + n))).toThrow(/sample format 2/);
  });
});

describe('openEquirect', () => {
  for (const order of ['II', 'MM']) {
    for (const rowsPerStrip of [4, 1, 3]) {
      it(`loads ${order} with rowsPerStrip ${rowsPerStrip} in the right order`, () => {
        const p = writeTmp(`t-${order}-${rowsPerStrip}.tif`, buildTiff({ width: W, height: H, pixels: PIX, order, rowsPerStrip }));
        const dem = openEquirect({ path: p, id: 'x' });
        expect(dem).toMatchObject({ kind: 'equirect', id: 'x', width: W, height: H, pixelsPerDegree: W / 360, westLonDeg: -180, unitM: 1000 });
        expect(dem.pixelM).toBeCloseTo((Math.PI * 1737400) / 180 / (W / 360), 6);
        expect(Array.from(dem.data)).toEqual(PIX);
      });
    }
  }

  it('throws for an image that is not 2:1', () => {
    const p = writeTmp('square.tif', buildTiff({ width: 4, height: 4, pixels: new Array(16).fill(0) }));
    expect(() => openEquirect({ path: p })).toThrow(/twice as wide/);
  });

  it('throws for compressed data', () => {
    const p = writeTmp('lzw.tif', buildTiff({ width: W, height: H, pixels: PIX, compression: 5 }));
    expect(() => openEquirect({ path: p })).toThrow(/compression 5/);
  });
});

/** A hand-made dem: 360 columns × 180 rows (1 pixel per degree). */
function makeDem(fn, extra = {}) {
  const width = 360;
  const height = 180;
  const data = new Float32Array(width * height);
  for (let r = 0; r < height; r++) for (let c = 0; c < width; c++) data[r * width + c] = fn(r, c);
  return { kind: 'equirect', id: 't', width, height, pixelsPerDegree: 1, pixelM: (Math.PI * 1737400) / 180, westLonDeg: -180, unitM: 1000, data, ...extra };
}

describe('sampling', () => {
  const dem = makeDem((r, c) => r * 1000 + c); // km values; unique per pixel

  it('returns the pixel at its centre, scaled by unitM', () => {
    // row 10 centre: lat 90 - 10.5 = 79.5; col 20 centre: lon -180 + 20.5 = -159.5
    expect(equirectHeightAt(dem, 79.5, -159.5)).toBeCloseTo((10 * 1000 + 20) * 1000, 3);
  });

  it('interpolates halfway between two pixels', () => {
    const east = equirectHeightAt(dem, 79.5, -159.0);
    expect(east).toBeCloseTo(((10 * 1000 + 20 + (10 * 1000 + 21)) / 2) * 1000, 3);
    const south = equirectHeightAt(dem, 79.0, -159.5);
    expect(south).toBeCloseTo(((10 * 1000 + 20 + (11 * 1000 + 20)) / 2) * 1000, 3);
  });

  it('wraps in longitude', () => {
    // between the last column (359) and column 0
    const v = equirectHeightAt(dem, 79.5, 180);
    expect(v).toBeCloseTo(((10 * 1000 + 359 + 10 * 1000) / 2) * 1000, 3);
    expect(equirectHeightAt(dem, 79.5, 180.25)).toBeCloseTo(equirectHeightAt(dem, 79.5, -179.75), 3);
    expect(equirectHeightAt(dem, 79.5, 540.25)).toBeCloseTo(equirectHeightAt(dem, 79.5, -179.75), 3);
  });

  it('shifts with westLonDeg', () => {
    const shifted = { ...dem, westLonDeg: 0 };
    expect(equirectHeightAt(shifted, 79.5, 20.5)).toBeCloseTo((10 * 1000 + 20) * 1000, 3);
  });

  it('clamps latitude beyond the first and last rows', () => {
    expect(equirectHeightAt(dem, 90, -159.5)).toBeCloseTo(equirectHeightAt(dem, 89.5, -159.5), 3);
    expect(equirectHeightAt(dem, -90, -159.5)).toBeCloseTo(179 * 1000 * 1000 + 20 * 1000, 3);
    expect(equirectHeightAt(dem, -89.5, -159.5)).toBeCloseTo(179 * 1000 * 1000 + 20 * 1000, 3);
  });

  it('slope of a plane rising 1 km per pixel to the north', () => {
    const north = makeDem((r) => (179 - r) * 1);
    const out = equirectSample(north, 10.2, 33.3, [0, 0]);
    expect(out[1]).toBeCloseTo((Math.atan(1000 / north.pixelM) * 180) / Math.PI, 6);
    expect(out[0]).toBeCloseTo(equirectHeightAt(north, 10.2, 33.3), 6);
  });

  it('slope of an eastward plane is steeper at 60 degrees than at the equator', () => {
    const east = makeDem((r, c) => c * 0.125);
    const eq = equirectSample(east, 0.2, 10.3, [0, 0])[1];
    const at60 = equirectSample(east, 60.2, 10.3, [0, 0])[1];
    expect(at60).toBeGreaterThan(eq);
    expect(eq).toBeCloseTo((Math.atan(125 / (east.pixelM * Math.cos((0.2 * Math.PI) / 180))) * 180) / Math.PI, 6);
    expect(at60).toBeCloseTo((Math.atan(125 / (east.pixelM * Math.cos((60.2 * Math.PI) / 180))) * 180) / Math.PI, 6);
  });
});
