// Ask the running app every search the mission steps need for the ready-made profiles, so the answers are
// kept (node_modules/.cache/landing-search) and the steps open at once in front of an audience.
//
//   npm run dev            (in one terminal)
//   npm run demo:warm      (in another; add "-- --port 5174" if the app is not on 5173)
//
// A search the server has not kept takes 10 to 20 seconds; one it has kept takes well under a second.
// Changing the landing date or a landing limit in the app asks new questions, which this does not cover.
import { readFileSync } from 'node:fs';
import { defaultWeights } from '../src/criteria/index.js';
import { searchQuestion } from '../src/finder/client.js';
import { defaultFinder } from '../src/finder/score.js';
import { defaultMission } from '../src/mission.js';

const read = (file) => JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
const missions = read('missions.json');
const sites = read('sites.json');

const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 5173;
const url = `http://localhost:${port}/api/terrain/landing-search`;

const regions = missions.regions.map((region) => (region.site ? { ...sites.sites.find((s) => s.id === region.site), id: region.id } : region));
let failed = 0;
for (const profile of missions.profiles) {
  console.log(`\n${profile.name}`);
  const mission = { ...defaultMission(), start: new Date(profile.mission.start), durationHours: profile.mission.durationHours };
  const values = { ...defaultFinder(), ...profile.finder };
  for (const region of regions) {
    const started = performance.now();
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(searchQuestion({ center: region, values, mission, weights: defaultWeights() })),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? `HTTP ${response.status}`);
      const bytes = (await response.arrayBuffer()).byteLength;
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const kept = response.headers.get('x-landing-search') === 'kept' ? 'already kept' : 'searched and kept';
      console.log(`  ${region.name.padEnd(24)} ${kept.padEnd(18)} ${seconds.padStart(5)} s  ${(bytes / 1e6).toFixed(1)} MB`);
    } catch (error) {
      failed++;
      console.log(`  ${region.name.padEnd(24)} FAILED: ${error.cause?.code === 'ECONNREFUSED' ? `nothing is running on port ${port}. Start the app with "npm run dev".` : error.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
