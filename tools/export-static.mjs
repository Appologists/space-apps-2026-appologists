// Saves what the hosted website needs from the server as plain files, so it runs with no server (Netlify):
//   public/static/landing/<key>.bin       the landing search of every region, for each ready-made mission
//   public/static/streetview/<lat>_<lon>.json  street view terrain and sky at the first few landing sites
//   public/static/polar/<lat>_<lon>.bin    the ground around the same sites, for the ride (the app's own surface view)
//                                         and "When can you land?", which also reads a region's named point when its
//                                         search found no site
//   public/static/terrain-info.json       which terrain the searches used
// The app reads these when /api/terrain/... is not there (src/finder/client.js, src/terrain/client.js,
// public/Street-view/index.html). Missions with other settings still need the local server (npm run dev).
//
//   npm run dev                 (in one terminal)
//   npm run export:static       (in another; add "-- --port 5174" if the app is not on 5173)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defaultWeights } from '../src/criteria/index.js';
import { searchQuestion, staticKey } from '../src/finder/client.js';
import { decodeRasters } from '../src/finder/wire.js';
import { savedSpot } from '../src/terrain/client.js';
import { missionRegions } from '../src/finder/regions.js';
import { defaultFinder } from '../src/finder/score.js';
import { defaultMission } from '../src/mission.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const missions = read('missions.json');
const sites = read('sites.json');
const portArg = process.argv.indexOf('--port');
const base = `http://localhost:${portArg > 0 ? Number(process.argv[portArg + 1]) : 5173}`;
const out = new URL('../public/static/', import.meta.url);
mkdirSync(new URL('landing/', out), { recursive: true });
mkdirSync(new URL('streetview/', out), { recursive: true });
mkdirSync(new URL('polar/', out), { recursive: true });
const SITES_PER_REGION = 3; // the street view opens at the drive's start: the region's first site, unless moved

const regions = missionRegions(missions, sites); // the app's own regions, so the questions are the app's
let bytes = 0;
const spots = new Map();
for (const profile of missions.profiles) {
  console.log(`\n${profile.name}`);
  const mission = { ...defaultMission(), start: new Date(profile.mission.start), durationHours: profile.mission.durationHours };
  const values = { ...defaultFinder(), ...profile.finder };
  for (const region of regions) {
    const question = searchQuestion({ center: region, values, mission, weights: defaultWeights() });
    const response = await fetch(`${base}/api/terrain/landing-search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(question) });
    if (!response.ok) throw new Error(`${region.name}: ${(await response.json().catch(() => ({}))).error ?? response.status}`);
    const buffer = await response.arrayBuffer();
    const key = await staticKey(question);
    writeFileSync(new URL(`landing/${key}.bin`, out), Buffer.from(buffer));
    bytes += buffer.byteLength;
    const { header } = decodeRasters(buffer);
    for (const site of (header.sites ?? []).slice(0, SITES_PER_REGION)) spots.set(savedSpot(site.lat, site.lon), { site, name: `${region.name} · landing spot` });
    // "When can you land?" (src/ui/flow.js drawWhen) checks the region's named point when the search found no site.
    const named = savedSpot(region.lat, region.lon);
    if (!header.sites?.length && !spots.has(named)) spots.set(named, { site: region, name: region.name, groundOnly: true });
    console.log(`  ${region.name.padEnd(24)} ${(header.sites ?? []).length} sites  ${(buffer.byteLength / 1e6).toFixed(1)} MB`);
  }
}
console.log(`\nStreet view and ride at ${spots.size} landing spots`);
for (const [file, { site, name, groundOnly }] of spots) {
  if (!groundOnly) {
    const q = new URLSearchParams({ lat: site.lat.toFixed(5), lon: site.lon.toFixed(5), name });
    const response = await fetch(`${base}/api/terrain/streetview?${q}`);
    if (!response.ok) { console.log(`  ${file}: ${response.status}`); continue; }
    const text = await response.text();
    writeFileSync(new URL(`streetview/${file}.json`, out), text);
    bytes += text.length;
  }
  // The same spot for the ride: the ground as the app's own surface view reads it (about 2 MB each).
  const polar = await fetch(`${base}/api/terrain/polar?lat=${site.lat}&lon=${site.lon}&source=auto`);
  if (!polar.ok) { console.log(`  ${file}: ride terrain ${polar.status}`); continue; }
  const patch = Buffer.from(await polar.arrayBuffer());
  writeFileSync(new URL(`polar/${file}.bin`, out), patch);
  bytes += patch.byteLength;
}
writeFileSync(new URL('terrain-info.json', out), await (await fetch(`${base}/api/terrain/info`)).text());
console.log(`\nSaved ${(bytes / 1e6).toFixed(0)} MB to public/static/`);
