import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadFile, formatBytes } from '../tools/fetch-data.mjs';

// A throwaway local server stands in for NASA, so the test downloads nothing from the internet.
const payload = randomBytes(300_000);
let server;
let baseUrl;
let dir;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/file.bin') res.writeHead(200, { 'content-length': payload.length }).end(payload);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  dir = await mkdtemp(path.join(os.tmpdir(), 'fetch-data-test-'));
});
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

describe('downloadFile', () => {
  it('saves the file and reports its size and checksum', async () => {
    const dest = path.join(dir, 'a', 'file.bin');
    const result = await downloadFile(`${baseUrl}/file.bin`, dest, { expectedBytes: payload.length });
    expect(result.skipped).toBe(false);
    expect(result.bytes).toBe(payload.length);
    expect(result.sha256).toBe(createHash('sha256').update(payload).digest('hex'));
    expect((await readFile(dest)).equals(payload)).toBe(true);
  });

  it('skips a file that is already complete', async () => {
    const dest = path.join(dir, 'a', 'file.bin');
    expect((await downloadFile(`${baseUrl}/file.bin`, dest, { expectedBytes: payload.length })).skipped).toBe(true);
  });

  it('rejects a wrong size or checksum and leaves nothing behind', async () => {
    const dest = path.join(dir, 'b', 'file.bin');
    await expect(downloadFile(`${baseUrl}/file.bin`, dest, { expectedBytes: 5 })).rejects.toThrow(/Size mismatch/);
    await expect(downloadFile(`${baseUrl}/file.bin`, dest, { expectedSha256: 'abc' })).rejects.toThrow(/Checksum mismatch/);
    expect(await readdir(path.join(dir, 'b'))).toEqual([]);
  });

  it('reports a missing file', async () => {
    await expect(downloadFile(`${baseUrl}/nope.bin`, path.join(dir, 'c', 'nope.bin'))).rejects.toThrow(/HTTP 404/);
  });
});

describe('formatBytes', () => {
  it('uses kB, MB and GB', () => {
    expect(formatBytes(4986)).toBe('5 kB');
    expect(formatBytes(66378634)).toBe('66.4 MB');
    expect(formatBytes(1061775722)).toBe('1.06 GB');
  });
});
