#!/usr/bin/env node
// Checks the tiled 59 m whole-Moon data (lola-global-512) against terrain the app already trusts:
// the 80 m south-pole grid between 80° and 88° S, and a whole-Moon map (ldem-64, else ldem-16) elsewhere.
// A wrong layout (tiles swapped, north and south flipped, longitudes shifted) would show as a correlation
// far from 1. Works with whatever tiles are downloaded.
// Usage: npm run check:tiles
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openEquirectTiles, openTileNames } from '../server/equirect-tiles.mjs';
import { openEquirect } from '../server/equirect.mjs';
import { heightAt, openLolaPolar } from '../server/lola-polar.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAT_TOP = { '45n_90n': 90, '00n_45n': 45, '45s_00s': 0, '90s_45s': -45 };

/** A small repeatable random-number generator, so the check samples the same points every run. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compare two terrains at points drawn in small clusters (a cluster stays inside a few cache blocks, so
 * the check reads megabytes, not gigabytes).
 * @param {object} tiles      the tiled terrain
 * @param {object} reference  any terrain heightAt() understands
 * @param {{latMin: number, latMax: number, lonMin: number, lonMax: number}} box  longitudes in 0–360
 * @returns {{n: number, correlation: number, meanDiffM: number, spreadM: number}} differences are tiles − reference
 */
export function compareTerrain(tiles, reference, box, { clusters = 30, perCluster = 100, clusterDeg = 0.2, seed = 1 } = {}) {
  const random = mulberry32(seed);
  let n = 0;
  let sa = 0;
  let sb = 0;
  let saa = 0;
  let sbb = 0;
  let sab = 0;
  let sd = 0;
  let sdd = 0;
  for (let k = 0; k < clusters; k++) {
    const lat0 = box.latMin + random() * (box.latMax - box.latMin - clusterDeg);
    const lon0 = box.lonMin + random() * (box.lonMax - box.lonMin - clusterDeg);
    for (let i = 0; i < perCluster; i++) {
      const lat = lat0 + random() * clusterDeg;
      const lon = lon0 + random() * clusterDeg;
      const a = heightAt(tiles, lat, lon);
      const b = heightAt(reference, lat, lon > 180 ? lon - 360 : lon);
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      n++;
      sa += a;
      sb += b;
      saa += a * a;
      sbb += b * b;
      sab += a * b;
      sd += a - b;
      sdd += (a - b) ** 2;
    }
  }
  const cov = sab / n - (sa / n) * (sb / n);
  const meanDiffM = sd / n;
  return {
    n,
    correlation: cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2)),
    meanDiffM,
    spreadM: Math.sqrt(Math.max(sdd / n - meanDiffM ** 2, 0)),
  };
}

/** The latitude/longitude box of a tile, from its name (`ldem_512_45s_00s_090_180`). */
export function tileBox(name) {
  const [, , south, north, west] = name.split('_');
  const latMax = LAT_TOP[`${south}_${north}`];
  return { latMin: latMax - 45, latMax, lonMin: Number(west), lonMax: Number(west) + 90 };
}

async function main() {
  const raw = (...parts) => path.join(ROOT, 'data', 'raw', ...parts);
  const tiles = openEquirectTiles({ dir: raw('lola-global-512'), id: 'lola-global-512' });
  const names = openTileNames(tiles);
  if (names.length === 0) {
    console.log('No complete tiles yet. Get them with: npm run data:fetch -- lola-global-512 --large');
    return;
  }
  for (const [name, why] of tiles.skipped) console.log(`Not used: ${name} (${why})`);
  const globalPath = [raw('ldem-64', 'ldem_64.tif'), raw('ldem-16', 'ldem_16.tif')].find(existsSync);
  const global = globalPath ? openEquirect({ path: globalPath }) : null;
  const polarImg = raw('lola-south-80s-80m', 'ldem_80s_80m.img');
  const polar = existsSync(polarImg) ? await openLolaPolar({ imgPath: polarImg, lblPath: polarImg.replace(/img$/, 'lbl') }) : null;
  if (!global) console.log('No whole-Moon map to compare with (npm run data:fetch -- ldem-16).');
  if (!polar) console.log('No south-pole grid to compare with (npm run data:fetch -- lola-south-80s-80m).');

  const line = (name, against, r) =>
    console.log(`${name}  vs ${against.padEnd(22)} ${String(r.n).padStart(5)} points  correlation ${r.correlation.toFixed(4)}  mean difference ${r.meanDiffM.toFixed(1)} m  spread ${r.spreadM.toFixed(1)} m`);
  let worst = 1;
  console.log(`${names.length} of 16 tiles are here.`);
  for (const name of names) {
    const box = tileBox(name);
    if (global) {
      // Stay off the poles, where a whole-Moon map's pixels are slivers and the polar grid is the better check.
      const r = compareTerrain(tiles, global, { ...box, latMin: Math.max(box.latMin, -80), latMax: Math.min(box.latMax, 80) });
      line(name, `${Math.round(global.pixelM)} m whole-Moon map`, r);
      worst = Math.min(worst, r.correlation);
    }
    if (polar && box.latMin === -90) {
      const r = compareTerrain(tiles, polar, { ...box, latMin: -88, latMax: -80 });
      line(name, '80 m south-pole grid', r);
      worst = Math.min(worst, r.correlation);
    }
  }
  console.log(`Read ${(tiles.stats.bytesRead / 1e6).toFixed(0)} MB from the tiles.`);
  if (worst < 0.98) {
    console.log('A correlation is far from 1: the tile layout or a file is wrong.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
