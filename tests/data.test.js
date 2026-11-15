import { describe, expect, it } from 'vitest';
import sitesData from '../data/sites.json';
import catalog from '../data/catalog.json';

describe('data/sites.json', () => {
  it('has unique ids, valid coordinates, a known category and a source', () => {
    const ids = new Set();
    for (const site of sitesData.sites) {
      expect(ids.has(site.id), `duplicate id ${site.id}`).toBe(false);
      ids.add(site.id);
      expect(site.name).toBeTruthy();
      expect(Math.abs(site.lat)).toBeLessThanOrEqual(90);
      expect(site.lon).toBeGreaterThan(-180);
      expect(site.lon).toBeLessThanOrEqual(180);
      expect(sitesData.categories[site.category], `category of ${site.id}`).toBeTruthy();
      expect(sitesData.sources[site.source], `source of ${site.id}`).toBeTruthy();
    }
  });
});

describe('data/catalog.json', () => {
  it('lists each dataset with an id, a licence and https files with sizes', () => {
    const ids = new Set();
    for (const d of catalog.datasets) {
      expect(d.id).toMatch(/^[a-z0-9-]+$/);
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(d.title).toBeTruthy();
      expect(d.license).toBeTruthy();
      expect(d.files.length).toBeGreaterThan(0);
      for (const f of d.files) {
        expect(f.url).toMatch(/^https:\/\//);
        expect(f.bytes).toBeGreaterThan(0);
      }
    }
  });
});

describe('data/missions.json', () => {
  it('gives every profile fact and every region a known source, and regions valid coordinates', async () => {
    const { default: missions } = await import('../data/missions.json');
    for (const profile of missions.profiles) {
      expect(profile.name).toBeTruthy();
      expect(Number.isNaN(new Date(profile.mission.start).getTime())).toBe(false);
      for (const fact of profile.facts) expect(missions.sources[fact.source], `source of "${fact.text}"`).toBeTruthy();
    }
    const ids = new Set();
    for (const region of missions.regions) {
      expect(ids.has(region.id)).toBe(false);
      ids.add(region.id);
      const site = region.site ? sitesData.sites.find((s) => s.id === region.site) : region;
      expect(site, `site of region ${region.id}`).toBeTruthy();
      expect(Math.abs(site.lat)).toBeLessThanOrEqual(90);
      expect(site.lon).toBeGreaterThan(-180);
      expect(site.lon).toBeLessThanOrEqual(180);
      expect(region.site ? sitesData.sources[site.source] : missions.sources[region.source], `source of region ${region.id}`).toBeTruthy();
    }
  });
});
