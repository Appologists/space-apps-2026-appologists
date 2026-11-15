import { describe, expect, it } from 'vitest';
import { DURATION_MARKS, LUNAR_DAY_HOURS, durationAt, formatDuration, positionOf, stepMinutesFor, tidyDuration } from '../src/mission.js';

describe('the mission-length slider', () => {
  it('runs from 1 hour to 1 year, with the clean lengths evenly spaced', () => {
    expect(durationAt(0)).toBe(1);
    expect(durationAt(1)).toBeCloseTo(8760);
    const last = DURATION_MARKS.length - 1;
    DURATION_MARKS.forEach((mark, i) => {
      expect(durationAt(i / last)).toBeCloseTo(mark.hours, 6);
      expect(positionOf(mark.hours)).toBeCloseTo(i / last, 9);
    });
  });

  it('grows steadily: each step along the slider multiplies the length, never shrinks it', () => {
    let before = 0;
    for (let p = 0; p <= 1.0000001; p += 0.001) {
      const hours = durationAt(p);
      expect(hours).toBeGreaterThan(before);
      before = hours;
      expect(positionOf(hours)).toBeCloseTo(p, 6);
    }
  });

  it('snaps to a clean length near it, and otherwise tidies to hours or days', () => {
    const last = DURATION_MARKS.length - 1;
    expect(tidyDuration(3 / last + 0.01)).toBe(14 * 24);
    expect(tidyDuration(0.5 / last)).toBe(5); // between 1 hour and 1 day: about 5 hours
    const days = tidyDuration(4.5 / last); // between 4 weeks and 6 months
    expect(days % 24).toBe(0);
    expect(days).toBeGreaterThan(28 * 24);
    expect(days).toBeLessThan(182.5 * 24);
  });

  it('says lengths in plain words', () => {
    expect(formatDuration(1)).toBe('1 hour');
    expect(formatDuration(5)).toBe('5 hours');
    expect(formatDuration(24)).toBe('1 day');
    expect(formatDuration(30)).toBe('30 hours');
    expect(formatDuration(48)).toBe('2 days');
    expect(formatDuration(96)).toBe('4 days');
    expect(formatDuration(14 * 24)).toBe('2 weeks');
    expect(formatDuration(45 * 24)).toBe('45 days');
    expect(formatDuration(182.5 * 24)).toBe('6 months');
    expect(formatDuration(365 * 24)).toBe('1 year');
    expect(formatDuration(LUNAR_DAY_HOURS)).toBe('29.5 days (one lunar day)');
  });

  it('keeps a year to about 2,200 Sun and Earth samples', () => {
    const hours = 365 * 24;
    expect(hours / (stepMinutesFor(hours) / 60)).toBeLessThanOrEqual(2200);
    expect(stepMinutesFor(14 * 24)).toBe(15); // unchanged for the lengths that existed before
    expect(stepMinutesFor(90 * 24)).toBe(60);
  });
});
