import { describe, expect, it } from 'vitest';
import { maskBit, simulateDrive, simulatePlan, STATE } from '../src/finder/schedule.js';

const setBit = (mask, stride, step, cell, v = 1) => {
  const i = step * stride + (cell >> 3);
  if (v) mask[i] |= 1 << (cell & 7);
  else mask[i] &= ~(1 << (cell & 7));
};

function fake({ steps = 48, n = 10 } = {}) {
  const stride = Math.ceil((n * n) / 8);
  const sunMask = new Uint8Array(steps * stride).fill(255);
  const earthMask = new Uint8Array(steps * stride).fill(255);
  return { n, cellM: 100, elevation: new Float32Array(n * n), steps, stepHours: 1, windowHours: steps - 1, maskStride: stride, sunMask, earthMask };
}
const row5 = [50, 51, 52, 53, 54, 55];
const opts = { speedMPerHour: 100, maxDarknessHours: 100 };

describe('maskBit', () => {
  it('reads the right bit', () => {
    const r = fake();
    r.sunMask.fill(0);
    setBit(r.sunMask, r.maskStride, 3, 13);
    expect(maskBit(r.sunMask, r.maskStride, 3, 13)).toBe(1);
    expect(maskBit(r.sunMask, r.maskStride, 3, 12)).toBe(0);
    expect(maskBit(r.sunMask, r.maskStride, 2, 13)).toBe(0);
  });
});

describe('simulateDrive', () => {
  it('drives a sunlit straight path without waiting', () => {
    const d = simulateDrive(fake(), row5, opts);
    expect(d.arrived).toBe(true);
    expect(d.survived).toBe(true);
    expect(d.distanceM).toBeCloseTo(500, 3);
    expect(d.arrivalHours).toBe(5);
    expect(d.waitingHours).toBe(0);
    expect(d.drivingHours).toBe(5);
    expect(d.timeline[0]).toBe(STATE.DRIVING);
    expect(d.timeline[5]).toBe(STATE.ARRIVED);
  });

  it('shifts with the departure time and parks before it', () => {
    const d = simulateDrive(fake(), row5, { ...opts, departHours: 10 });
    expect(d.arrivalHours).toBe(15);
    expect(d.timeline[9]).toBe(STATE.PARKED);
    expect(d.timeline[10]).toBe(STATE.DRIVING);
  });

  it('waits for sunlight at a dark cell', () => {
    const r = fake();
    for (let s = 3; s <= 6; s++) setBit(r.sunMask, r.maskStride, s, 53, 0);
    const d = simulateDrive(r, row5, opts);
    // after step 2 the rover stands on cell 53 (pos 300); dark in steps 3..6
    expect(d.timeline[3]).toBe(STATE.WAIT_SUN);
    expect(d.timeline[6]).toBe(STATE.WAIT_SUN);
    expect(d.waitingHours).toBe(4);
    expect(d.arrivalHours).toBe(9);
    expect(d.longestDarkH).toBe(4);
  });

  it('waits for Earth when it is needed to drive', () => {
    const r = fake();
    for (let s = 2; s <= 3; s++) setBit(r.earthMask, r.maskStride, s, 52, 0);
    const d = simulateDrive(r, row5, { ...opts, needEarthToDrive: true });
    expect(d.timeline[2]).toBe(STATE.WAIT_EARTH);
    expect(d.timeline[3]).toBe(STATE.WAIT_EARTH);
    expect(d.arrivalHours).toBe(7);
    const free = simulateDrive(r, row5, opts);
    expect(free.arrivalHours).toBe(5);
  });

  it('is lost when darkness lasts too long', () => {
    const r = fake();
    for (let s = 3; s < 20; s++) setBit(r.sunMask, r.maskStride, s, 53, 0);
    const d = simulateDrive(r, row5, { ...opts, maxDarknessHours: 6 });
    expect(d.survived).toBe(false);
    expect(d.arrived).toBe(false);
    expect(d.lostAtHours).toBe(9);
    expect(d.timeline[9]).toBe(STATE.LOST);
    expect(d.timeline[40]).toBe(STATE.LOST);
  });

  it('arrives but freezes afterwards', () => {
    const r = fake();
    for (let s = 8; s < 48; s++) setBit(r.sunMask, r.maskStride, s, 55, 0);
    const d = simulateDrive(r, row5, { ...opts, maxDarknessHours: 5 });
    expect(d.arrived).toBe(true);
    expect(d.arrivalHours).toBe(5);
    expect(d.survived).toBe(false);
    expect(d.lostAtHours).toBe(13);
  });

  it('does not arrive when the steps run out', () => {
    const d = simulateDrive(fake({ steps: 4 }), row5, opts);
    expect(d.arrived).toBe(false);
    expect(d.arrivalHours).toBeNull();
    expect(d.survived).toBe(true);
    expect(d.positionM[3]).toBeCloseTo(400, 3);
  });

  it('handles a one-cell path', () => {
    const d = simulateDrive(fake(), [55], { ...opts, departHours: 4 });
    expect(d.arrived).toBe(true);
    expect(d.arrivalHours).toBe(4);
    expect(d.distanceM).toBe(0);
    expect(d.timeline[3]).toBe(STATE.PARKED);
    expect(d.timeline[4]).toBe(STATE.ARRIVED);
  });

  it('lets a fast rover cross several cells in one step', () => {
    const r = fake();
    for (let s = 1; s < 48; s++) setBit(r.sunMask, r.maskStride, s, 52, 0);
    const d = simulateDrive(r, row5, { speedMPerHour: 350, maxDarknessHours: 100 });
    // step 0 carries it past cells 51 and 52 to cell 53 (350 m), which is lit
    expect(d.positionM[0]).toBeCloseTo(350, 3);
    expect(d.timeline[0]).toBe(STATE.DRIVING);
    expect(d.timeline[1]).toBe(STATE.DRIVING);
    expect(d.arrivalHours).toBe(2);
  });
});

describe('simulatePlan', () => {
  it('holds where the plan says, in sunlight, then drives on', () => {
    const d = simulatePlan(fake(), row5, { ...opts, leave: [0, 0, 6] });
    // reaches cell 52 at hour 2, may not leave before hour 6
    expect(d.timeline[2]).toBe(STATE.HOLD);
    expect(d.timeline[5]).toBe(STATE.HOLD);
    expect(d.timeline[6]).toBe(STATE.DRIVING);
    expect(d.arrivalHours).toBe(9);
    expect(d.waitingHours).toBe(4);
    expect(d.reachHours[2]).toBeCloseTo(2, 6);
    expect(d.reachHours[5]).toBeCloseTo(9, 6);
    expect(d.cellIndex[4]).toBe(2);
  });

  it('counts a planned stay at the start as parked', () => {
    const d = simulatePlan(fake(), row5, { ...opts, leave: [3] });
    expect(d.timeline[2]).toBe(STATE.PARKED);
    expect(d.timeline[3]).toBe(STATE.DRIVING);
    expect(d.parkedHours).toBe(3);
    expect(d.arrivalHours).toBe(8);
  });

  it('stops at a dark cell it reaches part-way through an hour', () => {
    const r = fake();
    for (let s = 0; s <= 3; s++) setBit(r.sunMask, r.maskStride, s, 52, 0);
    const d = simulatePlan(r, row5, { speedMPerHour: 250, maxDarknessHours: 100 });
    // hour 0: 50 -> 51 -> 52 (0.8 h); 52 is dark, so it stays there until hour 4
    expect(d.positionM[0]).toBeCloseTo(200, 3);
    expect(d.timeline[1]).toBe(STATE.WAIT_SUN);
    expect(d.timeline[3]).toBe(STATE.WAIT_SUN);
    expect(d.timeline[4]).toBe(STATE.DRIVING);
    expect(d.longestDarkH).toBe(4);
    expect(d.arrivalHours).toBe(6);
  });
});
