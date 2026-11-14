#!/usr/bin/env node
// Pulls large datasets listed in data/catalog.json into data/raw/<id>/ (git-ignored).
//
//   npm run data:list                 what is in the catalog, and what you already have
//   npm run data:check                ask each server whether the files still exist (downloads nothing)
//   npm run data:fetch -- ldem-16     download one or more datasets by id
//   npm run data:fetch -- ldem-64 --large    datasets over 500 MB need --large
//
// No dependencies: Node 22+ only.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LARGE_BYTES = 500 * 1024 * 1024;

export const formatBytes = (n) =>
  n == null ? 'unknown size' : n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} kB`;

export async function loadCatalog(file = path.join(ROOT, 'data', 'catalog.json')) {
  return JSON.parse(await readFile(file, 'utf8')).datasets;
}

const fileName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop());
const sizeOnDisk = async (file) => (await stat(file).catch(() => null))?.size ?? null;

/**
 * Download one file. Writes to <dest>.part and renames only when the size (and checksum, if given) match,
 * so a half-finished download is never mistaken for a complete file.
 * @returns {Promise<{bytes: number, sha256: string|null, skipped: boolean}>}
 */
export async function downloadFile(url, dest, { expectedBytes, expectedSha256, onProgress } = {}) {
  const have = await sizeOnDisk(dest);
  if (have != null && (expectedBytes == null || have === expectedBytes)) return { bytes: have, sha256: null, skipped: true };

  await mkdir(path.dirname(dest), { recursive: true });
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);

  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, done) {
      bytes += chunk.length;
      hash.update(chunk);
      onProgress?.(bytes);
      done(null, chunk);
    },
  });
  const part = `${dest}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part));
    const sha256 = hash.digest('hex');
    if (expectedBytes != null && bytes !== expectedBytes) throw new Error(`Size mismatch for ${url}: got ${bytes} bytes, expected ${expectedBytes}`);
    if (expectedSha256 && sha256 !== expectedSha256) throw new Error(`Checksum mismatch for ${url}`);
    await rename(part, dest);
    return { bytes, sha256, skipped: false };
  } catch (error) {
    await rm(part, { force: true });
    throw error;
  }
}

const destFor = (dataset, file) => path.join(ROOT, 'data', 'raw', dataset.id, fileName(file.url));
const totalBytes = (dataset) => dataset.files.reduce((sum, f) => sum + (f.bytes ?? 0), 0);

async function list(datasets) {
  for (const d of datasets) {
    const present = (await Promise.all(d.files.map(async (f) => (await sizeOnDisk(destFor(d, f))) === f.bytes))).every(Boolean);
    console.log(`${present ? '[downloaded]' : '[not here]  '} ${d.id.padEnd(22)} ${formatBytes(totalBytes(d)).padStart(9)}  ${d.title}`);
  }
  console.log('\nDownload with: npm run data:fetch -- <id>');
}

async function check(datasets) {
  let problems = 0;
  for (const d of datasets) {
    for (const f of d.files) {
      const response = await fetch(f.url, { method: 'HEAD', redirect: 'follow' }).catch((e) => ({ ok: false, status: e.message }));
      const length = response.ok ? Number(response.headers.get('content-length')) : null;
      const ok = response.ok && (f.bytes == null || length === f.bytes);
      if (!ok) problems++;
      console.log(
        `${ok ? 'ok     ' : 'PROBLEM'} ${d.id.padEnd(22)} ${fileName(f.url).padEnd(26)} ` +
          `${response.ok ? formatBytes(length) : `HTTP ${response.status}`}${ok ? '' : `  (catalog says ${formatBytes(f.bytes)})`}`,
      );
    }
  }
  return problems;
}

async function fetchDatasets(datasets, ids, allowLarge) {
  for (const id of ids) {
    const d = datasets.find((x) => x.id === id);
    if (!d) throw new Error(`No dataset "${id}" in data/catalog.json. Run: npm run data:list`);
    if (totalBytes(d) > LARGE_BYTES && !allowLarge) {
      throw new Error(`${id} is ${formatBytes(totalBytes(d))}. Add --large if you really want it.`);
    }
    console.log(`${d.id}: ${d.title} (${formatBytes(totalBytes(d))})\n  ${d.license}`);
    for (const f of d.files) {
      const dest = destFor(d, f);
      let lastShown = 0;
      const result = await downloadFile(f.url, dest, {
        expectedBytes: f.bytes,
        expectedSha256: f.sha256,
        onProgress: (bytes) => {
          if (bytes - lastShown > 20e6) {
            lastShown = bytes;
            process.stdout.write(`\r  ${fileName(f.url)}: ${formatBytes(bytes)} of ${formatBytes(f.bytes)}   `);
          }
        },
      });
      const where = path.relative(ROOT, dest);
      console.log(
        result.skipped
          ? `  already have ${where}`
          : `\r  saved ${where} (${formatBytes(result.bytes)}, sha256 ${result.sha256.slice(0, 12)}…)   `,
      );
    }
  }
}

async function main(argv) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const ids = argv.filter((a) => !a.startsWith('--'));
  const datasets = await loadCatalog();
  if (flags.has('--check')) process.exit((await check(datasets)) ? 1 : 0);
  if (flags.has('--list') || ids.length === 0) return list(datasets);
  await fetchDatasets(datasets, ids, flags.has('--large'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
