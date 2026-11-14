import { describe, expect, it } from 'vitest';
import { criteria, defaultWeights, plannedCriteria, readyCriteria } from '../src/criteria/index.js';
import { defaultMission } from '../src/mission.js';
import { createContext, evaluateSites, rankSites } from '../src/scoring/rank.js';
import sitesData from '../data/sites.json';

const mission = { ...defaultMission(new Date('2026-11-14T18:00Z')), durationHours: 14 * 24, stepMinutes: 30 };
const ctx = createContext(mission);
const evaluations = evaluateSites(sitesData.sites, criteria, ctx);

describe('criteria', () => {
  it('have unique ids and the required fields', () => {
    expect(new Set(criteria.map((c) => c.id)).size).toBe(criteria.length);
    for (const c of criteria) {
      expect(c.label).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(['ready', 'planned']).toContain(c.status);
      expect(typeof c.evaluate).toBe('function');
    }
    expect(readyCriteria.length).toBeGreaterThan(0);
  });

  it('return a 0–1 score (or null) and a summary for every site', () => {
    for (const { site, results } of evaluations) {
      for (const c of readyCriteria) {
        const r = results[c.id];
        expect(typeof r.summary, `${c.id} @ ${site.id}`).toBe('string');
        if (r.score != null) {
          expect(r.score).toBeGreaterThanOrEqual(0);
          expect(r.score).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('planned criteria never produce a score', () => {
    for (const c of plannedCriteria) expect(c.evaluate(sitesData.sites[0], ctx).score).toBeNull();
  });

  it('know that the far side never sees Earth and the near side always does', () => {
    const byId = Object.fromEntries(evaluations.map((e) => [e.site.id, e.results]));
    expect(byId['change-4'].earthComms.score).toBe(0);
    expect(byId['apollo-11'].earthComms.score).toBe(1);
  });

  it('give an equatorial site at most about half a lunar day of unbroken sunlight', () => {
    const apollo = evaluations.find((e) => e.site.id === 'apollo-11').results.sunlight;
    expect(apollo.value).toBeGreaterThan(0);
    expect(apollo.value).toBeLessThan(15.2 * 24);
  });
});

describe('ranking', () => {
  it('orders by weighted score and numbers the ranks', () => {
    const ranking = rankSites(evaluations, defaultWeights());
    expect(ranking).toHaveLength(sitesData.sites.length);
    expect(ranking[0].rank).toBe(1);
    for (let i = 1; i < ranking.length; i++) expect(ranking[i - 1].total).toBeGreaterThanOrEqual(ranking[i].total);
  });

  it('follows the weights', () => {
    const onlyEarth = rankSites(evaluations, { sunlight: 0, earthComms: 1 });
    expect(onlyEarth.at(-1).results.earthComms.score).toBe(0);
    expect(onlyEarth[0].total).toBe(onlyEarth[0].results.earthComms.score);
  });

  it('leaves out missing data instead of counting it as zero', () => {
    const fake = [
      { site: { id: 'a', name: 'A' }, results: { x: { score: 0.8 }, y: { score: null } } },
      { site: { id: 'b', name: 'B' }, results: { x: { score: 0.6 }, y: { score: 0.6 } } },
    ];
    const ranking = rankSites(fake, { x: 1, y: 1 });
    expect(ranking[0].site.id).toBe('a');
    expect(ranking[0].total).toBeCloseTo(0.8);
    expect(ranking[0].coverage).toBeCloseTo(0.5);
    expect(ranking[1].coverage).toBe(1);
  });

  it('gives no total when every weight is zero', () => {
    const ranking = rankSites(evaluations, { sunlight: 0, earthComms: 0 });
    expect(ranking[0].total).toBeNull();
    expect(ranking[0].rank).toBeNull();
  });
});
