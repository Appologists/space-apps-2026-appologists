// Terrain and sky for the street view (public/Street-view/) at any point near the south pole, made on request.
// The same pieces public/Street-view/tools/bake_terrain.py writes ahead of time for its fixed sites:
//   near  401 x 401 heights every 5 m (2 x 2 km): NASA GSFC PGDA 5 m maps where downloaded
//         (data/raw/pgda-lola-5mpp/, https://pgda.gsfc.nasa.gov/products/78), otherwise the best terrain the
//         app has (server/terrain-sources.mjs; 80 m near the pole, read between its pixels)
//   err   101 x 101 height uncertainty every 20 m, from the PGDA error maps (none elsewhere)
//   far   481 x 481 heights every 250 m (120 x 120 km), best available
//   distant horizon 60-200 km, 720 azimuths
//   sky   Sun and Earth every hour for a year from 14 Nov 2026 (src/astro, checked against JPL Horizons)
// Frame: x = east, z = south, y = up, metres, origin on the ground at the point; heights relative to it, with the
// Moon's curvature (d^2 / 2R) already taken off. Polar stereographic: X = rho sin(lon), Y = rho cos(lon).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ephemerisSeries } from '../src/astro/ephemeris.js';
import { skySeries } from '../src/astro/sky.js';
import { heightAt } from './lola-polar.mjs';

const R = 1737400;
const DEG = Math.PI / 180;
const SKY_START = new Date(Date.UTC(2026, 10, 14));
let series = null; // the Sun/Earth ephemeris is the same for every point: work it out once

/** A PGDA GeoTIFF: uncompressed float32, one row per strip, rows stored one after another. */
function readPgdaTif(file) {
  const buf = readFileSync(file);
  if (buf.toString('latin1', 0, 2) !== 'II') throw new Error(`${file}: not a little-endian TIFF`);
  const ifd = buf.readUInt32LE(4);
  const n = buf.readUInt16LE(ifd);
  const tags = {};
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    const tag = buf.readUInt16LE(at), type = buf.readUInt16LE(at + 2), count = buf.readUInt32LE(at + 4);
    const size = { 3: 2, 4: 4, 12: 8 }[type] ?? 1;
    const off = count * size > 4 ? buf.readUInt32LE(at + 8) : at + 8;
    const read = (k) => (type === 3 ? buf.readUInt16LE(off + k * 2) : type === 4 ? buf.readUInt32LE(off + k * 4) : type === 12 ? buf.readDoubleLE(off + k * 8) : buf[off + k]);
    tags[tag] = count === 1 ? read(0) : Array.from({ length: Math.min(count, 8) }, (_, k) => read(k));
  }
  const w = tags[256], h = tags[257];
  if (tags[259] !== 1 || tags[339] !== 3) throw new Error(`${file}: expected uncompressed float32`);
  const first = Array.isArray(tags[273]) ? tags[273][0] : tags[273];
  const data = new Float32Array(buf.buffer.slice(buf.byteOffset + first, buf.byteOffset + first + w * h * 4));
  return { w, h, data, x0: tags[33922][3], y0: tags[33922][4], dx: tags[33550][0], dy: tags[33550][1] };
}

export function createStreetView(root, store) {
  const dir = path.join(root, 'data', 'raw', 'pgda-lola-5mpp');
  const tiles = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('_surf.tif')).map((f) => ({ surf: path.join(dir, f), err: path.join(dir, f.replace('_surf', '_toterr')) })) : [];
  const loaded = new Map();
  const tile = (t) => {
    if (!loaded.has(t.surf)) loaded.set(t.surf, { surf: readPgdaTif(t.surf), err: existsSync(t.err) ? readPgdaTif(t.err) : null });
    return loaded.get(t.surf);
  };
  // Which PGDA tile covers a stereographic point; the tiles' extents are read from their headers once.
  let extents = null;
  const tileAt = (X, Y) => {
    if (!extents) extents = tiles.map((t) => { const s = tile(t).surf; return { t, x1: s.x0, x2: s.x0 + s.w * s.dx, y1: s.y0 - s.h * s.dy, y2: s.y0 }; });
    return extents.find((e) => X > e.x1 + 10 && X < e.x2 - 10 && Y > e.y1 + 10 && Y < e.y2 - 10)?.t ?? null;
  };
  const bil = (g, X, Y) => {
    const c = (X - g.x0) / g.dx - 0.5, r = (g.y0 - Y) / g.dy - 0.5;
    const i = Math.floor(c), j = Math.floor(r);
    if (i < 0 || j < 0 || i >= g.w - 1 || j >= g.h - 1) return NaN;
    const fx = c - i, fy = r - j, k = j * g.w + i, d = g.data;
    return (d[k] * (1 - fx) + d[k + 1] * fx) * (1 - fy) + (d[k + g.w] * (1 - fx) + d[k + g.w + 1] * fx) * fy;
  };
  const toLatLon = (X, Y) => [2 * Math.atan(Math.hypot(X, Y) / (2 * R)) / DEG - 90, Math.atan2(X, Y) / DEG];
  const cache = new Map();

  async function bake(lat, lon, name) {
    const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
    if (cache.has(key)) return cache.get(key);
    const found = await store.demFor(lat, 'auto', lon);
    if (!found.dem) throw new Error('No terrain data here (the street view needs the south-pole data: npm run data:fetch -- lola-south-80s-80m)');
    const dem = found.dem;
    const rho0 = 2 * R * Math.tan((90 + lat) * DEG / 2);
    const X0 = rho0 * Math.sin(lon * DEG), Y0 = rho0 * Math.cos(lon * DEG);
    const n = [Math.sin(lon * DEG), Math.cos(lon * DEG)], e = [n[1], -n[0]];
    const k = 2 / (1 + Math.sin(Math.abs(lat) * DEG)); // map metres per ground metre
    const toMap = (x, z) => [X0 + k * (x * e[0] - z * n[0]), Y0 + k * (x * e[1] - z * n[1])];
    const t5 = tileAt(X0, Y0);
    const g5 = t5 ? tile(t5) : null;
    const coarse = (X, Y, wantM) => { const [la, lo] = toLatLon(X, Y); return heightAt(dem, la, lo, wantM); };
    const near5 = (X, Y) => { const v = g5 ? bil(g5.surf, X, Y) : NaN; return Number.isNaN(v) ? coarse(X, Y, 5) : v; };

    const [cx, cy] = toMap(0, 0);
    const h0 = near5(cx, cy);
    if (Number.isNaN(h0)) throw new Error('No terrain data at this point');
    // near: 401 x 401, 5 m
    const N = 401, S = 1000, near = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -S + i * 5, z = -S + j * 5, [X, Y] = toMap(x, z);
      const v = near5(X, Y);
      near[j * N + i] = (Number.isNaN(v) ? h0 : v) - h0 - (x * x + z * z) / (2 * R);
    }
    // err: 101 x 101, 20 m, decimetres (PGDA only)
    let err = null;
    if (g5?.err) {
      err = new Uint8Array(101 * 101);
      for (let j = 0; j < 101; j++) for (let i = 0; i < 101; i++) {
        const [X, Y] = toMap(-S + i * 20, -S + j * 20), v = bil(g5.err, X, Y);
        err[j * 101 + i] = Number.isNaN(v) ? 0 : Math.min(255, Math.round(v * 10));
      }
    }
    // far: 481 x 481, 250 m
    const NF = 481, SF = 60000, far = new Float32Array(NF * NF);
    let low = Infinity;
    for (let j = 0; j < NF; j++) for (let i = 0; i < NF; i++) {
      const x = -SF + i * 250, z = -SF + j * 250, [X, Y] = toMap(x, z);
      const v = coarse(X, Y, 250);
      const rel = Number.isNaN(v) ? NaN : v - h0 - (x * x + z * z) / (2 * R);
      far[j * NF + i] = rel;
      if (rel < low) low = rel;
    }
    for (let q = 0; q < far.length; q++) if (Number.isNaN(far[q])) far[q] = low;
    // distant horizon 60-200 km from 2 m above the ground
    const elevDeg = [];
    for (let a = 0; a < 720; a++) {
      const az = a * 0.5 * DEG;
      let best = -90;
      for (let d = 60000; d <= 200000; d += 400) {
        const [X, Y] = toMap(d * Math.sin(az), -d * Math.cos(az));
        const v = coarse(X, Y, 500);
        if (Number.isNaN(v)) continue;
        const el = Math.atan2(v - h0 - 2 - (d * d) / (2 * R), d) / DEG;
        if (el > best) best = el;
      }
      elevDeg.push(+best.toFixed(3));
    }
    // sky: a year, hourly
    series ??= ephemerisSeries(SKY_START, 366 * 24, 60);
    const sky = skySeries({ lat, lon, elevationM: h0 }, series);
    const count = sky.sunEl.length, skyBuf = new Float32Array(count * 4);
    for (let q = 0; q < count; q++) { skyBuf[q * 4] = sky.sunAz[q]; skyBuf[q * 4 + 1] = sky.sunEl[q]; skyBuf[q * 4 + 2] = sky.earthAz[q]; skyBuf[q * 4 + 3] = sky.earthEl[q]; }

    const b64 = (arr) => Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength).toString('base64');
    const src5 = g5 ? `NASA GSFC PGDA 5 m LOLA map (${path.basename(t5.surf).split('_')[0]}), https://pgda.gsfc.nasa.gov/products/78` : `${found.source.label} (LOLA), read between its pixels`;
    const out = {
      meta: {
        key: 'here', name: name || 'Landing spot', lat: +lat.toFixed(5), lon: +lon.toFixed(4), heightM: +h0.toFixed(2),
        pick: g5 ? 'The spot chosen in the finder · NASA 5 m terrain' : `The spot chosen in the finder · ${found.source.label} terrain (no 5 m map here)`,
        near: { n: N, half: S, cell: 5 }, err: err ? { n: 101, half: S, cell: 20, unit: 0.1 } : null,
        far: { n: NF, half: SF, cell: 250 }, distantHorizon: { fromKm: 60, toKm: 200, stepDeg: 0.5, elevDeg },
        sky: { startUTC: SKY_START.toISOString(), stepHours: 1, count, fields: ['sunAz', 'sunEl', 'earthAz', 'earthEl'] },
        sources: [`Near ground: ${src5}`, `Far ground: ${found.source.label}`, 'Sun and Earth: src/astro (Astronomy Engine, checked against NASA JPL Horizons)'],
        fineGround: !!g5,
      },
      near: b64(near), far: b64(far), err: err ? b64(err) : null, sky: b64(skyBuf),
    };
    cache.set(key, out);
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return out;
  }
  return { bake };
}
