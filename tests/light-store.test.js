import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createLightStore, lightKey, writeLight } from '../server/light-store.mjs';

// A fake stored region: 3 bytes a row, 48 hourly rows from 21 Nov 2026 00:00 UTC; row h holds the bytes h, h+100, h+200.
const dir = mkdtempSync(path.join(tmpdir(), 'light-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const stride = 3;
const hours = 48;
const rows = (offset) => Uint8Array.from({ length: hours * stride }, (_, i) => (Math.floor(i / stride) + offset + (i % stride) * 100) % 256);
const keys = { dataKey: 'lola-south-80s-80m', codeKey: 'abc' };
const place = { center: { lat: -89.5, lon: -150 }, radiusKm: 10, panelHeightM: 2, antennaHeightM: 2 };
writeLight(path.join(dir, 'ridge-10km.bin'), { key: lightKey(place, keys), regionId: 'ridge', start: '2026-11-21T00:00:00.000Z', hours, maskStride: stride }, rows(0), rows(50));
const store = createLightStore(dir);
const series = (steps) => ({ samples: new Array(steps) });
const rowOf = (mask, i) => Array.from(mask.slice(i * stride, (i + 1) * stride));

describe('stored sunlight and Earth maps', () => {
  it('hands back exactly the rows for a mission that starts inside the stored hours', () => {
    const got = store.find({ ...place, start: '2026-11-21T05:00:00.000Z', stepMinutes: 60 }, keys, series(10));
    expect(got.sunMask.length).toBe(10 * stride);
    expect(rowOf(got.sunMask, 0)).toEqual([5, 105, 205]);
    expect(rowOf(got.sunMask, 9)).toEqual([14, 114, 214]);
    expect(rowOf(got.earthMask, 0)).toEqual([55, 155, 255 % 256]);
  });

  it('takes every other row for a two-hour step', () => {
    const got = store.find({ ...place, start: '2026-11-21T00:00:00.000Z', stepMinutes: 120 }, keys, series(5));
    expect([0, 1, 2, 3, 4].map((i) => rowOf(got.sunMask, i)[0])).toEqual([0, 2, 4, 6, 8]);
  });

  it('finds nothing when anything the maps depend on differs, or the times are not covered', () => {
    const at = { ...place, start: '2026-11-21T00:00:00.000Z', stepMinutes: 60 };
    expect(store.find(at, keys, series(48))).not.toBeNull(); // the last stored hour, just covered
    expect(store.find(at, keys, series(49))).toBeNull(); // one hour past the end
    expect(store.find({ ...at, start: '2026-11-20T23:00:00.000Z' }, keys, series(2))).toBeNull(); // before the start
    expect(store.find({ ...at, start: '2026-11-21T00:30:00.000Z' }, keys, series(2))).toBeNull(); // not on the hour
    expect(store.find({ ...at, stepMinutes: 90 }, keys, series(2))).toBeNull(); // not whole hours
    expect(store.find({ ...at, radiusKm: 20 }, keys, series(2))).toBeNull();
    expect(store.find({ ...at, panelHeightM: 3 }, keys, series(2))).toBeNull();
    expect(store.find(at, { ...keys, dataKey: 'other' }, series(2))).toBeNull(); // other terrain downloaded
    expect(store.find(at, { ...keys, codeKey: 'newer' }, series(2))).toBeNull(); // the code changed
  });
});
