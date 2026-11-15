// Compute, once, which ground sees the Sun and which sees Earth, hour by hour, for every mission region over a
// stretch of dates, and store it in data/raw/light/ (git-ignored). A landing search in one of those regions whose
// mission falls inside the stretch then reads these maps instead of sweeping shadows hour by hour, so it answers
// in about a second whatever its limits or landing date. Searches outside the stretch work as before.
//
//   npm run data:light                                   the default stretch, all regions
//   npm run data:light -- --from 2026-11-14 --to 2027-01-15 --only shackleton,malapert
//
// It reads the same terrain as the app's search, so run it after downloading terrain (npm run data:fetch).
// About a minute per region. Rerun it after changing the code listed in server/light-store.mjs.
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ephemerisSeries } from '../src/astro/ephemeris.js';
import { searchQuestion } from '../src/finder/client.js';
import { defaultFinder } from '../src/finder/score.js';
import { defaultMission } from '../src/mission.js';
import { lightMaps } from '../server/landing-search.mjs';
import { lightCodeKey, lightDir, lightKey, terrainDataKey, writeLight } from '../server/light-store.mjs';
import { createTerrainStore } from '../server/terrain-sources.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : fallback;
};
// The default stretch covers the demo's dates: a landing from 14 Nov 2026 with a two-week mission up to mid-January.
const from = new Date(`${arg('from', '2026-11-14')}T00:00:00Z`);
const to = new Date(`${arg('to', '2027-01-15')}T00:00:00Z`);
const only = arg('only', null)?.split(',');
const hours = Math.round((to - from) / 3_600_000);
if (!(hours > 0)) throw new Error('--to must be after --from');

const read = (file) => JSON.parse(readFileSync(path.join(root, 'data', file), 'utf8'));
const missions = read('missions.json');
const sites = read('sites.json');
const regions = missions.regions
  .map((region) => (region.site ? { ...sites.sites.find((s) => s.id === region.site), id: region.id, searchRadiusKm: region.searchRadiusKm } : region))
  .filter((region) => !only || only.includes(region.id));

const store = createTerrainStore(root);
const dir = lightDir(root);
mkdirSync(dir, { recursive: true });
const codeKey = lightCodeKey(root);
// Ask exactly what the app asks (searchQuestion), so the place, radius and heights match its searches.
const mission = { ...defaultMission(), start: from, durationHours: hours };
const series = ephemerisSeries(from, hours, 60);
console.log(`Sunlight and Earth maps, hourly from ${from.toISOString().slice(0, 16)} to ${to.toISOString().slice(0, 16)} UTC (${hours} h), into ${path.relative(root, dir)}/`);

let total = 0;
for (const region of regions) {
  const started = performance.now();
  const params = { ...searchQuestion({ center: region, values: defaultFinder(), mission }), stepMinutes: 60 };
  const found = await store.demFor(params.center.lat, 'auto', params.center.lon);
  if (!found.dem) {
    console.log(`  ${region.id}: skipped, no terrain data here (${found.missing?.label ?? found.outside?.label ?? 'none'})`);
    continue;
  }
  const maps = lightMaps(found.dem, params, series);
  if (!maps) {
    console.log(`  ${region.id}: skipped, no terrain at the centre`);
    continue;
  }
  const key = lightKey({ ...params, panelHeightM: params.panelHeightM ?? 2, antennaHeightM: params.antennaHeightM ?? 2 }, { dataKey: terrainDataKey(store, params, found), codeKey });
  const file = path.join(dir, `${region.id}-${params.radiusKm}km.bin`);
  writeLight(file, { key, regionId: region.id, start: from.toISOString(), hours: series.samples.length, maskStride: maps.maskStride }, maps.sunMask, maps.earthMask);
  const mb = statSync(file).size / 1e6;
  total += mb;
  console.log(`  ${region.id} (${params.radiusKm} km): ${mb.toFixed(0)} MB in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}
console.log(`Done: ${total.toFixed(0)} MB. The app uses them at once; no restart needed.`);
