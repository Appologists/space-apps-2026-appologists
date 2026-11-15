import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ringDistances } from '../src/terrain/polar-grid.js';
import { makeComposite, sourcesFor } from '../server/composite.mjs';
import { cacheBytes, closeEquirectTiles, openEquirectTiles, openTileNames, parseTileLabel, tileName, tilesHeightAt, tilesOnDisk, tilesSample } from '../server/equirect-tiles.mjs';
import { openEquirect } from '../server/equirect.mjs';
import { searchLanding } from '../server/landing-search.mjs';
import { heightAt, openLolaPolar, sampleAt, samplePolarPatch } from '../server/lola-polar.mjs';
import { createTerrainStore } from '../server/terrain-sources.mjs';
import { compareTerrain, tileBox } from '../tools/check-tiles.mjs';

const DEG = Math.PI / 180;
const PPD = 4; // test tiles are 360 × 180 pixels, a quarter of a degree each
const SMALL = { pixelsPerDegree: PPD, blockW: 40, blockH: 20 };
const PIXEL_M = (Math.PI * 1737400) / 180 / PPD;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tiles-'));
const opened = [];
afterAll(() => {
  opened.forEach(closeEquirectTiles);
  fs.rmSync(tmp, { recursive: true, force: true });
});
const open = (dir, options = {}) => {
  const dem = openEquirectTiles({ dir, ...SMALL, ...options });
  opened.push(dem);
  return dem;
};
const newDir = (name) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  return dir;
};

/** A smooth made-up Moon: differs by hundreds of metres between tiles, and is the same at 0° and 360°. */
const hills = (lat, lon) => 1000 * Math.sin(lat * DEG) + Math.cos(lat * DEG) * (500 * Math.cos(lon * DEG) + 200 * Math.sin(2 * lon * DEG));

/** Write one tile the way NASA lays them out: row 0 at the north edge, column 0 at the west edge, value = 2 × metres. */
function writeTile(dir, row, col, fn = hills) {
  const w = 90 * PPD;
  const h = 45 * PPD;
  const data = new Int16Array(w * h);
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) data[r * w + c] = Math.round(2 * fn(90 - row * 45 - (r + 0.5) / PPD, col * 90 + (c + 0.5) / PPD));
  }
  fs.writeFileSync(path.join(dir, `${tileName(PPD, row, col)}.img`), Buffer.from(data.buffer));
}
function writeAll(dir, fn) {
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) writeTile(dir, row, col, fn);
}
const labelText = (row, col, { west = col * 90 } = {}) => `
    LINES                 = ${45 * PPD}
    LINE_SAMPLES          = ${90 * PPD}
    SAMPLE_TYPE           = LSB_INTEGER
    SAMPLE_BITS           = 16
    SCALING_FACTOR        = 0.5
    OFFSET                = 1737400.
 MAP_PROJECTION_TYPE          = "SIMPLE CYLINDRICAL"
 MAP_RESOLUTION               = ${PPD} <pix/deg>
 MAXIMUM_LATITUDE             = ${90 - row * 45} <deg>
 MINIMUM_LATITUDE             = ${45 - row * 45} <deg>
 WESTERNMOST_LONGITUDE        = ${west} <deg>
 EASTERNMOST_LONGITUDE        = ${west + 90} <deg>
`;

/** Repeatable random numbers in [0, 1). */
function rng(seed) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

/** A whole-Moon terrain of one height, in memory (the kind server/equirect.mjs makes). */
const flatMoon = (heightM, id) => ({ kind: 'equirect', id, width: 4, height: 2, pixelsPerDegree: 4 / 360, pixelM: 1000, westLonDeg: -180, unitM: 1, data: new Float32Array(8).fill(heightM) });

describe('tiled whole-Moon terrain', () => {
  const full = newDir('full');
  writeAll(full);

  it('names tiles the way NASA does', () => {
    expect(tileName(512, 0, 0)).toBe('ldem_512_45n_90n_000_090');
    expect(tileName(512, 2, 1)).toBe('ldem_512_45s_00s_090_180');
    expect(tileName(512, 3, 3)).toBe('ldem_512_90s_45s_270_360');
  });

  it('puts every tile where its name says', () => {
    const dem = open(full);
    expect(dem.pixelM).toBeCloseTo(PIXEL_M, 6);
    const random = rng(7);
    let worst = 0;
    for (let i = 0; i < 4000; i++) {
      const lat = -89.5 + random() * 179;
      const lon = -180 + random() * 540; // both longitude conventions
      worst = Math.max(worst, Math.abs(tilesHeightAt(dem, lat, lon) - hills(lat, lon)));
    }
    expect(worst).toBeLessThan(0.6); // rounding to half a metre, plus a little from interpolating
  });

  it('is seamless across tile edges and across 0°/360°', () => {
    const dem = open(full);
    for (const [lat, lon] of [
      [10, 90], [10, 89.999], [10, 90.001], [10, 180], [10, -90], [10, 0], [10, 360], [10, -0.01], [10, 359.99],
      [45, 30], [0, 30], [-45, 30], [45.01, 90.01], [-0.01, 269.99], [44.99, 0.01],
    ]) {
      expect(Math.abs(tilesHeightAt(dem, lat, lon) - hills(lat, lon)), `${lat}, ${lon}`).toBeLessThan(0.6);
    }
    expect(tilesHeightAt(dem, 90, 12)).toBeCloseTo(hills(90 - 0.5 / PPD, 12), 0); // clamps to the last row at a pole
    expect(Number.isNaN(tilesHeightAt(dem, -90, 200))).toBe(false);
  });

  it('gives no data where a tile is missing, and right up to its edge', () => {
    const dir = newDir('partial');
    writeTile(dir, 1, 0); // 0–45° N, 0–90° E only
    const dem = open(dir);
    expect(tilesHeightAt(dem, 20, 40)).toBeCloseTo(hills(20, 40), 0);
    expect(tilesHeightAt(dem, 20, 100)).toBeNaN(); // the tile to the east
    expect(tilesHeightAt(dem, -20, 40)).toBeNaN(); // the tile to the south
    expect(tilesHeightAt(dem, 20, 89.95)).toBeNaN(); // within half a pixel of the edge: needs the missing neighbour
    expect(tilesHeightAt(dem, 20, 89.8)).toBeCloseTo(hills(20, 89.8), 0);
    const out = tilesSample(dem, 20, 100, [1, 1]);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeNaN();
    expect(tilesOnDisk(dir, { pixelsPerDegree: PPD })).toEqual({ present: [tileName(PPD, 1, 0)], total: 16 });
  });

  it('measures slope over one pixel, allowing for pixels narrowing toward the poles', () => {
    const riseM = (PIXEL_M * PPD) * Math.tan(5 * DEG); // metres of height per degree that make a 5° slope northward
    const north = newDir('slope-north');
    writeTile(north, 1, 0, (lat) => riseM * (lat - 20));
    expect(tilesSample(open(north), 20.1, 30, [0, 0])[1]).toBeCloseTo(5, 2);
    const east = newDir('slope-east');
    writeTile(east, 1, 0, (_lat, lon) => riseM * (lon - 30));
    const expected = Math.atan(Math.tan(5 * DEG) / Math.cos(20 * DEG)) / DEG; // the same rise per degree is steeper at 20° N
    expect(tilesSample(open(east), 20, 30.1, [0, 0])[1]).toBeCloseTo(expected, 1);
  });

  it('keeps its cache under the cap and still answers correctly', () => {
    const dem = open(full, { maxBlocks: 8 });
    const random = rng(3);
    let worst = 0;
    for (let i = 0; i < 3000; i++) {
      const lat = -89 + random() * 178;
      const lon = random() * 360;
      worst = Math.max(worst, Math.abs(tilesHeightAt(dem, lat, lon) - hills(lat, lon)));
      expect(dem.loaded.length).toBeLessThanOrEqual(8);
    }
    expect(worst).toBeLessThan(0.6);
    expect(dem.stats.dropped).toBeGreaterThan(0);
    expect(cacheBytes(dem)).toBeLessThanOrEqual(8 * 40 * 20 * 2);
  });

  it('reads only the blocks a sample needs', () => {
    const dem = open(full);
    tilesHeightAt(dem, 20.3, 40.3);
    tilesHeightAt(dem, 20.4, 40.4);
    expect(dem.stats.blocksRead).toBe(1);
    expect(dem.stats.bytesRead).toBe(40 * 20 * 2);
  });

  it('ignores unfinished downloads, and picks up a tile that arrives later', () => {
    const dir = newDir('arriving');
    fs.writeFileSync(path.join(dir, `${tileName(PPD, 1, 0)}.img.part`), Buffer.alloc(1000));
    fs.writeFileSync(path.join(dir, `${tileName(PPD, 1, 1)}.img`), Buffer.alloc(1000)); // wrong size
    const dem = open(dir, { recheckMs: 0 });
    expect(openTileNames(dem)).toEqual([]);
    expect(dem.skipped.get(tileName(PPD, 1, 1))).toMatch(/1000 bytes/);
    expect(tilesHeightAt(dem, 20, 40)).toBeNaN();
    writeTile(dir, 1, 0);
    expect(tilesHeightAt(dem, 20, 40)).toBeCloseTo(hills(20, 40), 0);
    expect(openTileNames(dem)).toEqual([tileName(PPD, 1, 0)]);
  });

  it('checks a label, when there is one, against the file name', () => {
    const label = parseTileLabel(labelText(1, 2));
    expect(label).toMatchObject({ lines: 180, samples: 360, sampleBits: 16, sampleType: 'LSB_INTEGER', scalingFactor: 0.5, radiusM: 1737400, projection: 'SIMPLE CYLINDRICAL', maxLat: 45, minLat: 0, westLon: 180, eastLon: 270 });
    const dir = newDir('labels');
    writeTile(dir, 1, 0);
    fs.writeFileSync(path.join(dir, `${tileName(PPD, 1, 0)}.lbl`), labelText(1, 0));
    writeTile(dir, 1, 1);
    fs.writeFileSync(path.join(dir, `${tileName(PPD, 1, 1)}.lbl`), labelText(1, 1, { west: 180 })); // a label for some other tile
    const dem = open(dir);
    expect(openTileNames(dem)).toEqual([tileName(PPD, 1, 0)]);
    expect(dem.skipped.get(tileName(PPD, 1, 1))).toMatch(/westLon = 180, expected 90/);
  });
});

describe('best available terrain, by how fine the caller needs it', () => {
  const polar = { id: 'polar' };
  const fine = { id: 'fine' };
  const mid = { id: 'mid' };
  const coarse = { id: 'coarse' };
  const ids = (list) => list.map((dem) => dem.id).join(' ');

  it('takes the coarsest dataset that is still fine enough, then finer, then coarser', () => {
    const composite = makeComposite(
      [
        { dem: coarse, pixelM: 1895 },
        { dem: fine, pixelM: 59 },
        { dem: mid, pixelM: 474 },
      ],
      { id: 'x', pixelM: 59 },
    );
    expect(ids(sourcesFor(composite))).toBe('fine mid coarse');
    expect(ids(sourcesFor(composite, 30))).toBe('fine mid coarse'); // finer than anything here: the finest
    expect(ids(sourcesFor(composite, 80))).toBe('fine mid coarse');
    expect(ids(sourcesFor(composite, 473))).toBe('fine mid coarse');
    expect(ids(sourcesFor(composite, 500))).toBe('mid fine coarse');
    expect(ids(sourcesFor(composite, 1000))).toBe('mid fine coarse');
    expect(ids(sourcesFor(composite, 5000))).toBe('coarse mid fine');
    expect(ids(sourcesFor(composite, NaN))).toBe('fine mid coarse');
    expect(composite.detailVaries).toBe(true);
  });

  it('keeps a regional grid first whatever is asked', () => {
    const composite = makeComposite(
      [
        { dem: polar, pixelM: 80, regional: true },
        { dem: fine, pixelM: 59 },
        { dem: mid, pixelM: 474 },
      ],
      { id: 'x', pixelM: 80 },
    );
    expect(ids(sourcesFor(composite))).toBe('polar fine mid');
    expect(ids(sourcesFor(composite, 60))).toBe('polar fine mid');
    expect(ids(sourcesFor(composite, 1000))).toBe('polar mid fine');
    expect(makeComposite([{ dem: polar, pixelM: 80, regional: true }, { dem: mid, pixelM: 474 }], { id: 'x', pixelM: 80 }).detailVaries).toBe(false);
  });

  it('still reads composites made without tiers', () => {
    expect(heightAt({ kind: 'composite', sources: [flatMoon(7, 'a')] }, 0, 0, 500)).toBe(7);
  });

  const near = flatMoon(100, 'near');
  const far = flatMoon(200, 'far');
  const both = makeComposite(
    [
      { dem: near, pixelM: 59 },
      { dem: far, pixelM: 474 },
    ],
    { id: 'near+far', pixelM: 59 },
  );

  it('answers a single point from the dataset that suits the request', () => {
    expect(heightAt(both, 10, 20)).toBe(100);
    expect(heightAt(both, 10, 20, 80)).toBe(100);
    expect(heightAt(both, 10, 20, 500)).toBe(200);
    expect(sampleAt(both, 10, 20, [0, 0], 500)[0]).toBe(200);
    expect(sampleAt(both, 10, 20, [0, 0])[0]).toBe(100);
  });

  it('falls back to coarser data where the fine dataset has a hole, and to finer where the coarse has none', () => {
    const dir = newDir('hole');
    writeTile(dir, 1, 0, () => 100); // 0–45° N, 0–90° E only
    const holed = makeComposite(
      [
        { dem: open(dir), pixelM: 59 },
        { dem: far, pixelM: 474 },
      ],
      { id: 'x', pixelM: 59 },
    );
    expect(heightAt(holed, 20, 40)).toBe(100);
    expect(heightAt(holed, 20, 140)).toBe(200); // no tile there
    const onlyFine = makeComposite([{ dem: near, pixelM: 59 }, { dem: { ...far, data: new Float32Array(8).fill(NaN) }, pixelM: 474 }], { id: 'x', pixelM: 59 });
    expect(heightAt(onlyFine, 10, 20, 500)).toBe(100);
  });

  it('gives the surface view fine terrain nearby and coarse terrain far away', () => {
    const distances = ringDistances();
    const nAz = 8;
    const patch = samplePolarPatch(both, 10, 20, { nAz, distances });
    expect(patch.groundHeightM).toBe(100);
    expect(patch.pixelM).toBe(59);
    for (let k = 0; k < distances.length - 1; k++) {
      const gap = distances[k + 1] - distances[k];
      expect(patch.heights[k * nAz], `ring at ${Math.round(distances[k])} m`).toBe(gap >= 474 ? 200 : 100);
    }
    // 59 m data serves everything within about 47 km, where the rings are closer together than 474 m.
    const firstFar = distances.findIndex((d, k) => patch.heights[k * nAz] === 200);
    expect(distances[firstFar]).toBeGreaterThan(45_000);
    expect(distances[firstFar]).toBeLessThan(51_000);
  });

  it('has the landing search read fine terrain for the search area only', () => {
    const dir = newDir('search');
    writeAll(dir, () => 100);
    const tiles = open(dir);
    const composite = makeComposite(
      [
        { dem: tiles, pixelM: 59 },
        { dem: far, pixelM: 474 },
      ],
      { id: 'tiles+far', pixelM: 59 },
    );
    // The centre sits in the middle of one cache block (10° × 5° here). The search area fits inside it;
    // the far grid reaches 5° further and would pull in neighbouring blocks if it read the fine data.
    const result = searchLanding(composite, { center: { lat: 7.5, lon: 25 }, radiusKm: 10, start: '2026-11-14T00:00:00Z', durationHours: 2, stepMinutes: 60 });
    expect(result.header.groundHeightM).toBe(100);
    expect(result.header.terrainPixelM).toBe(59);
    expect(result.rasters.elevation.every((h) => h === 100)).toBe(true);
    expect(tiles.stats.blocksRead).toBe(1);
  });
});

describe('the terrain list', () => {
  it('offers the 59 m dataset, and counts it as missing until a tile is complete', () => {
    const root = newDir('root');
    const store = createTerrainStore(root);
    const entry = store.list().find((s) => s.id === 'lola-global-512');
    expect(entry).toMatchObject({ label: 'Whole Moon, 59 m', installed: false, southOfLat: null, pixelM: 59 });
    expect(entry.fetch).toContain('--large');
    expect(JSON.stringify(entry)).not.toContain('incomplete');
    fs.mkdirSync(path.join(root, 'data', 'raw', 'lola-global-512'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'raw', 'lola-global-512', 'ldem_512_00n_45n_000_090.img.part'), Buffer.alloc(10));
    expect(store.list().find((s) => s.id === 'lola-global-512').installed).toBe(false);
  });
});

// ---- Real data, when it is downloaded ------------------------------------------------------------------------
const raw = (...parts) => fileURLToPath(new URL(`../data/raw/${parts.join('/')}`, import.meta.url));
const realTiles = tilesOnDisk(raw('lola-global-512')).present;
const globalPath = [raw('ldem-16', 'ldem_16.tif'), raw('ldem-64', 'ldem_64.tif')].find((file) => fs.existsSync(file)); // the small one first: quicker to load
const polarPath = raw('lola-south-80s-80m', 'ldem_80s_80m.img');
const southTiles = realTiles.filter((name) => name.includes('_90s_45s_'));

describe.skipIf(realTiles.length === 0)('real 59 m tiles', () => {
  const real = () => {
    const dem = openEquirectTiles({ dir: raw('lola-global-512') });
    opened.push(dem);
    return dem;
  };

  it.skipIf(!globalPath)('agree with the whole-Moon map the app already uses', () => {
    const tiles = real();
    const global = openEquirect({ path: globalPath });
    for (const name of realTiles) {
      const box = tileBox(name);
      const r = compareTerrain(tiles, global, { ...box, latMin: Math.max(box.latMin, -80), latMax: Math.min(box.latMax, 80) }, { clusters: 12, perCluster: 80 });
      expect(r.n, name).toBeGreaterThan(900);
      expect(r.correlation, name).toBeGreaterThan(0.99);
      expect(Math.abs(r.meanDiffM), name).toBeLessThan(25);
    }
    expect(cacheBytes(tiles)).toBeLessThan(300e6);
  }, 60_000);

  it.skipIf(southTiles.length === 0 || !fs.existsSync(polarPath))('agree with the 80 m south-pole grid between 80° and 88° S', async () => {
    const tiles = real();
    const polar = await openLolaPolar({ imgPath: polarPath, lblPath: polarPath.replace(/img$/, 'lbl') });
    for (const name of southTiles) {
      const r = compareTerrain(tiles, polar, { ...tileBox(name), latMin: -88, latMax: -80 }, { clusters: 12, perCluster: 80 });
      expect(r.n, name).toBeGreaterThan(900);
      expect(r.correlation, name).toBeGreaterThan(0.995);
      expect(Math.abs(r.meanDiffM), name).toBeLessThan(10);
    }
  }, 60_000);
});
