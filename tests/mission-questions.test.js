// The mission questions: one definition for the Mission step (flow.js) and the "Plan a mission" pop-up (shell.js).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import missions from '../data/missions.json';
import { GROUPS, groupSummary, landingText, movedBy, optionsWith, same } from '../src/ui/mission-questions.js';

const questions = GROUPS.flatMap((group) => group.choices);
const question = (key) => questions.find((def) => def.key === key);

describe('the mission questions', () => {
  it('ask landing accuracy as 100 m, 200 m and 2 km, each with its source (decision V)', () => {
    const options = question('ellipseRadiusM').options;
    expect(options.map(([value]) => value)).toEqual([100, 200, 2000]);
    expect(options.map(([, text]) => text)).toEqual(['100 m', '200 m', '2 km']);
    for (const [, , source] of options) expect(source).toMatch(/NASA|Our choice/);
  });

  it('ask the mission length with the slider and the landing time with its own row', () => {
    expect(question('durationHours')).toMatchObject({ on: 'mission', slider: true });
    expect(GROUPS[0].date).toBe(true);
  });

  it('do not ask for a rover range limit', () => {
    expect(question('roverRangeKm')).toBeUndefined();
  });

  it('have a button for every value of the ready-made missions', () => {
    for (const profile of missions.profiles) {
      for (const def of questions.filter((d) => d.on === 'finder')) {
        expect(def.options.some(([value]) => same(value, profile.finder[def.key])), `${profile.id} ${def.key}`).toBe(true);
      }
    }
  });

  it('give a value set elsewhere a button of its own', () => {
    const def = question('ellipseRadiusM');
    expect(optionsWith(def, 200)).toBe(def.options);
    expect(optionsWith(def, 350).at(-1)).toEqual([350, '350 m']);
  });

  it('say a group in a few words, leaving out what is not needed', () => {
    const preset = missions.profiles.find((p) => p.id === 'nasa');
    const valueOf = (def) => (def.on === 'mission' ? preset.mission[def.key] : preset.finder[def.key]);
    const start = new Date(preset.mission.start);
    expect(groupSummary(GROUPS[0], valueOf, start)).toEqual(['21 Nov 2026, 00:00 UTC', 'for 2 weeks']);
    expect(groupSummary(GROUPS[1], valueOf, start)).toEqual(['within 100 m', 'slopes up to 10°', 'Earth in view', 'in sunlight']);
    expect(groupSummary(GROUPS[2], (def) => ({ ...preset.finder, roverNeedsEarthToDrive: false })[def.key], start)).toEqual(['survives 50 h dark', 'slopes up to 15°', '36 m/hr']);
  });

  it('move the landing time by whole hours, in UTC', () => {
    const start = new Date('2026-11-21T00:00:00Z');
    expect(landingText(movedBy(start, -1))).toBe('20 Nov 2026, 23:00 UTC');
    expect(movedBy(start, 24 * 7).toISOString()).toBe('2026-11-28T00:00:00.000Z');
  });
});

describe('one definition', () => {
  // The pop-up once carried its own copy of the questions, which fell behind the Mission step's.
  for (const file of ['shell.js', 'flow.js']) {
    it(`${file} takes the questions from mission-questions.js and lists none of its own`, () => {
      const source = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
      expect(source).toMatch(/import \{[^}]*GROUPS[^}]*\} from '\.\/mission-questions\.js'/);
      expect(source).not.toMatch(/options:\s*\[\[/);
      expect(source).not.toMatch(/const GROUPS\b/);
    });
  }
});
