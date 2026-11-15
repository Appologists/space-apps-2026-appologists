import { describe, expect, it } from 'vitest';
import { REASON, TIME_SCORE_WEIGHTS, dailySummary, landingScore, landingWindows, scanLandings } from '../src/finder/date-scan.js';

/** Clearance series from a pattern: '#' = clear by +5°, '.' = blocked by −5°. One character per hour. */
const series = (pattern) => Float64Array.from(pattern, (c) => (c === '#' ? 5 : -5));
const allClear = (n) => new Float64Array(n).fill(5);

describe('scanLandings', () => {
  it('passes every landing on a Moon that is always lit and always sees Earth, with a perfect score', () => {
    const scan = scanLandings({ sunClear: allClear(30), earthClear: allClear(30), stepHours: 1, scanHours: 20, missionHours: 10, rules: { maxDarknessHours: 5 } });
    expect(scan.starts.length).toBe(20);
    expect(scan.starts.every((s) => s.pass)).toBe(true);
    expect(scan.starts[0].longestLitH).toBe(10);
    expect(scan.starts[0].score).toBe(1);
  });

  it('fails a landing in the dark, and one with Earth hidden, saying why', () => {
    const sun = series('..########################');
    const earth = series('####..####################');
    const scan = scanLandings({ sunClear: sun, earthClear: earth, stepHours: 1, scanHours: 10, missionHours: 8 });
    expect(scan.starts[0].reasons).toContain(REASON.NO_SUN);
    expect(scan.starts[4].reasons).toEqual([REASON.NO_EARTH]);
    expect(scan.starts[6].pass).toBe(true);
  });

  it('measures a dark run in full even when it runs past the end of the mission', () => {
    // Landing at hour 0: lit for 6 h, then dark from hour 6 to hour 15 (9 h), but the mission ends at hour 8.
    const sun = series('######.........###########');
    const scan = scanLandings({ sunClear: sun, earthClear: allClear(26), stepHours: 1, scanHours: 2, missionHours: 8, rules: { maxDarknessHours: 4 } });
    expect(scan.starts[0].longestDarkH).toBe(9);
    expect(scan.starts[0].reasons).toEqual([REASON.DARK]);
  });

  it('counts darkness only from touchdown when landing in the dark is allowed', () => {
    const sun = series('......####################');
    const scan = scanLandings({ sunClear: sun, earthClear: allClear(26), stepHours: 1, scanHours: 5, missionHours: 10, rules: { needSunAtLanding: false, maxDarknessHours: 100 } });
    expect(scan.starts[0].longestDarkH).toBe(6);
    expect(scan.starts[4].longestDarkH).toBe(2); // landed at hour 4: two dark hours left
  });

  it('uses the longest unbroken sunlight and the share of time Earth is in view for the score', () => {
    const sun = series('####.#######..............'); // 12 steps of mission from hour 0: runs of 4 and 7 samples
    const earth = series('######......##############');
    const scan = scanLandings({ sunClear: sun, earthClear: earth, stepHours: 1, scanHours: 1, missionHours: 11, rules: { maxDarknessHours: 100 }, weights: { sunlight: 1, earthComms: 1 } });
    const st = scan.starts[0];
    expect(st.longestLitH).toBe(6); // 7 samples span 6 hours
    expect(st.earthFraction).toBeCloseTo(6 / 12, 9);
    expect(st.score).toBeCloseTo(landingScore(6, 11, 0.5, { sunlight: 1, earthComms: 1 }), 12);
  });

  it('lets Earth count as in view while only its edge clears the terrain', () => {
    const earth = Float64Array.from({ length: 20 }, () => -0.5); // centre 0.5° behind the ridge, edge above
    const strict = scanLandings({ sunClear: allClear(20), earthClear: earth, stepHours: 1, scanHours: 5, missionHours: 10 });
    const edge = scanLandings({ sunClear: allClear(20), earthClear: earth, stepHours: 1, scanHours: 5, missionHours: 10, rules: { minEarthClearDeg: -0.95 } });
    expect(strict.starts[0].reasons).toEqual([REASON.NO_EARTH]);
    expect(edge.starts[0].pass).toBe(true);
  });

  it('returns nothing when the data is too short for even one mission', () => {
    expect(scanLandings({ sunClear: allClear(5), earthClear: allClear(5), stepHours: 1, scanHours: 3, missionHours: 10 }).starts).toEqual([]);
  });
});

describe('landingWindows and dailySummary', () => {
  it('groups passing hours into windows, best first, and summarises each day', () => {
    const sun = series('###.....####.....#######################################################');
    const scan = scanLandings({ sunClear: sun, earthClear: allClear(sun.length), stepHours: 1, scanHours: 48, missionHours: 4, rules: { maxDarknessHours: 3 } });
    const windows = landingWindows(scan);
    expect(windows.length).toBeGreaterThan(0);
    for (let i = 1; i < windows.length; i++) expect(windows[i - 1].best.score).toBeGreaterThanOrEqual(windows[i].best.score);
    const days = dailySummary(scan, 24);
    expect(days.length).toBe(2);
    expect(days[1].best).not.toBe(null);
    expect(days[1].passHours).toBe(24);
  });

  it('names the most common reason on a day where nothing passes', () => {
    const scan = scanLandings({ sunClear: new Float64Array(60).fill(-5), earthClear: allClear(60), stepHours: 1, scanHours: 24, missionHours: 10 });
    const [day] = dailySummary(scan, 24);
    expect(day.best).toBe(null);
    expect(day.reason).toBe(REASON.NO_SUN);
  });
  it('scores landing times with its own stated weights, not the search\'s', () => {
    expect(TIME_SCORE_WEIGHTS).toEqual({ sunlight: 1, earthComms: 0.7 });
    expect(landingScore(14, 14, 1)).toBe(1);
    expect(landingScore(7, 14, 0)).toBeCloseTo(0.5 / 1.7, 12);
  });

  it('on equal scores, picks the hour with the Sun higher above the terrain', () => {
    // always lit and in view of Earth (every hour scores 1); the Sun climbs from just over the ridge
    const sun = Array.from({ length: 40 }, (_, i) => 0.01 + i * 0.1);
    const earth = new Array(40).fill(5);
    const scan = scanLandings({ sunClear: sun, earthClear: earth, stepHours: 1, scanHours: 10, missionHours: 20 });
    const [win] = landingWindows(scan);
    expect(win.fromHours).toBe(0);
    expect(win.best.hours).toBe(9);
    expect(dailySummary(scan, 24)[0].best.hours).toBe(9);
  });
});
