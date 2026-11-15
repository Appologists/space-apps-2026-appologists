import { describe, expect, it } from 'vitest';
import { latestDeparture, planMission } from '../src/finder/planner.js';
import { maskBit, simulateDrive, STATE, TIME_TOL } from '../src/finder/schedule.js';

const setBit = (mask, stride, step, cell, v = 1) => {
  const i = step * stride + (cell >> 3);
  if (v) mask[i] |= 1 << (cell & 7);
  else mask[i] &= ~(1 << (cell & 7));
};

/** A flat, fully sunlit square of n by n cells of 100 m, with one-hour steps. */
function fake({ steps = 48, n = 7 } = {}) {
  const size = n * n;
  const stride = Math.ceil(size / 8);
  const r = {
    n,
    cellM: 100,
    elevation: new Float32Array(size),
    slope: new Float32Array(size),
    fail: new Uint8Array(size),
    steps,
    stepHours: 1,
    windowHours: steps - 1,
    maskStride: stride,
    sunMask: new Uint8Array(steps * stride).fill(255),
    earthMask: new Uint8Array(steps * stride).fill(255),
  };
  r.cell = (row, col) => row * n + col;
  r.dark = (row, col, from, to) => {
    for (let s = from; s <= Math.min(to, steps - 1); s++) setBit(r.sunMask, stride, s, r.cell(row, col), 0);
  };
  r.noEarth = (row, col, from, to) => {
    for (let s = from; s <= Math.min(to, steps - 1); s++) setBit(r.earthMask, stride, s, r.cell(row, col), 0);
  };
  /** Leave only one row drivable: a corridor with no way round. */
  r.corridor = (keepRow) => {
    for (let row = 0; row < n; row++) if (row !== keepRow) for (let col = 0; col < n; col++) r.slope[r.cell(row, col)] = 30;
  };
  return r;
}
const rover = { maxSlopeDeg: 15, rangeM: 1e9, speedMPerHour: 100, maxDarknessHours: 100 };
const at = (row, col) => ({ row, col });

/** A plan must be a real drive: neighbouring drivable cells, no cut corners, and a replay that agrees. */
function expectSound(r, plan, limits = rover) {
  expect(plan.selfCheck).toBe(true);
  const { n } = r;
  for (let p = 0; p < plan.path.length; p++) {
    const i = plan.path[p];
    expect(r.slope[i]).toBeLessThanOrEqual(limits.maxSlopeDeg);
    if (!p) continue;
    const a = plan.path[p - 1];
    const dr = Math.abs(((i / n) | 0) - ((a / n) | 0));
    const dc = Math.abs((i % n) - (a % n));
    expect(Math.max(dr, dc)).toBe(1);
    if (dr && dc) {
      expect(r.slope[((a / n) | 0) * n + (i % n)]).toBeLessThanOrEqual(limits.maxSlopeDeg);
      expect(r.slope[((i / n) | 0) * n + (a % n)]).toBeLessThanOrEqual(limits.maxSlopeDeg);
    }
  }
  expect(plan.distanceM).toBeLessThanOrEqual(limits.rangeM + 1e-3);
  if (plan.ok) {
    expect(plan.drive.arrived).toBe(true);
    expect(plan.drive.survived).toBe(true);
    expect(plan.drive.longestDarkH).toBeLessThanOrEqual(limits.maxDarknessHours);
  }
}

describe('planMission, one destination', () => {
  it('drives straight there on sunlit ground, like the fixed route', () => {
    const r = fake();
    const plan = planMission(r, at(3, 0), [at(3, 5)], rover);
    expect(plan.ok).toBe(true);
    expect(plan.path).toEqual([21, 22, 23, 24, 25, 26]);
    expect(plan.drive.arrivalHours).toBe(5);
    expect(plan.distanceM).toBeCloseTo(500, 3);
    expect(plan.shortestM).toBeCloseTo(500, 3);
    expect(plan.waits).toEqual([]);
    expect(plan.stops).toEqual([{ destination: 0, row: 3, col: 5, pathIndex: 5, arrivalHours: 5 }]);
    expect(plan.drive.arrivalHours).toBe(simulateDrive(r, plan.path, rover).arrivalHours);
    expectSound(r, plan);
  });

  it('waits for a passing shadow when that beats the way round', () => {
    const r = fake();
    // A shadow lies across column 3 (rows 1 to 5) for the first four hours. Round it is 6 diagonal hops (8.5 h).
    for (let row = 1; row <= 5; row++) r.dark(row, 3, 0, 3);
    const plan = planMission(r, at(3, 0), [at(3, 6)], rover);
    expect(plan.ok).toBe(true);
    expect(plan.path).toEqual([21, 22, 23, 24, 25, 26, 27]);
    // waits an hour at (3,2), enters (3,3) in the last dark hour, drives on at hour 4
    expect(plan.drive.arrivalHours).toBe(7);
    expect(plan.waits).toEqual([{ row: 3, col: 2, pathIndex: 2, fromHours: 2, hours: 1, state: STATE.HOLD }]);
    expectSound(r, plan);
    // A rover that may not sit in the dark at all waits one hour more.
    const strict = planMission(r, at(3, 0), [at(3, 6)], { ...rover, maxDarknessHours: 0 });
    expect(strict.drive.arrivalHours).toBe(8);
    expect(strict.drive.longestDarkH).toBe(0);
    expectSound(r, strict, { ...rover, maxDarknessHours: 0 });
  });

  it('goes round a shadow that stays too long', () => {
    const r = fake();
    for (let row = 1; row <= 5; row++) r.dark(row, 3, 0, 19);
    const plan = planMission(r, at(3, 0), [at(3, 6)], rover);
    expect(plan.ok).toBe(true);
    expect(plan.distanceM).toBeCloseTo(600 * Math.SQRT2, 2);
    expect(plan.drive.arrivalHours).toBe(9);
    for (const i of plan.path) expect(i % 7 === 3 && i >= 7 && i < 42).toBe(false);
    expect(plan.shortestM).toBeCloseTo(600, 3);
    expectSound(r, plan);
  });

  it('keeps to the direct way and waits when the way round is beyond the range', () => {
    const r = fake();
    for (let row = 1; row <= 5; row++) r.dark(row, 3, 0, 19);
    const short = { ...rover, rangeM: 700 };
    const plan = planMission(r, at(3, 0), [at(3, 6)], short);
    expect(plan.ok).toBe(true);
    expect(plan.distanceM).toBeCloseTo(600, 3);
    expect(plan.drive.arrivalHours).toBe(23);
    expectSound(r, plan, short);
  });

  it('holds back in sunlight where driving on at once would freeze the rover', () => {
    const r = fake();
    r.corridor(3);
    r.dark(3, 3, 0, 9);
    r.dark(3, 4, 0, 9);
    const fragile = { ...rover, maxDarknessHours: 2 };
    const plan = planMission(r, at(3, 0), [at(3, 6)], fragile);
    expect(plan.ok).toBe(true);
    expect(plan.drive.arrivalHours).toBe(13);
    expect(plan.drive.longestDarkH).toBeLessThanOrEqual(2);
    expectSound(r, plan, fragile);
    // The same route driven as soon as the rules allow: it enters the shadow at once and is lost.
    const eager = simulateDrive(r, plan.path, fragile);
    expect(eager.survived).toBe(false);
  });

  it('takes the longer way round when Earth is out of view on the direct one', () => {
    const r = fake();
    r.noEarth(3, 2, 0, 9);
    const needy = { ...rover, needEarthToDrive: true };
    const plan = planMission(r, at(3, 0), [at(3, 5)], needy);
    expect(plan.ok).toBe(true);
    expect(plan.path).not.toContain(r.cell(3, 2));
    expect(plan.drive.arrivalHours).toBe(6); // 5.83 h of driving
    expectSound(r, plan, needy);
    expect(planMission(r, at(3, 0), [at(3, 5)], rover).path).toContain(r.cell(3, 2));
  });

  it('leaves no earlier than asked, and waits at a dark start', () => {
    const r = fake();
    const late = planMission(r, at(3, 0), [at(3, 5)], { ...rover, departHours: 10 });
    expect(late.drive.timeline[9]).toBe(STATE.PARKED);
    expect(late.drive.timeline[10]).toBe(STATE.DRIVING);
    expect(late.drive.arrivalHours).toBe(15);
    const r2 = fake();
    r2.dark(3, 0, 0, 5);
    const plan = planMission(r2, at(3, 0), [at(3, 5)], rover);
    expect(plan.drive.timeline[5]).toBe(STATE.WAIT_SUN);
    expect(plan.drive.arrivalHours).toBe(11);
    expectSound(r2, plan);
  });
});

describe('planMission, when nothing works', () => {
  it('says there is no sunlit way when the only way is never lit', () => {
    const r = fake();
    r.corridor(3);
    r.dark(3, 3, 0, 47);
    const plan = planMission(r, at(3, 0), [at(3, 6)], rover);
    expect(plan.ok).toBe(false);
    expect(plan.status).toBe('no-plan');
    expect(plan.path).toBeNull();
    expect(plan.reasons[0].code).toBe('no-way');
    expect(plan.reasons[0].helps).toEqual([]);
  });

  it('counts reaching the last destination as success, whatever the light does there afterwards (decision U)', () => {
    const r = fake();
    r.dark(3, 5, 20, 47); // the destination goes dark for good after the rover gets there
    const fragile = { ...rover, maxDarknessHours: 10 };
    const plan = planMission(r, at(3, 0), [at(3, 5)], fragile);
    expect(plan.ok).toBe(true);
    expect(plan.status).toBe('ok');
    expect(plan.drive.arrivalHours).toBe(5);
    expect(plan.drive.survived).toBe(true);
    expect(plan.drive.lostAtHours).toBeNull();
    expect(plan.drive.timeline[40]).toBe(STATE.ARRIVED);
    expectSound(r, plan, fragile);
  });

  it('with the old rule, shows the drive when the rover gets there and then freezes, and what would help', () => {
    const r = fake();
    r.dark(3, 5, 20, 47);
    const fragile = { ...rover, maxDarknessHours: 10, surviveAfterArrival: true };
    const plan = planMission(r, at(3, 0), [at(3, 5)], fragile);
    expect(plan.ok).toBe(false);
    expect(plan.status).toBe('lost-after-arrival');
    expect(plan.drive.arrived).toBe(true);
    expect(plan.drive.survived).toBe(false);
    expect(plan.drive.lostAtHours).toBe(30);
    expect(plan.reasons[0].helps.map((h) => h.change)).toEqual(['darkness']);
    expect(plan.reasons[0].helps[0].longestDarkH).toBe(28);
  });

  it('with the old rule, arrives late on purpose when that is the only way not to freeze', () => {
    const r = fake();
    r.dark(3, 5, 4, 30); // dark for 27 hours soon after an early arrival; the rover survives 10
    const fragile = { ...rover, maxDarknessHours: 10, surviveAfterArrival: true };
    const plan = planMission(r, at(3, 0), [at(3, 5)], fragile);
    expect(plan.ok).toBe(true);
    // arrives in hour 20 (recorded dark for hours 20 to 30 would be 11): so hour 21, dark for 10
    expect(plan.drive.arrivalHours).toBe(22);
    expect(plan.drive.longestDarkH).toBe(10);
    expectSound(r, plan, fragile);
  });

  it('names what blocks a destination before any timing: steep ground, no path, out of range', () => {
    const r = fake();
    r.slope[r.cell(3, 5)] = 30;
    expect(planMission(r, at(3, 0), [at(3, 5)], rover).reasons).toEqual([{ code: 'dest-steep', destination: 0 }]);
    const walled = fake();
    for (let row = 0; row < 7; row++) walled.slope[walled.cell(row, 3)] = 30;
    expect(planMission(walled, at(3, 0), [at(3, 1), at(3, 5)], rover).reasons).toEqual([{ code: 'dest-no-path', destination: 1 }]);
    const far = planMission(fake(), at(3, 0), [at(3, 5)], { ...rover, rangeM: 300 });
    expect(far.reasons[0].code).toBe('dest-beyond-range');
    expect(far.reasons[0].neededM).toBeCloseTo(500, 3);
    expect(planMission(fake(), at(3, 0), [], rover).reasons[0].code).toBe('no-destination');
  });

  it('says so when the rover is lost at the start', () => {
    const r = fake();
    r.dark(3, 0, 0, 20);
    const plan = planMission(r, at(3, 0), [at(3, 5)], { ...rover, maxDarknessHours: 5 });
    expect(plan.reasons).toEqual([{ code: 'start-lost', lostAtHours: 5 }]);
    expect(simulateDrive(r, [21, 22], { ...rover, maxDarknessHours: 5 }).lostAtHours).toBe(5);
  });
});

describe('planMission, several destinations', () => {
  it('visits them in the order that gets it done soonest', () => {
    const r = fake({ n: 9 });
    const plan = planMission(r, at(4, 0), [at(4, 8), at(4, 2), at(4, 5)], rover);
    expect(plan.ok).toBe(true);
    expect(plan.order).toEqual([1, 2, 0]);
    expect(plan.stops.map((s) => s.arrivalHours)).toEqual([2, 5, 8]);
    expect(plan.distanceM).toBeCloseTo(800, 3);
    expectSound(r, plan);
  });

  it('goes to the further one first when the nearer one is still in shadow', () => {
    const r = fake({ n: 9 });
    for (let row = 0; row < 9; row++) r.dark(row, 6, 0, 7);
    const strict = { ...rover, maxDarknessHours: 0, surviveAfterArrival: true }; // the old rule: A must be lit when it stops there
    // A is 2 cells east, in the shadow until hour 8; B is 3 cells west.
    const plan = planMission(r, at(4, 4), [at(4, 6), at(4, 1)], strict);
    expect(plan.ok).toBe(true);
    expect(plan.order).toEqual([1, 0]);
    expect(plan.drive.arrivalHours).toBe(9);
    expectSound(r, plan, strict);
    // Kept to the other order it takes longer.
    const forced = planMission(r, at(4, 4), [at(4, 6), at(4, 1)], strict, { order: [0, 1] });
    expect(forced.order).toEqual([0, 1]);
    expect(forced.drive.arrivalHours).toBe(14);
  });

  it('handles a destination at the start, two on one cell, and four at the corners', () => {
    const r = fake({ n: 9 });
    const same = planMission(r, at(4, 4), [at(4, 4), at(4, 6), at(4, 6)], rover);
    expect(same.ok).toBe(true);
    expect(same.order).toEqual([0, 1, 2]);
    expect(same.stops.map((s) => s.arrivalHours)).toEqual([0, 2, 2]);
    const corners = planMission(r, at(4, 4), [at(0, 0), at(8, 8), at(0, 8), at(8, 0)], rover);
    expect(corners.ok).toBe(true);
    // to a corner (4 diagonals), then three sides of the square
    expect(corners.distanceM).toBeCloseTo(400 * Math.SQRT2 + 3 * 800, 2);
    expect(corners.drive.arrivalHours).toBe(30);
    expectSound(r, corners);
  });

  it('says which destination is the problem', () => {
    const r = fake({ n: 9 });
    r.corridor(4);
    r.dark(4, 6, 0, 47);
    const plan = planMission(r, at(4, 4), [at(4, 8), at(4, 1)], rover);
    expect(plan.ok).toBe(false);
    expect(plan.reasons[0].alone.map((a) => a.ok)).toEqual([false, true]);
  });
});

describe('latestDeparture', () => {
  it('finds how long the rover can stay at the start without arriving later', () => {
    const r = fake();
    r.dark(3, 5, 0, 19);
    const strict = { ...rover, maxDarknessHours: 0, surviveAfterArrival: true };
    const now = planMission(r, at(3, 0), [at(3, 5)], strict);
    expect(now.drive.arrivalHours).toBe(21);
    const found = latestDeparture(r, at(3, 0), [at(3, 5)], strict);
    expect(found.departHours).toBe(16);
    expect(found.plan.drive.arrivalHours).toBe(21);
    expect(found.plan.drive.timeline[15]).toBe(STATE.PARKED);
  });
});

/* ---------- against an exhaustive search on small random maps ---------- */

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every drive the rules allow (pausing only on cell centres, hops only when they fit in the light): the earliest
 *  arrival that counts. With limits.surviveAfterArrival it must also outlast the darkness at the destination. */
function exhaustive(r, startCell, destCell, limits) {
  const { n, steps, stepHours: H, maskStride, sunMask, earthMask, windowHours } = r;
  const lit = (c, s) => maskBit(sunMask, maskStride, s, c) === 1;
  const driveOk = (c, s) => lit(c, s) && (!limits.needEarthToDrive || maskBit(earthMask, maskStride, s, c) === 1);
  const ok = (c) => r.slope[c] <= limits.maxSlopeDeg;
  const maxDark = Math.floor(limits.maxDarknessHours / H + 1e-9);
  let best = Infinity;
  const seen = new Set();
  const stack = [[startCell, 0, 0, `${startCell}@0`]];
  let how = '';
  while (stack.length) {
    const [cell, t, dark, trail] = stack.pop();
    const a = Math.floor((t + TIME_TOL) / H);
    if (a >= steps || (a + 1) * H >= best + H) continue;
    const key = `${cell}|${Math.round(t * 1e9)}|${dark}`; // fine enough to keep "on the hour" and "a moment after" apart
    if (seen.has(key)) continue;
    seen.add(key);
    const waited = lit(cell, a) ? 0 : dark + 1;
    if (waited <= maxDark) stack.push([cell, (a + 1) * H, waited, `${trail} w${a + 1}`]);
    if (!driveOk(cell, a)) continue;
    const row = (cell / n) | 0;
    const col = cell % n;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nr = row + dr;
        const nc = col + dc;
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const b = nr * n + nc;
        if (!ok(b) || (dr && dc && (!ok(row * n + nc) || !ok(nr * n + col)))) continue;
        const tau = (r.cellM * (dr && dc ? Math.SQRT2 : 1)) / limits.speedMPerHour;
        // Set off now, or later in this step so as to arrive just as the neighbour's sunlight begins.
        const arrivals = [t + tau];
        for (let s = a + 1; s <= steps && s <= a + tau / H + 1; s++) {
          const leave = s * H - tau + 2 * TIME_TOL;
          if (s < steps && leave >= t && Math.floor((leave + TIME_TOL) / H) === a && lit(b, s) && !lit(b, s - 1)) arrivals.push(s * H + 2 * TIME_TOL);
          // ... or exactly as a step ends.
          if (s * H - tau > t && Math.floor((s * H - tau + TIME_TOL) / H) === a) arrivals.push(s * H);
        }
        for (const x of arrivals) hop(x);
        function hop(x) {
        const rec = Math.ceil((x - TIME_TOL) / H) - 1;
        if (rec >= steps) return;
        let fits = true;
        for (let s = a; s <= rec; s++) if (!driveOk(cell, s)) fits = false;
        if (!fits) return;
        const carry = rec === a ? dark : 0;
        if (b === destCell) {
          let d = carry;
          let tail = 0; // dark steps at the very end of the mission: counted in full, however late it arrives
          while (tail < steps && !lit(b, steps - 1 - tail)) tail++;
          let safe = !limits.surviveAfterArrival || !(tail > maxDark && rec >= steps - tail);
          for (let u = rec; u < steps && safe && limits.surviveAfterArrival; u++) {
            d = lit(b, u) ? 0 : d + 1;
            if (d > maxDark) safe = false;
          }
          if (safe && Math.min((rec + 1) * H, windowHours) < best) {
            best = Math.min((rec + 1) * H, windowHours);
            how = `${trail} ${b}@${x.toFixed(2)}`;
          }
          return;
        }
        if (Math.floor((x + TIME_TOL) / H) !== rec) {
          const d1 = lit(b, rec) ? 0 : carry + 1;
          if (d1 <= maxDark) stack.push([b, x, d1, `${trail} ${b}@${x.toFixed(2)}`]);
        } else stack.push([b, x, carry, `${trail} ${b}@${x.toFixed(2)}`]);
        }
      }
    }
  }
  if (process.env.PLANNER_DEBUG) exhaustive.how = how;
  return best;
}

function randomMap(rand, { n, steps }) {
  const r = fake({ n, steps });
  for (let c = 0; c < n * n; c++) if (rand() < 0.15) r.slope[c] = 30;
  // Shadows: a few bands that sweep across, a few blotches that come and go.
  for (let k = 0; k < 3; k++) {
    const col0 = Math.floor(rand() * n);
    const speed = rand() < 0.5 ? 1 : 2;
    const from = Math.floor(rand() * steps);
    const rows = [Math.floor(rand() * n), Math.floor(rand() * n)].sort((p, q) => p - q);
    for (let s = from; s < steps; s++) {
      const col = col0 + Math.floor((s - from) / speed);
      if (col >= n) break;
      for (let row = rows[0]; row <= rows[1]; row++) r.dark(row, col, s, s + Math.floor(rand() * 3));
    }
  }
  for (let k = 0; k < 4; k++) {
    const from = Math.floor(rand() * steps);
    r.dark(Math.floor(rand() * n), Math.floor(rand() * n), from, from + Math.floor(rand() * 8));
    r.noEarth(Math.floor(rand() * n), Math.floor(rand() * n), from, from + Math.floor(rand() * 6));
  }
  return r;
}

describe('planner against an exhaustive search', () => {
  it.each([
    ['success on arrival (decision U)', false],
    ['the old rule: survive at the destination until the mission ends', true],
  ])('finds a plan whenever one exists, never claims an impossible one, and arrives as early: %s', (_, surviveAfterArrival) => {
    const rand = random(20261114);
    let compared = 0;
    let later = 0;
    let missed = 0;
    for (let trial = 0; trial < Number(process.env.PLANNER_TRIALS ?? 400); trial++) {
      const n = 4 + (trial % 2);
      const r = randomMap(rand, { n, steps: 12 });
      const limits = {
        maxSlopeDeg: 15,
        rangeM: 1e9,
        speedMPerHour: [100, 250, 60][trial % 3],
        maxDarknessHours: Math.floor(rand() * 4),
        needEarthToDrive: rand() < 0.3,
        surviveAfterArrival,
      };
      const start = at(Math.floor(rand() * n), Math.floor(rand() * n));
      const dest = at(Math.floor(rand() * n), Math.floor(rand() * n));
      const s = start.row * n + start.col;
      const d = dest.row * n + dest.col;
      if (s === d || r.slope[s] > 15 || r.slope[d] > 15) continue;
      const plan = planMission(r, start, [dest], limits, { explain: false });
      const truth = exhaustive(r, s, d, limits);
      compared++;
      if (plan.path) expectSound(r, plan, limits);
      let sooner = false;
      if (plan.ok) {
        sooner = plan.drive.arrivalHours < truth;
        if (plan.drive.arrivalHours > truth) later++;
      } else if (truth < Infinity) missed++;
      if (process.env.PLANNER_DEBUG && (plan.ok ? plan.drive.arrivalHours !== truth : truth < Infinity)) {
        console.log(JSON.stringify({ trial, n, limits, start, dest, got: plan.ok ? plan.drive.arrivalHours : null, truth, status: plan.status, path: plan.path, leave: plan.leave, how: exhaustive.how }));
        for (let c = 0; c < n * n; c++) console.log(String(c).padStart(2), r.slope[c] > 15 ? 'X' : ' ', Array.from({ length: 12 }, (_, u) => (maskBit(r.sunMask, r.maskStride, u, c) ? (maskBit(r.earthMask, r.maskStride, u, c) ? '#' : 'e') : '.')).join(''));
      }
      expect(sooner).toBe(false); // sooner than every allowed drive would mean a broken rule
    }
    if (process.env.PLANNER_DEBUG) console.log({ compared, later, missed });
    expect(compared).toBeGreaterThan(250);
    expect(missed).toBe(0);
    expect(later).toBe(0);
  });

  it('with several destinations is never beaten by a fixed order, and respects a tight range', () => {
    const rand = random(7);
    let planned = 0;
    for (let trial = 0; trial < 60; trial++) {
      const n = 6;
      const r = randomMap(rand, { n, steps: 40 });
      const limits = { maxSlopeDeg: 15, rangeM: trial % 2 ? 1e9 : 900 + rand() * 600, speedMPerHour: 150, maxDarknessHours: 2, needEarthToDrive: false };
      const cells = [0, 1, 2, 3].map(() => at(Math.floor(rand() * n), Math.floor(rand() * n)));
      const [start, ...dests] = cells;
      const plan = planMission(r, start, dests, limits, { explain: false });
      if (plan.path) expectSound(r, plan, limits);
      if (!plan.ok) continue;
      planned++;
      for (const order of [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
        const fixed = planMission(r, start, dests, limits, { order, explain: false });
        if (fixed.ok) expect(plan.drive.arrivalHours).toBeLessThanOrEqual(fixed.drive.arrivalHours);
      }
    }
    expect(planned).toBeGreaterThan(10);
  });
});

describe('planText', () => {
  it('puts a plan, a freeze after arrival and a failure into plain words', async () => {
    const { planText, destinationName } = await import('../src/finder/plan-text.js');
    expect(destinationName(2)).toBe('C');
    const r = fake({ n: 9 });
    const dests = [at(4, 8), at(4, 2), at(4, 5)];
    const good = planText(r, planMission(r, at(4, 0), dests, rover), { rover, destinations: dests });
    expect(good.headline).toBe('The rover visits all 3 destinations, in the order B, C and A, and reaches the last 8.0 h after landing.');
    expect(good.lines).toContain('Arrivals: B at 2.0 h, C at 5.0 h and A at 8.0 h after landing.');
    expect(good.lines).toContain('It sets off at landing, drives for 8.0 h in all, and never has to wait on the way.');
    expect(good.notes).toContain('workable plan, not always the best');

    const frozen = fake();
    frozen.dark(3, 5, 20, 47);
    const fragile = { ...rover, maxDarknessHours: 10, surviveAfterArrival: true };
    const lost = planText(frozen, planMission(frozen, at(3, 0), [at(3, 5)], fragile), { rover: fragile, destinations: [at(3, 5)] });
    expect(lost.headline).toContain('but is lost 30 h after landing');
    expect(lost.lines[0]).toContain('It would work if the rover survived longer darkness');

    const blocked = fake();
    blocked.corridor(3);
    blocked.dark(3, 3, 0, 47);
    const none = planText(blocked, planMission(blocked, at(3, 0), [at(3, 6)], rover), { rover, destinations: [at(3, 6)] });
    expect(none.headline).toContain('No drive works');
    expect(none.lines.join(' ')).toContain('does not help');
    for (const text of [good, lost, none]) expect(JSON.stringify(text)).not.toMatch(/undefined|NaN|null/);
  });
});
