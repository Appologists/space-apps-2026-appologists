import { describe, expect, it } from 'vitest';
import { cellOffset } from '../src/finder/grid.js';
import { TIME_LAYER, layerLegend, layerPixel } from '../src/finder/map-layers.js';
import { createTrack } from '../src/finder/playback.js';
import { STATE, simulatePlan } from '../src/finder/schedule.js';

// A flat 10 x 10 map of 100 m cells, lit everywhere for 48 one-hour steps unless a test darkens it.
function fake({ steps = 48, n = 10 } = {}) {
  const size = n * n;
  const maskStride = Math.ceil(size / 8);
  return {
    n,
    cellM: 100,
    halfSizeM: (n * 100) / 2,
    steps,
    stepHours: 1,
    windowHours: steps,
    maskStride,
    elevation: new Float32Array(size),
    fail: new Uint8Array(size),
    sunMask: new Uint8Array(steps * maskStride).fill(255),
    earthMask: new Uint8Array(steps * maskStride).fill(255),
  };
}
const rover = { speedMPerHour: 100, maxDarknessHours: 50 };

describe('createTrack', () => {
  it('is null without a route', () => {
    expect(createTrack(fake(), { path: null, drive: null })).toBeNull();
    expect(createTrack(fake(), null)).toBeNull();
  });

  it('starts on the first cell, ends on the last, and moves east along a row', () => {
    const r = fake();
    const path = [50, 51, 52, 53, 54]; // row 5, columns 0 to 4: one cell an hour
    const track = createTrack(r, { path, drive: simulatePlan(r, path, rover) });
    expect(track.lengthM).toBeCloseTo(400);
    expect(track.at(0)).toMatchObject(cellOffset(r, 5, 0));
    expect(track.at(100)).toMatchObject(cellOffset(r, 5, 4));
    expect(track.at(1).headingDeg).toBeCloseTo(90);
    expect(track.at(1.5).east).toBeCloseTo(cellOffset(r, 5, 0).east + 150);
    expect(track.at(1.5).north).toBeCloseTo(cellOffset(r, 5, 0).north);
  });

  it('agrees with the replay at the end of every step', () => {
    const r = fake();
    const path = [0, 11, 22, 33, 34, 35]; // three diagonal hops, then two east
    const drive = simulatePlan(r, path, { ...rover, departHours: 3 });
    const track = createTrack(r, { path, drive });
    for (let s = 0; s < r.steps; s++) expect(track.at(s + 1).distanceM).toBeCloseTo(Math.min(drive.positionM[s], track.lengthM), 3);
    expect(track.startHours).toBe(3);
    expect(track.endHours).toBe(drive.arrivalHours);
    expect(track.at(0.5).state).toBe(STATE.PARKED);
    expect(track.at(3.5).state).toBe(STATE.DRIVING);
    expect(track.at(1).headingDeg).toBeCloseTo(135); // south-east: rows grow southward
  });

  it('says whether the rover is in sunlight at that step', () => {
    const r = fake();
    const path = [50, 51];
    r.sunMask.fill(0, 0, r.maskStride); // dark everywhere during the first hour
    const track = createTrack(r, { path, drive: simulatePlan(r, path, rover) });
    expect(track.at(0.5).lit).toBe(false);
    expect(track.at(1.5).lit).toBe(true);
  });

  it('counts the unbroken time in the dark the way the replay does, and lists each change of what it does', () => {
    const r = fake();
    const path = [50, 51, 52, 53, 54];
    r.sunMask.fill(0, 2 * r.maskStride, 5 * r.maskStride); // dark everywhere from 2 h to 5 h
    const drive = simulatePlan(r, path, rover);
    const track = createTrack(r, { path, drive });
    expect(track.at(1.5).darkH).toBe(0);
    expect(track.at(2.5).darkH).toBe(1);
    expect(track.at(4.5).darkH).toBe(3);
    expect(track.at(5.5).darkH).toBe(0);
    expect(drive.longestDarkH).toBe(3);
    // Every change in the replay's timeline, and nothing else.
    const expected = [];
    for (let s = 1; s < r.steps; s++) if (drive.timeline[s] !== drive.timeline[s - 1]) expected.push(s);
    expect(track.changes).toEqual(expected);
    expect(track.at(2.5).state).toBe(STATE.WAIT_SUN);
    expect(track.nextChange(0)).toBe(2);
    expect(track.nextChange(2)).toBe(expected[1]);
    expect(track.at(track.changes.at(-1)).state).toBe(STATE.ARRIVED);
    expect(track.nextChange(track.changes.at(-1))).toBeNull();
  });

  it('shows a rover lost in the dark with more darkness than it survives', () => {
    const r = fake();
    const path = [50, 51, 52, 53, 54];
    r.sunMask.fill(0, 2 * r.maskStride); // dark from 2 h to the end
    const short = { ...rover, maxDarknessHours: 5 };
    const track = createTrack(r, { path, drive: simulatePlan(r, path, short) });
    const lostAt = track.changes.find((hours) => track.at(hours).state === STATE.LOST);
    expect(lostAt).toBeGreaterThan(0);
    expect(track.at(lostAt).darkH).toBeGreaterThan(short.maxDarknessHours);
  });
});

describe('the map at one moment', () => {
  it('draws sunlit ground lighter than ground in shadow, and both as near-greys', () => {
    const r = fake();
    r.sunMask[0] = 0b00000001; // step 0: only cell 0 is lit
    const lit = layerPixel(TIME_LAYER, r, 0, 128, { step: 0 });
    const dark = layerPixel(TIME_LAYER, r, 1, 128, { step: 0 });
    expect(Math.min(...lit)).toBeGreaterThan(Math.max(...dark) + 60);
    for (const [red, green, blue] of [lit, dark]) expect(Math.max(red, green, blue) - Math.min(red, green, blue)).toBeLessThan(16);
  });
  it('has a legend that names both', () => {
    const legend = layerLegend(TIME_LAYER, fake());
    expect(legend.swatches.map((s) => s.label)).toEqual(['in sunlight', 'in shadow']);
    expect(legend.note).toMatch(/shape of the ground/);
  });
});
