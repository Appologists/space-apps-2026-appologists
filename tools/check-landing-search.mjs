#!/usr/bin/env node
// Cross-checks the landing-site search (shadow sweep) against the slower single-point horizon method on real terrain.
// Usage: node tools/check-landing-search.mjs
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ephemerisSeries } from '../src/astro/ephemeris.js';
import { skySeries } from '../src/astro/sky.js';
import { cellOffset, cellToLatLon, searchGrid } from '../src/finder/grid.js';
import { clearanceSeries, horizonProfile } from '../src/terrain/polar-grid.js';
import { openLolaPolar, samplePolarPatch } from '../server/lola-polar.mjs';
import { searchLanding } from '../server/landing-search.mjs';

const dir = fileURLToPath(new URL('../data/raw/lola-south-80s-80m/', import.meta.url));
const imgPath = `${dir}ldem_80s_80m.img`;
const lblPath = `${dir}ldem_80s_80m.lbl`;
if (!existsSync(imgPath) || !existsSync(lblPath)) {
  console.log('Terrain data is missing. Get it with: npm run data:fetch -- lola-south-80s-80m');
  process.exit(0);
}
const dem = await openLolaPolar({ imgPath, lblPath, id: 'lola-south-80s-80m' });

const base = {
  center: { lat: -89.45, lon: -137.31 },
  radiusKm: 10,
  start: '2026-11-14T19:00:00Z',
  durationHours: 336,
  stepMinutes: 60,
  panelHeightM: 2,
  antennaHeightM: 2,
};
const fmt = (v, d = 3) => (Number.isFinite(v) ? v.toFixed(d) : 'NaN');

// ---- Scenario A ----------------------------------------------------------------------------------------
console.log('=== Scenario A: start', base.start);
const t0 = performance.now();
const a = searchLanding(dem, base);
const wall = ((performance.now() - t0) / 1000).toFixed(1);
if (!a) throw new Error('searchLanding returned null (centre has no terrain data)');
const { header, rasters } = a;
console.log(`grid ${header.n}x${header.n}, cell ${header.cellM} m, steps ${header.steps}; compute ${header.computeMs} ms (wall ${wall} s)`);
console.log('counts', JSON.stringify(header.counts));

const grid = searchGrid(base.radiusKm);
const series = ephemerisSeries(new Date(base.start), base.durationHours, base.stepMinutes);
const { stepHours } = series;
const steps = series.samples.length;
const windowHours = Math.max(steps - 1, 1) * stepHours;

function reference(lat, lon) {
  const patch = samplePolarPatch(dem, lat, lon);
  const sky = skySeries({ lat, lon, elevationM: patch.groundHeightM }, series);
  const sunClear = clearanceSeries(sky.sunEl, sky.sunAz, horizonProfile(patch, base.panelHeightM));
  const earthClear = clearanceSeries(sky.earthEl, sky.earthAz, horizonProfile(patch, base.antennaHeightM));
  const stats = (clear) => {
    let count = 0;
    let run = 0;
    let maxDark = 0;
    for (let i = 0; i < clear.length; i++) {
      if (clear[i] > 0) {
        count++;
        run = 0;
      } else if (++run > maxDark) maxDark = run;
    }
    return { fraction: count / clear.length, longestDarkH: Math.min(maxDark * stepHours, windowHours), atStart: clear[0] > 0 };
  };
  return { sun: stats(sunClear), earth: stats(earthClear) };
}

// 16 check cells: nearest the centre, then a 4x4 lattice at +-30% / +-75% of the radius (centre cell replaces one if needed)
const R = base.radiusKm * 1000;
const fr = [-0.75, -0.3, 0.3, 0.75];
const targets = [{ east: 0, north: 0 }];
for (const n of fr) for (const e of fr) targets.push({ east: e * R, north: n * R });
const cells = [];
for (const t of targets) {
  const col = Math.round((t.east + grid.halfSizeM) / grid.cellM - 0.5);
  const row = Math.round((grid.halfSizeM - t.north) / grid.cellM - 0.5);
  const idx = row * grid.n + col;
  if (Number.isNaN(rasters.elevation[idx])) continue;
  cells.push({ row, col, idx });
}
cells.length = Math.min(cells.length, 16);

console.log('\nrow  col      lat        lon    elev |  sunF s/r   d  | earthF s/r   d  | darkH s/r  d | sun0 s/r | earth0 s/r');
let agree = 0;
let maxSun = 0;
let maxEarth = 0;
let maxDark = 0;
let over = 0;
for (const { row, col, idx } of cells) {
  const { lat, lon } = cellToLatLon(header, header.center, row, col);
  const ref = reference(lat, lon);
  const sS = rasters.sunFraction[idx];
  const eS = rasters.earthFraction[idx];
  const dS = rasters.longestDarkH[idx];
  const dSun = sS - ref.sun.fraction;
  const dEarth = eS - ref.earth.fraction;
  const dDark = dS - ref.sun.longestDarkH;
  maxSun = Math.max(maxSun, Math.abs(dSun));
  maxEarth = Math.max(maxEarth, Math.abs(dEarth));
  maxDark = Math.max(maxDark, Math.abs(dDark));
  const bad = Math.abs(dSun) > 0.1 || Math.abs(dEarth) > 0.1;
  if (bad) over++;
  else agree++;
  console.log(
    `${String(row).padStart(3)} ${String(col).padStart(4)} ${fmt(lat, 4).padStart(9)} ${fmt(lon, 3).padStart(10)} ${fmt(rasters.elevation[idx], 0).padStart(6)} | ` +
      `${fmt(sS, 2)}/${fmt(ref.sun.fraction, 2)} ${fmt(dSun, 2).padStart(5)} | ${fmt(eS, 2)}/${fmt(ref.earth.fraction, 2)} ${fmt(dEarth, 2).padStart(5)} | ` +
      `${fmt(dS, 0).padStart(4)}/${fmt(ref.sun.longestDarkH, 0).padStart(4)} ${fmt(dDark, 0).padStart(4)} | ` +
      `${ref.sun.atStart ? 1 : 0} (search fail ${rasters.fail[idx]}) | ${ref.earth.atStart ? 1 : 0}${bad ? '  <-- DIFFERS' : ''}`,
  );
}
console.log(`\nlargest |diff|: sunFraction ${fmt(maxSun)}, earthFraction ${fmt(maxEarth)}, longestDarkH ${fmt(maxDark, 1)} h`);
console.log(`cells differing by more than 0.10 in either fraction: ${over} of ${cells.length}; agreeing: ${agree}`);

// ---- Scenario B ----------------------------------------------------------------------------------------
console.log('\n=== Scenario B: start 2026-11-18T19:00:00Z');
const b = searchLanding(dem, { ...base, start: '2026-11-18T19:00:00Z' });
console.log(`compute ${b.header.computeMs} ms; counts`, JSON.stringify(b.header.counts));
console.log('rank      lat        lon   score  sunF  darkH  earthF  ellipseSlope');
for (const s of b.header.sites) {
  console.log(
    `${String(s.rank).padStart(4)} ${fmt(s.lat, 4).padStart(9)} ${fmt(s.lon, 3).padStart(10)} ${fmt(s.score, 3)} ${fmt(s.sunFraction, 2)} ${fmt(s.longestDarkH, 0).padStart(5)} ${fmt(s.earthFraction, 2).padStart(7)} ${fmt(s.ellipseSlopeDeg, 1).padStart(8)}`,
  );
}
if (!b.header.sites.length) console.log('(no sites)');

const ok = agree >= 13;
console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${agree} of ${cells.length} check cells agree within 0.10 (need 13)`);
process.exit(ok ? 0 : 1);
