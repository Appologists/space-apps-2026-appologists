// The mission regions, built in one place for the app and for the tools that ask its searches ahead of time.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import missions from '../data/missions.json';
import sitesData from '../data/sites.json';
import { defaultWeights } from '../src/criteria/index.js';
import { searchQuestion, staticKey } from '../src/finder/client.js';
import { missionRegions } from '../src/finder/regions.js';
import { defaultFinder } from '../src/finder/score.js';
import { defaultMission } from '../src/mission.js';

const regions = missionRegions(missions, sitesData);

describe('the mission regions', () => {
  it('each have a name, a place and a source', () => {
    expect(regions.map((r) => r.id)).toEqual(missions.regions.map((r) => r.id));
    for (const region of regions) {
      expect(region.name, region.id).toBeTruthy();
      expect(Math.abs(region.lat), region.id).toBeLessThanOrEqual(90);
      expect(Math.abs(region.lon), region.id).toBeLessThanOrEqual(180);
      expect(region.source, region.id).toBeTruthy();
    }
  });

  it('keep the wider search of the crater regions, whether the place comes from sites.json or not', () => {
    for (const region of missions.regions) {
      expect(regions.find((r) => r.id === region.id).searchRadiusKm, region.id).toBe(region.searchRadiusKm);
    }
    expect(regions.find((r) => r.id === 'shackleton').searchRadiusKm).toBe(20);
    expect(regions.find((r) => r.id === 'peak-near-shackleton').searchRadiusKm).toBeUndefined();
  });

  it('are what the app and both tools use, so a saved search is found under the question the app asks', () => {
    for (const file of ['src/ui/flow.js', 'tools/warm-demo.mjs', 'tools/export-static.mjs']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect(source, file).toMatch(/missionRegions\(missions, \w+\)/);
      expect(source, file).not.toMatch(/missions\.regions\.map/);
    }
  });
});

describe('the name of a saved search (the website build)', () => {
  const profile = missions.profiles.find((p) => p.id === 'nasa');
  const mission = { ...defaultMission(), start: new Date(profile.mission.start), durationHours: profile.mission.durationHours };
  const values = { ...defaultFinder(), ...profile.finder };
  const ask = (region, v = values) => searchQuestion({ center: region, values: v, mission, weights: defaultWeights() });

  it('is the same however the question was put together, and different for a different question', async () => {
    const question = ask(regions[0]);
    const shuffled = Object.fromEntries(Object.entries(question).reverse());
    expect(await staticKey(shuffled)).toBe(await staticKey(question));
    expect(await staticKey(question)).toMatch(/^[0-9a-f]{40}$/);
    expect(await staticKey(ask(regions[0], { ...values, ellipseRadiusM: 200 }))).not.toBe(await staticKey(question));
    expect(await staticKey(ask(regions[2]))).not.toBe(await staticKey(question));
  });

  it('does not depend on the rover, which does not change where a landing passes', async () => {
    expect(await staticKey(ask(regions[0], { ...values, roverSpeedMPerHour: 720, roverNeedsEarthToDrive: false }))).toBe(await staticKey(ask(regions[0])));
  });
});
