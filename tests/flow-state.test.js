import { describe, expect, it } from 'vitest';
import { defaultFinder } from '../src/finder/score.js';
import { decodeFlow, encodeFlow } from '../src/ui/flow-state.js';

const state = {
  step: 3,
  profile: 'custom',
  start: new Date('2026-11-21T00:00:00Z'),
  durationHours: 336,
  values: { ...defaultFinder(), ellipseRadiusM: 100, roverNeedsEarthToDrive: true },
  region: 'peak-near-shackleton',
  startAt: { lat: -89.00312, lon: 122.70654 },
  targets: [{ lat: -88.862, lon: 132.194 }, { lat: -88.9, lon: -179.5 }],
};

describe('the mission steps in the address', () => {
  it('comes back the same after a round trip', () => {
    const back = decodeFlow(encodeFlow(state));
    expect(back).toEqual(state);
  });

  it('keeps every finder value, so a new one cannot be forgotten here', () => {
    expect(Object.keys(decodeFlow(encodeFlow(state)).values).sort()).toEqual(Object.keys(defaultFinder()).sort());
  });

  it('keeps a mission length that is not a whole number of hours', () => {
    expect(decodeFlow(encodeFlow({ ...state, durationHours: 708.734136 })).durationHours).toBeCloseTo(708.734, 3);
  });

  it('leaves out what it cannot read, and accepts a leading #', () => {
    expect(decodeFlow('')).toEqual({});
    expect(decodeFlow('#step=9&t=nonsense&d=-4&f=1,2,3&from=95,0&to=abc;1,2')).toEqual({ targets: [{ lat: 1, lon: 2 }] });
    expect(decodeFlow(`#${encodeFlow(state)}`).step).toBe(3);
  });

  it('writes no drive when there is none', () => {
    const text = encodeFlow({ ...state, region: null, startAt: null, targets: [] });
    expect(text).not.toMatch(/region|from|to=/);
  });
});
