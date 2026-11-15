// Sun and Earth positions over each street-view site, every hour for a year, from the team's astro code
// (Astronomy Engine; `npm run check:horizons` in the repo checks it against NASA JPL Horizons).
// Usage: node bake_sky.mjs <repo> <data-dir>
// Writes <data-dir>/<site>/sky.bin: Float32 [sunAz, sunEl, earthAz, earthEl] per hour, and sky fields in meta.json.
// Elevation is above the flat (ideal) horizon; the page adds the terrain.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, dataDir] = process.argv.slice(2);
const { ephemerisSeries } = await import(pathToFileURL(path.join(repo, 'src/astro/ephemeris.js')));
const { skySeries } = await import(pathToFileURL(path.join(repo, 'src/astro/sky.js')));
const START = new Date(Date.UTC(2026, 10, 14, 0, 0, 0));
const HOURS = 366 * 24;
const series = ephemerisSeries(START, HOURS, 60);
const sites = [];
for (const d of fs.readdirSync(dataDir)) {
  const mp = path.join(dataDir, d, 'meta.json');
  if (fs.existsSync(mp)) sites.push({ dir: path.join(dataDir, d), meta: JSON.parse(fs.readFileSync(mp, 'utf8')) });
}
// Apollo 11 has no 5 m terrain here, but its sky is still real
const apolloDir = path.join(dataDir, 'apollo11');
fs.mkdirSync(apolloDir, { recursive: true });
const apolloMeta = path.join(apolloDir, 'meta.json');
if (!fs.existsSync(apolloMeta)) fs.writeFileSync(apolloMeta, JSON.stringify({ key: 'apollo11', name: 'Tranquility Base (Apollo 11)', lat: 0.67408, lon: 23.47297, heightM: 0,
  pick: 'Apollo 11 lunar module position (LRO camera team)', sources: [] }, null, 1));
sites.push({ dir: apolloDir, meta: JSON.parse(fs.readFileSync(apolloMeta, 'utf8')) });
for (const s of sites) {
  const sky = skySeries({ lat: s.meta.lat, lon: s.meta.lon, elevationM: s.meta.heightM }, series);
  const n = sky.sunEl.length, buf = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { buf[i * 4] = sky.sunAz[i]; buf[i * 4 + 1] = sky.sunEl[i]; buf[i * 4 + 2] = sky.earthAz[i]; buf[i * 4 + 3] = sky.earthEl[i]; }
  fs.writeFileSync(path.join(s.dir, 'sky.bin'), Buffer.from(buf.buffer));
  s.meta.sky = { file: 'sky.bin', startUTC: START.toISOString(), stepHours: 1, count: n, fields: ['sunAz', 'sunEl', 'earthAz', 'earthEl'] };
  const src = 'Sun and Earth: computed with Astronomy Engine (the team repo checks it against NASA JPL Horizons)';
  if (!s.meta.sources.includes(src)) s.meta.sources.push(src);
  fs.writeFileSync(path.join(s.dir, 'meta.json'), JSON.stringify(s.meta, null, 1));
  let mx = -90, mn = 90; for (const v of sky.sunEl) { mx = Math.max(mx, v); mn = Math.min(mn, v); }
  console.log(s.meta.key, n, 'hours; sun elevation', mn.toFixed(2), 'to', mx.toFixed(2));
}
