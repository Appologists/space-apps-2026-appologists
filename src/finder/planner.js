// The drive planner: chooses the route and the timing together. Pure: no DOM.
//
// It searches over place and time. A state is "the rover stands on this cell during this unbroken stretch of
// sunlight there"; standing still inside such a stretch costs nothing, so only the earliest moment the rover
// can be there needs remembering. From a state the rover can hop to a neighbouring cell at once, or wait and
// hop later so that it arrives as the neighbour's next stretch of sunlight begins (or shortly before, sitting
// out the last of the dark there), or stay put through the dark until its own cell is lit again.
// Several destinations: one search per set of destinations already visited, each started from every way the
// smaller sets ended (so every order is covered).
//
// The rules are those of schedule.js, and every plan is replayed with simulatePlan() before it is returned.
// Simplifications, all on the safe side: the rover pauses only on cell centres, and it starts a hop only when
// the whole hop fits inside one stretch in which its cell is sunlit (and sees Earth, if required).
// What it does not promise: the very best plan. Among plans arriving in the same time step it prefers the
// shorter drive, and in rare cases it can miss a plan that needs a particular run of darkness kept short.
import { createHeap, drivableMask, reachFrom } from './route.js';
import { STATE, TIME_TOL as TOL, simulatePlan } from './schedule.js';

export const MAX_DESTINATIONS = 5;

const BIG = 1 << 28;
const DIST_KEY = 1e-9; // hours per metre: among equal times, the shorter way comes first
const DIST_TOL = 0.5; // metres: differences smaller than this do not count as shorter
const SAME_MOMENT = 1e-9; // hours: labels this close in time are compared by darkness, then distance
const NEIGHBOURS = [-1, 0, 1, 0, 0, -1, 0, 1, -1, -1, -1, 1, 1, -1, 1, 1];

/* ---------- unbroken stretches ("runs") of sunlight per cell, from the masks ---------- */

/** For every cell, the runs of time steps in which its bit is set in the Sun mask (and the Earth mask, if asked). */
function buildRuns(result, withEarth) {
  const { n, steps, maskStride: stride, sunMask, earthMask } = result;
  const size = n * n;
  const offset = new Int32Array(size + 1);
  const prev = new Uint8Array(stride);
  const byteAt = withEarth ? (i) => sunMask[i] & earthMask[i] : (i) => sunMask[i];
  for (let s = 0; s < steps; s++) {
    const base = s * stride;
    for (let b = 0; b < stride; b++) {
      const cur = byteAt(base + b);
      let rise = cur & ~prev[b];
      prev[b] = cur;
      while (rise) {
        const cell = b * 8 + (31 - Math.clz32(rise & -rise));
        rise &= rise - 1;
        if (cell < size) offset[cell + 1]++;
      }
    }
  }
  for (let i = 0; i < size; i++) offset[i + 1] += offset[i];
  const total = offset[size];
  const start = new Int32Array(total);
  const end = new Int32Array(total);
  const cellOf = new Int32Array(total);
  const fill = offset.slice(0, size);
  prev.fill(0);
  for (let s = 0; s <= steps; s++) {
    const base = s * stride;
    for (let b = 0; b < stride; b++) {
      const cur = s < steps ? byteAt(base + b) : 0; // one step past the end closes the runs still open
      let changed = cur ^ prev[b];
      if (!changed) continue;
      prev[b] = cur;
      while (changed) {
        const bit = 31 - Math.clz32(changed & -changed);
        changed &= changed - 1;
        const cell = b * 8 + bit;
        if (cell >= size) continue;
        if ((cur >> bit) & 1) {
          start[fill[cell]] = s;
          cellOf[fill[cell]] = cell;
        } else end[fill[cell]++] = s;
      }
    }
  }
  return { offset, start, end, cellOf, total };
}

// A search result's masks never change, so the runs are worked out once per result.
const runCache = new WeakMap();
function runsFor(result, needEarth) {
  let entry = runCache.get(result.sunMask);
  if (!entry) runCache.set(result.sunMask, (entry = { reach: new Map() }));
  entry.lit ??= buildRuns(result, false);
  if (needEarth) entry.drive ??= buildRuns(result, true);
  return { lit: entry.lit, drive: needEarth ? entry.drive : entry.lit, cache: entry };
}

/** Shortest drivable distance from a cell to everywhere, ignoring sunlight (kept per result: the planner asks often). */
function staticDistances(result, cache, cell, maxSlopeDeg, rangeM) {
  const key = `${cell}|${maxSlopeDeg}|${rangeM}`;
  let dist = cache.reach.get(key);
  if (!dist) {
    if (cache.reach.size > 24) cache.reach.clear();
    dist = reachFrom(result, { row: (cell / result.n) | 0, col: cell % result.n }, { maxSlopeDeg, rangeM }).dist;
    cache.reach.set(key, dist);
  }
  return dist;
}

/** Index of the cell's first run that ends after `step`, or -1. The cell is lit at `step` if that run has started. */
function findRun(runs, cell, step) {
  const hi = runs.offset[cell + 1];
  for (let k = runs.offset[cell]; k < hi; k++) if (runs.end[k] > step) return k;
  return -1;
}

function makeContext(result, rover) {
  const H = result.stepHours;
  const { lit, drive, cache } = runsFor(result, !!rover.needEarthToDrive);
  return {
    result,
    cache,
    n: result.n,
    steps: result.steps,
    H,
    speed: rover.speedMPerHour,
    rangeM: rover.rangeM ?? Infinity,
    maxSlopeDeg: rover.maxSlopeDeg,
    maxDark: Number.isFinite(rover.maxDarknessHours) ? Math.floor(rover.maxDarknessHours / H + 1e-9) : BIG,
    ok: drivableMask(result, rover.maxSlopeDeg),
    lit,
    drive,
    bestKey: new Float64Array(lit.total),
    bestLabel: new Int32Array(lit.total),
    cleanPushed: new Int32Array(lit.total),
    cleanSettled: new Int32Array(lit.total),
    minDist: new Float64Array(lit.total),
    settled: new Uint8Array(lit.total),
  };
}

/* ---------- one search: from a set of starting labels to the next destinations ---------- */

/**
 * @param seeds   [{ state, t, dark, dist, chain }]: where and when the rover can be at the start of this search
 * @param layer   { exportAt: Int8Array (destination number at cells that end this search, else -1),
 *                  finalCell, allow (see stayAllowance), lb (metres still to drive from each cell, at least),
 *                  best ({ r, dist } of the best complete plan so far, or null), cap (labels kept per state) }
 */
function searchLayer(ctx, seeds, layer) {
  const { n, steps, H, speed, rangeM, maxDark, ok, lit, drive, result } = ctx;
  const { exportAt, finalCell, allow, lb, cap } = layer;
  const { elevation, cellM } = result;
  const diagM = cellM * Math.SQRT2;
  const litOff = lit.offset;
  const litStart = lit.start;
  const litEnd = lit.end;
  const litCell = lit.cellOf;
  const drOff = drive.offset;
  const drStart = drive.start;
  const drEnd = drive.end;
  const { bestKey, bestLabel, cleanPushed, cleanSettled, minDist, settled } = ctx;
  bestKey.fill(Infinity);
  bestLabel.fill(-1);
  cleanPushed.fill(BIG);
  cleanSettled.fill(BIG);
  minDist.fill(Infinity);
  settled.fill(0);

  let bestSafe = layer.best ? { r: layer.best.r, dist: layer.best.dist, label: -1 } : null;
  let bestAny = null;
  // An arrival after this time cannot beat the best plan known (or is after the mission).
  let tBound = (bestSafe ? Math.min(steps, bestSafe.r + 1) : steps) * H + TOL;
  const sameStep = (t1, t2) => Math.floor((t1 + TOL) / H) === Math.floor((t2 + TOL) / H);
  let rangeLimited = false;
  let expanded = 0;
  const exported = [];

  let room = 1 << 14;
  let count = 0;
  let lState = new Int32Array(room);
  let lTime = new Float64Array(room);
  let lDark = new Int32Array(room);
  let lDist = new Float64Array(room);
  let lParent = new Int32Array(room);
  let lLeave = new Float64Array(room);
  const heap = createHeap();
  const grow = (Type, old) => {
    const next = new Type(room * 2);
    next.set(old);
    return next;
  };

  function push(state, t, dark, dist, parent, leave) {
    if (t > tBound - 2 * TOL) return; // too late to act and still arrive in time
    const key = t + dist * DIST_KEY;
    if (cap === 1) {
      // One label per state: the earliest; at the same moment, less darkness behind it, then the shorter way.
      // A later label is kept as well only if it is in the same time step and has less darkness behind it:
      // that can matter for a hop straight onto dark ground.
      const held = bestLabel[state];
      let takes = held < 0;
      if (!takes && !settled[state]) {
        const dt = t - lTime[held];
        takes = dt < -SAME_MOMENT || (dt <= SAME_MOMENT && (dark < lDark[held] || (dark === lDark[held] && key < bestKey[state])));
      }
      if (takes) {
        bestKey[state] = key;
        bestLabel[state] = count;
      } else {
        if (dark >= lDark[held] || dark >= cleanPushed[state] || !sameStep(t, lTime[held])) return;
        cleanPushed[state] = dark;
      }
    } else if (settled[state] >= cap || dist >= minDist[state] - DIST_TOL) return;
    if (count === room) {
      lState = grow(Int32Array, lState);
      lTime = grow(Float64Array, lTime);
      lDark = grow(Int32Array, lDark);
      lDist = grow(Float64Array, lDist);
      lParent = grow(Int32Array, lParent);
      lLeave = grow(Float64Array, lLeave);
      room *= 2;
    }
    lState[count] = state;
    lTime[count] = t;
    lDark[count] = dark;
    lDist[count] = dist;
    lParent[count] = parent;
    lLeave[count] = leave;
    heap.push(key, count++);
  }

  /**
   * The rover reaches the centre of cell b at time x, with `carry` steps of darkness behind it at the start of
   * the step that records it there. Turn that into a label: on b now if b is sunlit, else at the moment b's
   * next sunlight begins, if the rover lasts that long.
   */
  function land(b, x, carry, dist, parent, leave) {
    const r = Math.ceil((x - TOL) / H) - 1; // the step at whose end it is first recorded on b
    const a = Math.floor((x + TOL) / H); // the step in which it can next act
    if (r >= steps) return;
    let dark = carry;
    let k = findRun(lit, b, r);
    if (a !== r) {
      // It arrives exactly as a step ends: that step's light is counted on b.
      dark = k >= 0 && litStart[k] <= r ? 0 : dark + 1;
      if (dark > maxDark || a >= steps) return;
      if (k >= 0 && litEnd[k] <= a) k = k + 1 < litOff[b + 1] ? k + 1 : -1;
    }
    if (k < 0) return; // never sunlit again: it could not leave
    if (litStart[k] <= a) return push(k, x, dark, dist, parent, leave);
    dark += litStart[k] - a;
    if (dark <= maxDark) push(k, litStart[k] * H, dark, dist, parent, leave);
  }

  /** The last hop, onto the final destination: the earliest arrival, and the earliest one after which the rover is not lost. */
  function finalApproach(id, s0, dark, dist, tau, sLo, sHi, tLo, we) {
    const offer = (x, r, leave) => {
      if (bestSafe && (r > bestSafe.r || (r === bestSafe.r && dist >= bestSafe.dist - DIST_TOL))) return;
      bestSafe = { x, r, dist, label: id, leave, safe: true };
      tBound = Math.min(tBound, (r + 1) * H + TOL);
    };
    const xLo = tLo + tau;
    const rLo = Math.ceil((xLo - TOL) / H) - 1;
    for (let sd = sLo; sd <= sHi; sd++) {
      const leave = sd === sLo ? tLo : sd * H;
      const x = leave + tau;
      const r = Math.ceil((x - TOL) / H) - 1;
      if (r >= steps) break;
      const carry = sd === s0 && r === s0 ? dark : 0;
      const safe = carry <= allow[r];
      if (sd === sLo && (!bestAny || x < bestAny.x - TOL || (x < bestAny.x + TOL && dist < bestAny.dist))) bestAny = { x, r, dist, label: id, leave, safe };
      if (!safe) continue;
      offer(x, r, leave);
      break;
    }
    // Or set off so as to arrive just as a stretch of sunlight on the destination begins.
    for (let j = litOff[finalCell]; j < litOff[finalCell + 1]; j++) {
      const from = litStart[j];
      if (from <= rLo) continue;
      if (from >= we) break;
      if (allow[from] >= 0) {
        offer(from * H + 2 * TOL, from, from * H - tau + 2 * TOL);
        break;
      }
    }
  }

  function chainOf(id) {
    const cells = [];
    const leaves = [];
    let cur = id;
    for (;;) {
      const parent = lParent[cur];
      if (parent < 0) break;
      const cell = litCell[lState[cur]];
      if (cell !== litCell[lState[parent]]) {
        cells.push(cell);
        leaves.push(lLeave[cur]);
      }
      cur = parent;
    }
    const seed = seeds[-lParent[cur] - 1].chain;
    return { path: seed.path.concat(cells.reverse()), leave: seed.leave.concat(leaves.reverse()), visits: seed.visits };
  }

  seeds.forEach((seed, i) => push(seed.state, seed.t, seed.dark, seed.dist, -i - 1, NaN));

  while (heap.size > 0) {
    heap.pop();
    const id = heap.topVal;
    const state = lState[id];
    const t = lTime[id];
    const dist = lDist[id];
    if (t > tBound - 2 * TOL) continue;
    if (cap === 1) {
      if (bestLabel[state] === id) {
        settled[state] = 1;
        cleanSettled[state] = lDark[id];
      } else {
        // Not the earliest: worth following only as the "less darkness, same time step" alternative.
        const held = bestLabel[state];
        if (!settled[state] || lDark[id] >= cleanSettled[state] || !sameStep(t, lTime[held])) continue;
        cleanSettled[state] = lDark[id];
      }
    } else {
      if (settled[state] >= cap || dist >= minDist[state] - DIST_TOL) continue;
      settled[state]++;
      minDist[state] = dist;
    }
    const a = litCell[state];
    const dark = lDark[id];
    if (exportAt[a] >= 0) {
      const chain = chainOf(id);
      exported.push({ dest: exportAt[a], state, t, dark, dist, chain: { ...chain, visits: [...chain.visits, { dest: exportAt[a], pathIndex: chain.path.length - 1 }] } });
      continue;
    }
    expanded++;
    const s0 = Math.floor((t + TOL) / H);
    const runEnd = litEnd[state];
    // Stay put through the dark until this cell is sunlit again.
    if (state + 1 < litOff[a + 1]) {
      const gap = litStart[state + 1] - runEnd;
      if (gap <= maxDark) push(state + 1, litStart[state + 1] * H, gap, dist, id, NaN);
    }
    const row = (a / n) | 0;
    const col = a - row * n;
    // Each stretch, within this sunlit run, in which the rover may drive off this cell.
    for (let w = drOff[a]; w < drOff[a + 1]; w++) {
      const we = drEnd[w];
      if (we <= s0) continue;
      if (drStart[w] >= runEnd) break;
      const sLo = drStart[w] > s0 ? drStart[w] : s0;
      const tLo = sLo === s0 ? t : sLo * H;
      const windowEnd = we * H + TOL;
      for (let k = 0; k < 8; k++) {
        const nr = row + NEIGHBOURS[2 * k];
        const nc = col + NEIGHBOURS[2 * k + 1];
        if (nr < 0 || nc < 0 || nr >= n || nc >= n) continue;
        const b = nr * n + nc;
        if (!ok[b]) continue;
        let horizontal = cellM;
        if (k >= 4) {
          if (!ok[row * n + nc] || !ok[nr * n + col]) continue; // no cutting corners
          horizontal = diagM;
        }
        const dz = elevation[b] - elevation[a];
        const lengthM = Math.sqrt(horizontal * horizontal + dz * dz);
        const nd = dist + lengthM;
        const still = lb[b];
        if (nd + still > rangeM + 1e-6) {
          if (still < Infinity) rangeLimited = true;
          continue;
        }
        const tau = lengthM / speed;
        const xLo = tLo + tau;
        if (xLo > windowEnd) continue; // the hop does not fit in this stretch
        if (xLo + still / speed > tBound) continue;
        // The last step in which it can set off and still finish the hop inside the stretch.
        let sHi = Math.floor(we - tau / H + 1e-7);
        if (sHi > we - 1) sHi = we - 1;
        if (sHi < sLo) sHi = sLo;
        if (b === finalCell) {
          finalApproach(id, s0, dark, nd, tau, sLo, sHi, tLo, we);
          continue;
        }
        // Set off at once ...
        const rLo = Math.ceil((xLo - TOL) / H) - 1;
        land(b, xLo, rLo === s0 ? dark : 0, nd, id, tLo);
        // ... or wait first, and aim at each later stretch of sunlight on b:
        for (let j = litOff[b]; j < litOff[b + 1]; j++) {
          const from = litStart[j];
          if (from <= rLo) continue;
          if (from > we) break; // this cell's own light ends first
          // arrive as its last dark step ends (one step of darkness is counted, and the rover is on its way on the hour),
          if (from * H - tau > tLo) land(b, from * H, from - 1 === s0 ? dark : 0, nd, id, from * H - tau);
          // or a moment later, when it is already lit.
          if (from < we) land(b, from * H + 2 * TOL, 0, nd, id, from * H - tau + 2 * TOL);
        }
        // ... or as late as this cell's own light allows, to sit out as little of b's darkness as possible.
        if (we * H - tau > tLo) land(b, we * H, we - 1 === s0 ? dark : 0, nd, id, we * H - tau);
      }
    }
  }

  const finish = (final) => {
    if (!final || final.label < 0) return null;
    const chain = chainOf(final.label);
    return { x: final.x, r: final.r, dist: final.dist, safe: final.safe, path: [...chain.path, finalCell], leave: [...chain.leave, final.leave], visits: chain.visits };
  };
  return { exported, safe: finish(bestSafe), any: finish(bestAny), rangeLimited, expanded, labels: count };
}

/**
 * For a rover that stops on `cell` for good: the most darkness it may bring with it into each step and still
 * not be lost before the mission ends (-1: lost whatever it brings, or the cell's last darkness outlasts it).
 */
function stayAllowance(ctx, cell) {
  const { steps, maxDark, lit } = ctx;
  const allow = new Int32Array(steps + 1);
  allow[steps] = BIG;
  let k = lit.offset[cell + 1] - 1;
  const first = lit.offset[cell];
  for (let u = steps - 1; u >= 0; u--) {
    while (k >= first && lit.start[k] > u) k--;
    const isLit = k >= first && lit.end[k] > u;
    allow[u] = isLit ? (allow[u + 1] >= 0 ? BIG : -1) : Math.min(maxDark, allow[u + 1]) - 1;
  }
  // Darkness still going when the mission ends is taken at its full length, however late the rover arrives:
  // getting there just before the end of the mission is not surviving it.
  const lastLit = lit.offset[cell + 1] > first ? lit.end[lit.offset[cell + 1] - 1] : 0;
  if (steps - lastLit > maxDark) allow.fill(-1, lastLit, steps);
  return allow;
}

/** Where and when the rover can first act: at the start, once it may leave and the ground there is sunlit. */
function startSeed(ctx, startCell, departHours) {
  const { steps, H, maxDark, lit } = ctx;
  const departStep = Math.max(0, Math.ceil(departHours / H - 1e-9));
  let dark = 0; // unbroken dark steps behind it
  for (let u = 0; u < Math.min(departStep, steps); u++) {
    const k = findRun(lit, startCell, u);
    dark = k >= 0 && lit.start[k] <= u ? 0 : dark + 1;
    if (dark > maxDark) return { problem: { code: 'start-lost', lostAtHours: u * H } };
  }
  if (departStep >= steps) return { problem: { code: 'no-time' } };
  const k = findRun(lit, startCell, departStep);
  const litFrom = k < 0 ? steps : lit.start[k]; // the step in which the start is next sunlit
  if (litFrom > departStep) {
    if (dark + (litFrom - departStep) > maxDark) return { problem: { code: 'start-lost', lostAtHours: (departStep + maxDark - dark) * H } };
    if (k < 0) return { problem: { code: 'start-never-lit' } };
    dark += litFrom - departStep;
  }
  return { seed: { state: k, t: Math.max(litFrom, departStep) * H, dark, dist: 0, chain: { path: [startCell], leave: [], visits: [] } } };
}

const popcount = (m) => {
  let c = 0;
  for (; m; m &= m - 1) c++;
  return c;
};

/**
 * Visit every destination. `cells` are the destination cells (none is the start, none twice).
 * @returns {{ safe, any, rangeLimited }}: the best plan after which the rover is not lost, and the earliest arrival whatever happens after
 */
function solve(ctx, seed, cells, { order = null, cap = 1, best = null } = {}) {
  const k = cells.length;
  const size = ctx.n * ctx.n;
  const full = (1 << k) - 1;
  const toDest = cells.map((cell) => staticDistances(ctx.result, ctx.cache, cell, ctx.maxSlopeDeg, ctx.rangeM));
  const seedsOf = new Map([[0, [seed]]]);
  let masks;
  if (order) {
    masks = [0];
    for (let i = 0; i < k - 1; i++) masks.push(masks[i] | (1 << order[i]));
  } else {
    masks = Array.from({ length: full }, (_, m) => m).sort((p, q) => popcount(p) - popcount(q) || p - q);
  }
  let safe = null;
  let any = null;
  let rangeLimited = false;
  let expanded = 0;
  for (const mask of masks) {
    const seeds = seedsOf.get(mask);
    if (!seeds?.length) continue;
    const missing = [];
    for (let i = 0; i < k; i++) if (!(mask & (1 << i))) missing.push(i);
    const lb = new Float64Array(size);
    for (const i of missing) {
      const d = toDest[i];
      for (let c = 0; c < size; c++) if (d[c] > lb[c]) lb[c] = d[c];
    }
    const exportAt = new Int8Array(size).fill(-1);
    let finalCell = -1;
    let allow = null;
    if (missing.length === 1) {
      finalCell = cells[missing[0]];
      allow = stayAllowance(ctx, finalCell);
    } else if (order) exportAt[cells[order[popcount(mask)]]] = order[popcount(mask)];
    else for (const i of missing) exportAt[cells[i]] = i;
    const out = searchLayer(ctx, seeds, { exportAt, finalCell, allow, lb, cap, best: safe ?? best });
    rangeLimited ||= out.rangeLimited;
    expanded += out.expanded;
    for (const e of out.exported) {
      const next = mask | (1 << e.dest);
      if (!seedsOf.has(next)) seedsOf.set(next, []);
      seedsOf.get(next).push(e);
    }
    if (out.safe) safe = { ...out.safe, visits: [...out.safe.visits, { dest: missing[0], pathIndex: out.safe.path.length - 1 }] };
    if (out.any && (!any || out.any.x < any.x)) any = { ...out.any, visits: [...out.any.visits, { dest: missing[0], pathIndex: out.any.path.length - 1 }] };
    seedsOf.delete(mask);
  }
  return { safe, any, rangeLimited, expanded };
}

/** Every order, with a quick first pass (nearest destination next) so the full search can stop early. */
function solveAll(ctx, seed, cells, startCell, options) {
  if (options.order || cells.length < 3) return solve(ctx, seed, cells, options);
  const order = [];
  let from = startCell;
  const left = new Set(cells.keys());
  while (left.size) {
    const d = staticDistances(ctx.result, ctx.cache, from, ctx.maxSlopeDeg, ctx.rangeM);
    let pick = -1;
    for (const i of left) if (pick < 0 || d[cells[i]] < d[cells[pick]]) pick = i;
    order.push(pick);
    left.delete(pick);
    from = cells[pick];
  }
  const quick = solve(ctx, seed, cells, { ...options, order });
  const all = solve(ctx, seed, cells, { ...options, best: quick.safe ? { r: quick.safe.r, dist: quick.safe.dist } : options.best ?? null });
  return { safe: all.safe ?? quick.safe, any: all.any ?? quick.any, rangeLimited: all.rangeLimited, expanded: quick.expanded + all.expanded };
}

/* ---------- the public face ---------- */

const WAITING = new Set([STATE.PARKED, STATE.WAIT_SUN, STATE.WAIT_EARTH, STATE.HOLD]);

function emptyPlan(reasons, extra = {}) {
  return { ok: false, status: 'no-plan', order: [], path: null, leave: null, stops: [], waits: [], drive: null, distanceM: 0, shortestM: null, reasons, selfCheck: true, computeMs: 0, ...extra };
}

/** One attempt with the rover as given: the static checks, then the search. */
function attempt(result, start, destinations, rover, options) {
  const { n } = result;
  const inGrid = (p) => p && p.row >= 0 && p.col >= 0 && p.row < n && p.col < n;
  if (!inGrid(start)) return { reasons: [{ code: 'start-off-map' }] };
  const ctx = makeContext(result, rover);
  const startCell = start.row * n + start.col;
  if (!ctx.ok[startCell]) return { reasons: [{ code: 'start-steep' }] };
  const fromStart = staticDistances(result, ctx.cache, startCell, ctx.maxSlopeDeg, ctx.rangeM);
  const reasons = [];
  const cells = []; // the distinct destination cells away from the start
  const destOf = []; // for each of them, the destinations (as given) that sit there
  const atStart = [];
  destinations.forEach((p, i) => {
    if (!inGrid(p)) return reasons.push({ code: 'dest-off-map', destination: i });
    const cell = p.row * n + p.col;
    if (cell === startCell) return atStart.push(i);
    if (!ctx.ok[cell]) return reasons.push({ code: 'dest-steep', destination: i });
    if (!Number.isFinite(fromStart[cell])) {
      const anyRange = Number.isFinite(ctx.rangeM) ? reachFrom(result, start, { maxSlopeDeg: ctx.maxSlopeDeg, rangeM: Infinity }).dist[cell] : Infinity;
      return reasons.push(Number.isFinite(anyRange) ? { code: 'dest-beyond-range', destination: i, neededM: anyRange } : { code: 'dest-no-path', destination: i });
    }
    const seen = cells.indexOf(cell);
    if (seen >= 0) destOf[seen].push(i);
    else {
      cells.push(cell);
      destOf.push([i]);
    }
  });
  if (reasons.length) return { reasons };
  const { seed, problem } = startSeed(ctx, startCell, rover.departHours ?? 0);
  if (problem) return { reasons: [problem] };
  const shortest = cells.map((cell) => fromStart[cell]);
  const base = { ctx, startCell, cells, destOf, atStart, shortest };
  if (!cells.length) return { ...base, found: { safe: { path: [startCell], leave: [], visits: [], r: -1, dist: 0, safe: true }, any: null, rangeLimited: false } };
  let order = options.order ? options.order.map((i) => destOf.findIndex((list) => list.includes(i))).filter((c, at, all) => c >= 0 && all.indexOf(c) === at) : null;
  if (order?.length !== cells.length) order = null;
  let found = solveAll(ctx, seed, cells, startCell, { order, cap: 1 });
  // The quick search keeps one way of reaching each place. If the range got in its way, look again keeping the shorter ways too.
  if (!found.safe && found.rangeLimited) {
    const careful = solveAll(ctx, seed, cells, startCell, { order, cap: 3 });
    found = { safe: careful.safe, any: careful.any ?? found.any, rangeLimited: true, expanded: found.expanded + careful.expanded };
  } else if (found.safe && options.polish !== false) {
    // The quick search goes for the earliest arrival and does not mind the distance. Look once more, keeping
    // shorter ways too, for a drive that arrives in the same time step (or sooner) with less driving.
    const shorter = solveAll(ctx, seed, cells, startCell, { order, cap: 3, best: { r: found.safe.r, dist: found.safe.dist } });
    const better = shorter.safe && (shorter.safe.r < found.safe.r || (shorter.safe.r === found.safe.r && shorter.safe.dist < found.safe.dist - DIST_TOL));
    if (better) found = { ...found, safe: shorter.safe };
  }
  return { ...base, found };
}

function buildPlan(result, rover, tried, final, status) {
  const { n, stepHours: H, windowHours } = result;
  const { destOf, atStart } = tried;
  const drive = simulatePlan(result, final.path, {
    leave: final.leave,
    departHours: rover.departHours ?? 0,
    speedMPerHour: rover.speedMPerHour,
    maxDarknessHours: rover.maxDarknessHours,
    needEarthToDrive: !!rover.needEarthToDrive,
  });
  const stops = atStart.map((destination) => ({ destination, row: (final.path[0] / n) | 0, col: final.path[0] % n, pathIndex: 0, arrivalHours: 0 }));
  for (const visit of final.visits) {
    const cell = final.path[visit.pathIndex];
    const reached = drive.reachHours[visit.pathIndex];
    const arrivalHours = Number.isNaN(reached) ? null : Math.min(Math.ceil((reached - TOL) / H) * H, windowHours);
    for (const destination of destOf[visit.dest]) stops.push({ destination, row: (cell / n) | 0, col: cell % n, pathIndex: visit.pathIndex, arrivalHours });
  }
  const waits = [];
  for (let s = 0; s < drive.timeline.length; s++) {
    const state = drive.timeline[s];
    if (!WAITING.has(state)) continue;
    const prev = waits[waits.length - 1];
    if (prev && prev.state === state && prev.pathIndex === drive.cellIndex[s] && Math.abs(prev.fromHours + prev.hours - s * H) < 1e-9) prev.hours += H;
    else {
      const cell = final.path[drive.cellIndex[s]];
      waits.push({ row: (cell / n) | 0, col: cell % n, pathIndex: drive.cellIndex[s], fromHours: s * H, hours: H, state });
    }
  }
  // The replay is the judge: if it disagrees with the search, believe the replay and say so.
  const expected = final.r < 0 ? rover.departHours ?? 0 : Math.min((final.r + 1) * H, windowHours);
  const selfCheck = drive.arrived && Math.abs(drive.arrivalHours - expected) < 1e-6 && (status !== 'ok' || drive.survived);
  const ok = status === 'ok' && drive.arrived && drive.survived;
  return {
    ok,
    status: ok ? 'ok' : drive.arrived ? 'lost-after-arrival' : 'no-plan',
    order: stops.map((stop) => stop.destination),
    path: final.path,
    leave: final.leave,
    stops,
    waits,
    drive,
    distanceM: drive.distanceM,
    shortestM: tried.cells.length === 1 ? tried.shortest[0] : null,
    reasons: [],
    selfCheck,
    computeMs: 0,
  };
}

/** When nothing works: try again with one limit lifted at a time, to say what stands in the way. */
function diagnose(result, start, destinations, rover) {
  const helps = [];
  const check = (change, relaxed) => {
    const tried = attempt(result, start, destinations, relaxed, {});
    if (!tried.found?.safe) return;
    const plan = buildPlan(result, relaxed, tried, tried.found.safe, 'ok');
    if (plan.ok) helps.push({ change, arrivalHours: plan.drive.arrivalHours, longestDarkH: plan.drive.longestDarkH, distanceM: plan.distanceM });
  };
  if (rover.needEarthToDrive) check('earth', { ...rover, needEarthToDrive: false });
  if (Number.isFinite(rover.maxDarknessHours)) check('darkness', { ...rover, maxDarknessHours: Infinity });
  if (Number.isFinite(rover.rangeM ?? Infinity)) check('range', { ...rover, rangeM: Infinity });
  let alone = null;
  if (destinations.length > 1) {
    alone = destinations.map((p, destination) => {
      const tried = attempt(result, start, [p], rover, {});
      return { destination, ok: !!tried.found?.safe, reached: !!(tried.found?.safe || tried.found?.any), reasons: tried.reasons ?? [] };
    });
  }
  return { code: 'no-way', helps, alone };
}

/**
 * Plan a drive from `start` to every destination: the route, the order and the timing together.
 * @param {object} result        a FinderResult with sunMask and earthMask (see types.js)
 * @param {{row: number, col: number}} start
 * @param {{row: number, col: number}[]} destinations  one to MAX_DESTINATIONS
 * @param {{maxSlopeDeg: number, rangeM: number, speedMPerHour: number, maxDarknessHours: number, needEarthToDrive?: boolean, departHours?: number}} rover
 *        departHours: the rover leaves the start no earlier than this
 * @param {{order?: number[], explain?: boolean}} [options]  order: keep to this visiting order; explain: false skips the "why not" checks
 * @returns a plan:
 *   ok        reaches every destination and is not lost before the mission ends
 *   status    'ok' | 'lost-after-arrival' (it gets there, then freezes) | 'no-plan'
 *   order     destination numbers (as given) in visiting order
 *   path      cell indices from the start to the last destination; null without a plan
 *   leave     for each path cell but the last, the earliest time (hours after landing) the plan lets the rover leave it
 *   stops     [{ destination, row, col, pathIndex, arrivalHours }] in visiting order
 *   waits     [{ row, col, pathIndex, fromHours, hours, state }] pauses of one time step or more on the way
 *   drive     the replay (see simulatePlan in schedule.js): timeline, lit, earth, arrivalHours, longestDarkH …
 *   distanceM, shortestM (the shortest drivable distance ignoring sunlight; one destination only)
 *   reasons   when there is no plan: [{ code, … }] (plan-text.js puts them into words)
 *   selfCheck false if the replay disagreed with the search (a bug; the plan shown is the replay's)
 */
export function planMission(result, start, destinations, rover, options = {}) {
  const t0 = performance.now();
  const done = (plan) => ({ ...plan, computeMs: performance.now() - t0 });
  const list = (destinations ?? []).slice(0, MAX_DESTINATIONS);
  if (!list.length) return done(emptyPlan([{ code: 'no-destination' }]));
  if (!result?.sunMask || !result?.earthMask) return done(emptyPlan([{ code: 'no-masks' }]));
  const tried = attempt(result, start, list, rover, options);
  if (tried.reasons) return done(emptyPlan(tried.reasons));
  const { safe, any, rangeLimited } = tried.found;
  if (safe) return done({ ...buildPlan(result, rover, tried, safe, 'ok'), rangeLimited });
  const reasons = options.explain === false ? [{ code: 'no-way', helps: [], alone: null }] : [diagnose(result, start, list, rover)];
  if (any) return done({ ...buildPlan(result, rover, tried, any, 'lost-after-arrival'), reasons, rangeLimited });
  return done(emptyPlan(reasons, { rangeLimited }));
}

/**
 * The latest "leave no earlier than" for which the rover still arrives as early as it does now, keeping the
 * same visiting order. Assumes that leaving later never gets it there sooner.
 * @returns {{ departHours: number, plan: object }|null}
 */
export function latestDeparture(result, start, destinations, rover) {
  const base = planMission(result, start, destinations, rover, { explain: false });
  if (!base.ok) return null;
  const H = result.stepHours;
  const good = (step) => {
    const plan = planMission(result, start, destinations, { ...rover, departHours: step * H }, { order: base.order, explain: false });
    return plan.ok && plan.drive.arrivalHours <= base.drive.arrivalHours + 1e-9 ? plan : null;
  };
  let lo = Math.max(0, Math.ceil((rover.departHours ?? 0) / H - 1e-9));
  let hi = Math.floor(base.drive.arrivalHours / H + 1e-9);
  let best = { departHours: lo * H, plan: base };
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const plan = good(mid);
    if (plan) {
      best = { departHours: mid * H, plan };
      lo = mid;
    } else hi = mid - 1;
  }
  return best;
}
