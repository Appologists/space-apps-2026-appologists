// When can you land? For a landing spot and the next weeks, try every landing hour and say whether the mission
// would pass: Sun and Earth in view at touchdown, never dark for longer than the rover survives. Passing hours are
// ranked by a time score (landingScore below): unbroken sunlight and Earth in view. Pure: no DOM, no fetching.
//
// Method (the "decouple terrain from time" idea): the terrain is reduced once to a horizon profile per spot
// (src/terrain/polar-grid.js, 300 km of LOLA terrain in every direction). The Sun's and Earth's paths come from
// the local ephemeris. Each hour is then one comparison: how far the body clears the horizon in its direction.
// A landing at hour s is judged on the hours s to s + mission length, with runs of darkness measured in full,
// including darkness that is already going at touchdown or still going when the mission ends.

/** Apparent radii seen from the Moon, degrees. The Sun's varies by about 2% over the year; Earth's by about 6%. */
export const SUN_RADIUS_DEG = 0.267;
export const EARTH_RADIUS_DEG = 0.95;

/**
 * When Earth counts as "in view" for the antenna. The landing-site search uses the centre of the disc.
 * "edge": any part of the disc clears the terrain. Radio also bends a little over a ridge (diffraction), so a
 * link can survive slightly past this, but the terrain data (80 m pixels) cannot resolve that well.
 */
export const EARTH_LINK_RULES = Object.freeze({
  centre: { label: 'its centre clears the terrain', marginDeg: 0 },
  edge: { label: 'any part of it clears the terrain', marginDeg: -EARTH_RADIUS_DEG },
});

export const REASON = Object.freeze({
  NO_SUN: 'no-sun-at-landing',
  NO_EARTH: 'no-earth-at-landing',
  DARK: 'dark-too-long',
});

export const REASON_TEXT = {
  [REASON.NO_SUN]: 'no Sun at touchdown',
  [REASON.NO_EARTH]: 'Earth not in view at touchdown',
  [REASON.DARK]: 'too long in the dark',
};

/**
 * How much the time score counts each part (our choice): the longest unbroken sunlight 1, Earth in view 0.7, so
 * 0.59 and 0.41 of the score. They are the default weights of the ranked list of known sites
 * (src/criteria/sunlight.js, earth-comms.js).
 */
export const TIME_SCORE_WEIGHTS = Object.freeze({ sunlight: 1, earthComms: 0.7 });

/**
 * Score of a landing time, 0–1, used only to rank the landing hours that pass: the longest unbroken sunlight as a
 * share of the stay, and the share of the stay with Earth in view, weighted. It is not how the landing-site
 * search ranks places (that is room to miss, src/finder/score.js); one spot's hours all have the same room.
 */
export function landingScore(longestLitH, missionHours, earthFraction, weights = TIME_SCORE_WEIGHTS) {
  const wSun = Math.max(weights.sunlight ?? 0, 0);
  const wEarth = Math.max(weights.earthComms ?? 0, 0);
  if (wSun + wEarth === 0) return 0;
  return (wSun * Math.min(longestLitH / missionHours, 1) + wEarth * earthFraction) / (wSun + wEarth);
}

/**
 * Try every landing time.
 * @param {object} input
 * @param {ArrayLike<number>} input.sunClear     degrees the Sun's centre clears the terrain horizon, one value per step
 * @param {ArrayLike<number>} input.earthClear   the same for Earth (seen from the antenna's height)
 * @param {number} input.stepHours
 * @param {number} input.scanHours               landing times tried: 0 to scanHours (exclusive), one per step
 * @param {number} input.missionHours            how long the rover stays after landing
 * @param {object} [input.rules]
 * @param {boolean} [input.rules.needSunAtLanding=true]
 * @param {boolean} [input.rules.needEarthAtLanding=true]
 * @param {number} [input.rules.maxDarknessHours=Infinity]
 * @param {number} [input.rules.minSunClearDeg=0]       Sun counts as up above this clearance (0: centre of the disc)
 * @param {number} [input.rules.minEarthClearDeg=0]     Earth counts as in view above this (see EARTH_LINK_RULES)
 * @param {object} [input.weights]                      { sunlight, earthComms } for the time score (default TIME_SCORE_WEIGHTS)
 * @returns {{ starts: Array<{ index, hours, pass, reasons: string[], longestDarkH, longestLitH, litFraction,
 *            earthFraction, sunClearDeg, score }>, stepHours }}
 *   Every series must hold at least scanHours + missionHours of steps; more is used to measure darkness that is
 *   still going when the mission ends.
 */
export function scanLandings({ sunClear, earthClear, stepHours, scanHours, missionHours, rules = {}, weights = TIME_SCORE_WEIGHTS }) {
  const { needSunAtLanding = true, needEarthAtLanding = true, maxDarknessHours = Infinity, minSunClearDeg = 0, minEarthClearDeg = 0 } = rules;
  const total = Math.min(sunClear.length, earthClear.length);
  const missionSteps = Math.round(missionHours / stepHours);
  const scanSteps = Math.min(Math.round(scanHours / stepHours), total - missionSteps);
  if (scanSteps <= 0) return { starts: [], stepHours };

  const lit = new Uint8Array(total);
  const earth = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    lit[i] = sunClear[i] > minSunClearDeg ? 1 : 0;
    earth[i] = earthClear[i] > minEarthClearDeg ? 1 : 0;
  }
  // Length (in steps) of the dark run each step belongs to, measured over the whole series, and where it began.
  const runStart = new Int32Array(total);
  const runEnd = new Int32Array(total); // first lit step after the run (or total)
  for (let i = 0; i < total; ) {
    if (lit[i]) {
      runStart[i] = runEnd[i] = i;
      i++;
      continue;
    }
    let j = i;
    while (j < total && !lit[j]) j++;
    for (let k = i; k < j; k++) {
      runStart[k] = i;
      runEnd[k] = j;
    }
    i = j;
  }

  // Running totals, so the share of time lit and in view of Earth over any window is one subtraction.
  const litSum = new Int32Array(total + 1);
  const earthSum = new Int32Array(total + 1);
  for (let i = 0; i < total; i++) {
    litSum[i + 1] = litSum[i] + lit[i];
    earthSum[i + 1] = earthSum[i] + earth[i];
  }

  const starts = new Array(scanSteps);
  const n = missionSteps + 1;
  for (let s = 0; s < scanSteps; s++) {
    const end = s + missionSteps; // last step of the mission (inclusive)
    let bestLit = 0;
    let curLit = 0;
    let longestDark = 0;
    for (let i = s; i <= end; i++) {
      if (lit[i]) {
        curLit++;
        if (curLit > bestLit) bestLit = curLit;
        continue;
      }
      curLit = 0;
      // The rover sits through this dark run from touchdown (or from when it begins, if later) until the light
      // returns, even if that is after the mission ends. A run still going at the end of the data is cut short.
      const steps = runEnd[i] - Math.max(runStart[i], s);
      if (steps > longestDark) longestDark = steps;
      i = Math.min(runEnd[i], end + 1) - 1; // jump to the last dark step of this run inside the mission
    }
    const longestDarkH = longestDark * stepHours;
    const longestLitH = Math.max(bestLit - 1, 0) * stepHours; // as visibilityStats: a run of k samples spans k − 1 steps
    const reasons = [];
    if (needSunAtLanding && !lit[s]) reasons.push(REASON.NO_SUN);
    if (needEarthAtLanding && !earth[s]) reasons.push(REASON.NO_EARTH);
    if (longestDarkH > maxDarknessHours + 1e-9) reasons.push(REASON.DARK);
    const litFraction = (litSum[end + 1] - litSum[s]) / n;
    const earthFraction = (earthSum[end + 1] - earthSum[s]) / n;
    starts[s] = {
      index: s,
      hours: s * stepHours,
      pass: reasons.length === 0,
      reasons,
      longestDarkH,
      longestLitH,
      litFraction,
      earthFraction,
      sunClearDeg: sunClear[s], // how far the Sun's centre clears the terrain at touchdown
      score: landingScore(longestLitH, missionHours, earthFraction, weights),
    };
  }
  return { starts, stepHours };
}

/**
 * True if landing time a ranks above b: the higher time score; on a tie (common: a whole stay in sunlight with Earth
 * always in view scores 1), the shorter longest darkness, then the Sun higher above the terrain at touchdown, so the
 * answer is not the hour the Sun has only just cleared a ridge (our choice).
 */
export function betterLanding(a, b) {
  if (!b) return true;
  if (Math.abs(a.score - b.score) > 1e-12) return a.score > b.score;
  if (a.longestDarkH !== b.longestDarkH) return a.longestDarkH < b.longestDarkH;
  return (a.sunClearDeg ?? 0) > (b.sunClearDeg ?? 0);
}

/** For sorting: best landing time first. */
export const byBetterLanding = (a, b) => (betterLanding(a, b) ? -1 : betterLanding(b, a) ? 1 : 0);

/**
 * Group the landing times that pass into windows (unbroken runs of passing hours), best first.
 * @returns {Array<{ fromHours, toHours, best }>}  best: the best start inside the window (betterLanding)
 */
export function landingWindows(scan) {
  const out = [];
  let cur = null;
  for (const st of scan.starts) {
    if (st.pass) {
      if (!cur) cur = { fromHours: st.hours, toHours: st.hours, best: st };
      cur.toHours = st.hours;
      if (betterLanding(st, cur.best)) cur.best = st;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.sort((a, b) => byBetterLanding(a.best, b.best) || a.fromHours - b.fromHours);
}

/**
 * One summary per day (of `dayHours`, from the start of the scan): the best passing start that day, or the
 * reason most of the day fails.
 * @returns {Array<{ day, best: object|null, passHours, reason: string|null, reasonCounts }>}
 */
export function dailySummary(scan, dayHours = 24) {
  const perDay = Math.max(1, Math.round(dayHours / scan.stepHours));
  const days = [];
  for (let d = 0; d * perDay < scan.starts.length; d++) {
    const slice = scan.starts.slice(d * perDay, (d + 1) * perDay);
    let best = null;
    let passHours = 0;
    const reasonCounts = {};
    for (const st of slice) {
      if (st.pass) {
        passHours += scan.stepHours;
        if (betterLanding(st, best)) best = st;
      } else for (const r of st.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
    }
    const reason = best ? null : Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    days.push({ day: d, best, passHours, reason, reasonCounts });
  }
  return days;
}
