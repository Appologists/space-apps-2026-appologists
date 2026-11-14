#!/usr/bin/env node
// Compares the app's local Sun/Earth maths with NASA JPL Horizons for a few sites and times.
// Usage: npm run check:horizons            (uses today's date)
//        npm run check:horizons -- 2027-03-01
import { skyAt } from '../src/astro/sky.js';
import { fetchHorizonsAltAz, HORIZONS_URL } from '../src/astro/horizons.js';

const SITES = [
  { name: 'Apollo 11', lat: 0.67416, lon: 23.47314 },
  { name: 'Shackleton crater', lat: -89.67, lon: 129.78 },
  { name: "Chang'e 4 (far side)", lat: -45.444, lon: 177.599 },
];

const arg = process.argv[2];
const start = arg ? new Date(`${arg}T00:00:00Z`) : new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
if (Number.isNaN(start.getTime())) throw new Error(`Could not read the date "${arg}". Use YYYY-MM-DD.`);
const stop = new Date(start.getTime() + 28 * 86_400_000);

const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
let worst = 0;
console.log(`Local maths vs JPL Horizons, ${start.toISOString().slice(0, 10)} + 28 days, every 2 days\n`);
for (const site of SITES) {
  for (const body of ['sun', 'earth']) {
    const rows = await fetchHorizonsAltAz({ site, body, start, stop, step: '2 d', baseUrl: HORIZONS_URL });
    let maxEl = 0;
    let maxAz = 0;
    for (const row of rows) {
      const ours = skyAt(site, row.date)[body];
      maxEl = Math.max(maxEl, Math.abs(ours.elevation - row.elevation));
      // Azimuth is meaningless near the zenith, so weight it by cos(elevation): the true angle on the sky.
      maxAz = Math.max(maxAz, angleDiff(ours.azimuth, row.azimuth) * Math.cos((row.elevation * Math.PI) / 180));
    }
    worst = Math.max(worst, maxEl, maxAz);
    console.log(
      `${site.name.padEnd(22)} ${body.padEnd(5)} ${String(rows.length).padStart(2)} times   ` +
        `largest difference: elevation ${maxEl.toFixed(4)}°, azimuth ${maxAz.toFixed(4)}°`,
    );
  }
}
console.log(`\nLargest difference overall: ${worst.toFixed(4)}°  (the Sun's disc is 0.53° wide)`);
process.exit(worst < 0.05 ? 0 : 1);
