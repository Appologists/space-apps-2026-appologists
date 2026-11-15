// Does a search that reads the stored sunlight and Earth maps (npm run data:light) give exactly the answer of
// one that computes them? Runs one region both ways, for a mission inside the stored stretch, and compares every
// number. Run it after `npm run data:light` and after changing the search.
//
//   npm run check:light                          Connecting Ridge, landing 21 Nov 2026, 14 days
//   npm run check:light -- --region malapert --start 2026-12-24T00:00Z --hours 336
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defaultWeights } from '../src/criteria/index.js';
import { searchQuestion } from '../src/finder/client.js';
import { defaultFinder } from '../src/finder/score.js';
import { defaultMission } from '../src/mission.js';
import { searchLanding } from '../server/landing-search.mjs';
import { createLightStore, lightCodeKey, lightDir, terrainDataKey } from '../server/light-store.mjs';
import { createTerrainStore } from '../server/terrain-sources.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const id = arg('region', 'connecting-ridge');
const read = (file) => JSON.parse(readFileSync(path.join(root, 'data', file), 'utf8'));
const missions = read('missions.json');
const sites = read('sites.json');
const raw = missions.regions.find((r) => r.id === id);
if (!raw) throw new Error(`No region "${id}" in data/missions.json`);
const region = raw.site ? { ...sites.sites.find((s) => s.id === raw.site), searchRadiusKm: raw.searchRadiusKm } : raw;
const profile = missions.profiles[0];
const mission = { ...defaultMission(), start: new Date(arg('start', profile.mission.start)), durationHours: Number(arg('hours', profile.mission.durationHours)) };
const params = searchQuestion({ center: region, values: { ...defaultFinder(), ...profile.finder }, mission, weights: defaultWeights() });

const store = createTerrainStore(root);
const found = await store.demFor(params.center.lat, 'auto', params.center.lon);
if (!found.dem) throw new Error('No terrain data for this region: npm run data:fetch first');
const light = createLightStore(lightDir(root));
const keys = { dataKey: terrainDataKey(store, params, found), codeKey: lightCodeKey(root) };

let t = performance.now();
const stored = searchLanding(found.dem, params, { storedLight: (p, series) => light.find(p, keys, series) });
const storedMs = performance.now() - t;
if (!stored.header.lightStored) {
  console.log(`No stored maps cover ${id} for this mission (${light.count()} region files found). Run npm run data:light first.`);
  process.exit(1);
}
t = performance.now();
const computed = searchLanding(found.dem, params);
const computedMs = performance.now() - t;

let differences = 0;
for (const [name, values] of Object.entries(computed.rasters)) {
  const other = stored.rasters[name];
  for (let i = 0; i < values.length; i++) {
    if (values[i] === other[i] || (Number.isNaN(values[i]) && Number.isNaN(other[i]))) continue;
    if (differences++ < 5) console.log(`  differs: ${name}[${i}] computed ${values[i]}, stored ${other[i]}`);
  }
}
const same = (key) => JSON.stringify(computed.header[key]) === JSON.stringify(stored.header[key]);
console.log(`${id}: stored maps ${(storedMs / 1000).toFixed(1)} s, computed ${(computedMs / 1000).toFixed(1)} s`);
console.log(differences === 0 && same('sites') && same('counts') ? 'Same answer, number for number.' : `NOT the same: ${differences} values differ.`);
process.exit(differences === 0 && same('sites') && same('counts') ? 0 : 1);
