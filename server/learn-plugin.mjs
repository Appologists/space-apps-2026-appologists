// The education page (education/) inside the team's dev server: `npm run dev` shows it at
// http://localhost:5173/learn, with no Python. Node only (AGENTS.md rule 6); the browser asks for small pieces.
//
// It answers the page's data requests itself:
//   /api/site                  Sun and Earth in a site's sky, from src/astro (Astronomy Engine; the team checks
//                              it against JPL Horizons with `npm run check:horizons`)
//   /api/diviner/point, /map   NASA LRO Diviner temperatures, from lunar-planner/derived/diviner_tbol.npz (in git)
//   /api/epic, /api/learn/epic.jpg, /api/learn/sdo/<ch>.jpg   NASA EPIC and SDO images, relayed (they send no CORS)
//   /api/learn/leaderboard, /api/learn/score                  the leaderboard, lunar-planner/data/leaderboard.json
//   /api/health                the git commit, so an open /learn page reloads after a pull
// With ?tools in the address it also adds "Education" and "Explorer" links to the main page (the demo page
// stays clean without it). /classic (the explorer) is the Python app in
// lunar-planner/: when that runs, /classic goes there; when not, it says how to start it.
//
// Live sync is off unless you ask for it. Start the dev server with LUNAR_SYNC=1 and, on branch main, it pulls
// origin/main every minute (fast-forward only, so it never merges or overwrites local work) and Vite reloads
// open pages. Leave it off while presenting: a teammate's push would reload the page in front of the audience,
// and it runs whatever was pushed without anyone looking first.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateRawSync } from 'node:zlib';
import { skyAt } from '../src/astro/sky.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDU = join(ROOT, 'education');
const LP = join(ROOT, 'lunar-planner');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.bin': 'application/octet-stream', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
};

// ---------- small helpers ----------
function send(res, status, body, type, cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json');

/** A file under `base`, or null (never outside it). */
function fileIn(base, rel) {
  const path = normalize(join(base, rel));
  return path.startsWith(base + sep) && existsSync(path) ? path : null;
}
function sendFile(res, path, cache = 'no-store') {
  send(res, 200, readFileSync(path), TYPES[extname(path)] || 'application/octet-stream', cache);
}
function number(q, key, lo, hi) {
  const v = Number(q.get(key));
  if (!Number.isFinite(v) || v < lo || v > hi) throw new Error(`Check ${key}.`);
  return v;
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 10_000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

// ---------- git commit (read from .git, no git needed) ----------
function gitCommit() {
  try {
    const git = join(ROOT, '.git');
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head.slice(0, 12);
    const ref = head.slice(5);
    if (existsSync(join(git, ref))) return readFileSync(join(git, ref), 'utf8').trim().slice(0, 12);
    const line = readFileSync(join(git, 'packed-refs'), 'utf8').split('\n').find((l) => l.endsWith(' ' + ref));
    return line ? line.slice(0, 12) : '';
  } catch {
    return '';
  }
}

// ---------- NASA LRO Diviner: 24 maps in an .npz (a zip of .npy files) ----------
function readNpz(path) {
  const buf = readFileSync(path);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    out[name.replace(/\.npy$/, '')] = readNpy(method === 8 ? inflateRawSync(raw) : raw);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function readNpy(b) {
  const major = b[6];
  const headerLen = major === 1 ? b.readUInt16LE(8) : b.readUInt32LE(8);
  const start = (major === 1 ? 10 : 12) + headerLen;
  const header = b.toString('latin1', major === 1 ? 10 : 12, start);
  const descr = /'descr':\s*'([^']+)'/.exec(header)[1];
  const shape = (/'shape':\s*\(([^)]*)\)/.exec(header)[1].match(/\d+/g) ?? []).map(Number);
  const data = b.subarray(start);
  if (descr === '|u1') return { shape, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
  if (descr === '<f8') return { shape, data: [data.readDoubleLE(0)] };
  if (descr === '<i8') return { shape, data: Array.from({ length: data.length / 8 }, (_, i) => Number(data.readBigInt64LE(i * 8))) };
  return { shape, data: null };
}

let diviner;
function divinerMaps() {
  if (diviner === undefined) {
    const path = join(LP, 'derived', 'diviner_tbol.npz');
    diviner = null;
    if (existsSync(path)) {
      const z = readNpz(path);
      diviner = { maps: z.maps.data, offset: z.offset.data[0], step: z.step.data[0] };
    }
  }
  return diviner;
}
/** Measured temperature (K), bilinear in space and linear in Sun position: the same as lunar_server.py. */
function divinerTemp(d, lat, lon, sslon) {
  const fy = Math.min(359, Math.max(0, (89.75 - lat) / 0.5));
  const fx = ((((lon + 179.75) / 0.5) % 720) + 720) % 720;
  const y0 = Math.floor(Math.min(fy, 358.999));
  const x0 = Math.floor(fx) % 720;
  const x1 = (x0 + 1) % 720;
  const ay = fy - y0;
  const ax = fx - Math.floor(fx);
  const s = ((sslon % 360) + 360) % 360 / 15;
  const i0 = Math.floor(s) % 24;
  const i1 = (i0 + 1) % 24;
  const w = s - Math.floor(s);
  const at = (i) => {
    const k = (y, x) => d.offset + d.step * d.maps[i * 259200 + y * 720 + x];
    return k(y0, x0) * (1 - ax) * (1 - ay) + k(y0, x1) * ax * (1 - ay) + k(y0 + 1, x0) * (1 - ax) * ay + k(y0 + 1, x1) * ax * ay;
  };
  return at(i0) * (1 - w) + at(i1) * w;
}

// ---------- PNG writer (for the Diviner map) ----------
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function pngRGB(width, height, rgb) {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const TEMP_STOPS = [[40, [25, 35, 90]], [130, [50, 120, 190]], [220, [230, 220, 190]], [310, [235, 150, 80]], [400, [200, 60, 50]]];
function tempRGB(k) {
  const v = Math.min(400, Math.max(40, k));
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    const [t0, c0] = TEMP_STOPS[i - 1];
    if (v <= t1) {
      const f = (v - t0) / (t1 - t0);
      return c0.map((c, j) => Math.round(c * (1 - f) + c1[j] * f));
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}
const mapCache = {};
function divinerMapPng(d, kind) {
  if (!mapCache[kind]) {
    const rgb = Buffer.alloc(720 * 360 * 3);
    for (let p = 0; p < 720 * 360; p++) {
      let v = kind === 'max' ? 0 : 255;
      for (let i = 0; i < 24; i++) {
        const m = d.maps[i * 259200 + p];
        v = kind === 'max' ? Math.max(v, m) : Math.min(v, m);
      }
      const c = tempRGB(d.offset + d.step * v);
      rgb[p * 3] = c[0];
      rgb[p * 3 + 1] = c[1];
      rgb[p * 3 + 2] = c[2];
    }
    mapCache[kind] = pngRGB(720, 360, rgb);
  }
  return mapCache[kind];
}

// ---------- NASA image relays ----------
const relayCache = new Map();
async function relay(res, key, url, ttlS) {
  const hit = relayCache.get(key);
  if (hit && hit.until > Date.now()) return send(res, 200, hit.body, 'image/jpeg', 'max-age=600');
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = Buffer.from(await r.arrayBuffer());
    relayCache.set(key, { until: Date.now() + ttlS * 1000, body });
    send(res, 200, body, 'image/jpeg', 'max-age=600');
  } catch (error) {
    if (hit) return send(res, 200, hit.body, 'image/jpeg');
    json(res, 502, { error: `NASA image request failed: ${error.message}` });
  }
}
let epicCache = null;
async function epicLatest() {
  if (epicCache && epicCache.until > Date.now()) return epicCache.data;
  const r = await fetch('https://epic.gsfc.nasa.gov/api/natural', { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const latest = (await r.json()).at(-1);
  const [day, time] = latest.date.split(' ');
  const data = {
    url: `https://epic.gsfc.nasa.gov/archive/natural/${day.replaceAll('-', '/')}/jpg/${latest.image}.jpg`,
    date_utc: `${day} ${time.slice(0, 5)}`,
    caption: latest.caption ?? '',
    centroid: latest.centroid_coordinates ?? {},
  };
  epicCache = { until: Date.now() + 3_600_000, data };
  return data;
}

// ---------- Leaderboard (same file and rules as lunar-planner/learn_api.py) ----------
const BOARD = join(LP, 'data', 'leaderboard.json');
const GAMES = { quiz: 'Mission quiz', hotcold: 'Temperature estimate' };
const MAX_SCORE = { quiz: 4000, hotcold: 1000 };
const NAME_RE = /^[A-Za-z0-9 _.'-]{1,20}$/;
function loadBoard() {
  try {
    const data = JSON.parse(readFileSync(BOARD, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}
const order = (a, b) => b.score - a.score || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
const top = (board, game) => board.filter((r) => r.game === game).sort(order).slice(0, 10);

// ---------- Explorer (Python app in lunar-planner/) ----------
async function explorerPort() {
  for (const port of [Number(readSafe(join(LP, '.port'))) || 0, 8002].filter(Boolean)) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
      if (r.ok && (await r.json()).app) return port;
    } catch {
      // not running on this port
    }
  }
  return null;
}
function readSafe(path) {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}
const EXPLORER_HELP = `<!doctype html><meta charset="utf-8"><title>Explorer</title>
<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#000;color:#ededed;font:16px system-ui,sans-serif">
<div style="max-width:560px;padding:28px;border:1px solid #2e2e2e;border-radius:14px;background:#0a0a0a">
<p style="margin:0 0 6px;color:#f5c96b;font:12px monospace;letter-spacing:.12em">EXPLORER</p>
<h1 style="margin:0 0 12px;font-size:26px">The explorer runs on our Python server</h1>
<p style="color:#a1a1a1;line-height:1.6">The ranking and the street view (with the rover) are in <code>lunar-planner/</code>.
Start it once in a second terminal, then reload this page:</p>
<pre style="padding:12px;border-radius:8px;background:#111;overflow:auto">cd lunar-planner
powershell -ExecutionPolicy Bypass -File .\\start.ps1     (Windows)
bash start.sh                                            (Mac / Linux)</pre>
<p><a href="/learn" style="color:#f5c96b">&larr; Back to Education</a> &nbsp; <a href="/" style="color:#a1a1a1">Main site</a></p></div></body>`;

// ---------- Live sync ----------
/** Live sync runs only when asked for (LUNAR_SYNC=1), and never in CI. */
export const syncWanted = (env) => env.LUNAR_SYNC === '1' && !env.CI;

function startSync(log) {
  if (!syncWanted(process.env)) return;
  const git = (args) => new Promise((resolve) => execFile('git', args, { cwd: ROOT, timeout: 50_000 }, (err, out) => resolve(err ? null : out.trim())));
  const pull = async () => {
    if ((await git(['rev-parse', '--abbrev-ref', 'HEAD'])) !== 'main') return;
    const before = await git(['rev-parse', 'HEAD']);
    if ((await git(['pull', '--ff-only', '--quiet', 'origin', 'main'])) === null) return;
    const after = await git(['rev-parse', 'HEAD']);
    if (after && after !== before) log(`Live sync: updated to ${after.slice(0, 7)} from GitHub. Open pages reload.`);
  };
  log('Live sync is on (LUNAR_SYNC=1): on branch main, the newest origin/main is pulled every minute.');
  setInterval(pull, 60_000).unref();
  pull();
}

/** The main page gets the links only on the dev server (the built copy has no /learn) and only with ?tools. */
export function wantsTools(ctx) {
  if (!ctx?.server) return false;
  try {
    return new URL(ctx.originalUrl ?? '', 'http://x').searchParams.has('tools');
  } catch {
    return false;
  }
}

// ---------- The requests ----------
/** Answers the education page's requests; passes everything else on. Used by the dev and the preview server. */
async function handle(req, res, next) {
  // An address that cannot be read (a broken %-escape, say) is not ours: pass it on. Throwing here would
  // be an unhandled rejection, which stops the dev server.
  let url;
  let path;
  try {
    url = new URL(req.url, 'http://x');
    path = decodeURIComponent(url.pathname);
  } catch {
    return next();
  }
  const q = url.searchParams;
  try {
    // Education page and its files (served as they are: they use their own import map, not Vite's).
    if (path === '/learn' || path === '/learn/') return sendFile(res, join(EDU, 'index.html'));
    if (path.startsWith('/learn/') && !path.startsWith('/learn/api')) {
      const f = fileIn(EDU, path.slice(7));
      return f ? sendFile(res, f, path.includes('/fonts/') ? 'max-age=86400' : 'no-store') : next();
    }
    // Shared files from the Python app's public folder.
    if (path === '/lunar-game.js' || path === '/live-sync.js' || path.startsWith('/vendor/')) {
      const f = fileIn(join(LP, 'public'), path.slice(1));
      return f ? sendFile(res, f, path.startsWith('/vendor/') ? 'max-age=86400' : 'no-store') : next();
    }
    if (path === '/textures/moon-hd.jpg') return sendFile(res, join(ROOT, 'public', 'textures', 'moon_lroc_color_4k.jpg'), 'max-age=86400');
    if (['/textures/moon-elevation-grid.bin', '/textures/moon-elevation.png', '/textures/moon-elevation.json'].includes(path)) {
      const f = fileIn(join(LP, 'public'), path.slice(1));
      if (f) return sendFile(res, f, 'max-age=3600');
      // The heights file is made by lunar-planner/build_terrain.py. Without it the page uses the picture;
      // "no content" tells it so without an error in the console.
      return send(res, path.endsWith('.bin') ? 204 : 404, '', 'text/plain');
    }
    if (path === '/classic' || path.startsWith('/classic/')) {
      const port = await explorerPort();
      if (port) {
        res.statusCode = 302;
        res.setHeader('Location', `http://127.0.0.1:${port}${path}${url.search}`);
        return res.end();
      }
      return send(res, 200, EXPLORER_HELP, 'text/html; charset=utf-8');
    }
    if (!path.startsWith('/api/')) return next();
    // Data for the page.
    if (path === '/api/health') return json(res, 200, { status: 'ok', app: 'Lunar Navigator dev server', commit: gitCommit() });
    if (path === '/api/site') {
      const lat = number(q, 'lat', -90, 90);
      const lon = number(q, 'lon', -180, 360);
      const days = Math.min(7, Math.max(1, Number(q.get('days')) || 1));
      const site = { lat, lon: ((lon + 180) % 360 + 360) % 360 - 180 };
      const start = new Date(Math.floor(Date.now() / 1_800_000) * 1_800_000);
      const samples = [];
      for (let t = 0; t <= days * 48; t++) {
        const date = new Date(start.getTime() + t * 1_800_000);
        const sky = skyAt(site, date);
        samples.push({
          t: date.toISOString().slice(0, 16) + 'Z',
          sun_az: +sky.sun.azimuth.toFixed(4), sun_el: +sky.sun.elevation.toFixed(4), sun_au: +sky.sunDistanceAU.toFixed(8),
          earth_az: +sky.earth.azimuth.toFixed(4), earth_el: +sky.earth.elevation.toFixed(4), earth_km: +sky.earth.rangeKm.toFixed(1),
          sun_ok: sky.sun.elevation > 0, earth_ok: sky.earth.elevation > 0,
        });
      }
      return json(res, 200, {
        site, samples, window: { start: samples[0].t, days, step_minutes: 30 },
        source: 'Astronomy Engine (the team checks it against NASA/JPL Horizons)',
        model: 'Directions of body centres over a smooth Moon. No terrain shadowing.',
      });
    }
    if (path === '/api/diviner/point') {
      const d = divinerMaps();
      if (!d) return json(res, 404, { error: 'Diviner data missing.' });
      const lat = number(q, 'lat', -90, 90);
      const lon = ((number(q, 'lon', -180, 360) + 180) % 360 + 360) % 360 - 180;
      const subs = Array.from({ length: 24 }, (_, i) => i * 15);
      const temp = subs.map((s) => Math.round(divinerTemp(d, lat, lon, s) * 10) / 10);
      return json(res, 200, {
        subsolar_lon: subs, temp_k: temp, min_k: Math.min(...temp), max_k: Math.max(...temp),
        local_time_h: subs.map((s) => Math.round(((((12 + (lon - s) / 15) % 24) + 24) % 24) * 100) / 100),
        source: 'NASA LRO Diviner bolometric temperature snapshots, 0.5 deg grid (Williams et al. 2017)',
      });
    }
    if (path === '/api/diviner/map') {
      const d = divinerMaps();
      const kind = q.get('kind') || 'max';
      if (!d) return json(res, 404, { error: 'Diviner data missing.' });
      if (kind !== 'max' && kind !== 'min') return json(res, 400, { error: 'kind must be max or min here' });
      return send(res, 200, divinerMapPng(d, kind), 'image/png', 'max-age=86400');
    }
    if (path === '/api/epic') return json(res, 200, await epicLatest());
    if (path === '/api/learn/epic.jpg') return relay(res, 'epic', (await epicLatest()).url, 3600);
    const sdo = /^\/api\/learn\/sdo\/(0171|0193|0304|HMIIC)\.jpg$/.exec(path);
    if (sdo) return relay(res, `sdo-${sdo[1]}`, `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_${sdo[1]}.jpg`, 900);
    if (path === '/api/learn/leaderboard') {
      const game = q.get('game') || 'quiz';
      if (!GAMES[game]) return json(res, 400, { error: 'Unknown game.' });
      const board = loadBoard();
      return json(res, 200, { game, title: GAMES[game], top: top(board, game), players: new Set(board.filter((r) => r.game === game).map((r) => r.name.toLowerCase())).size });
    }
    if (path === '/api/learn/score' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name ?? '').trim();
      const game = body.game;
      const score = Number(body.score);
      if (!Number.isInteger(score)) return json(res, 400, { error: 'Score must be a whole number.' });
      if (!GAMES[game]) return json(res, 400, { error: 'Unknown game.' });
      if (!NAME_RE.test(name)) return json(res, 400, { error: 'Use 1 to 20 letters, numbers, spaces, dots, dashes or underscores.' });
      if (score < 0 || score > MAX_SCORE[game]) return json(res, 400, { error: 'That score is out of range.' });
      const board = loadBoard();
      board.push({ name, game, score, at: new Date().toISOString().slice(0, 16).replace('T', ' ') });
      board.sort(order);
      const per = new Map();
      const kept = board.filter((r) => {
        const key = `${r.game}|${r.name.toLowerCase()}`;
        per.set(key, (per.get(key) ?? 0) + 1);
        return per.get(key) <= 5;
      }).slice(0, 1000);
      mkdirSync(dirname(BOARD), { recursive: true });
      writeFileSync(BOARD + '.tmp', JSON.stringify(kept));
      renameSync(BOARD + '.tmp', BOARD);
      const rank = 1 + kept.filter((r) => r.game === game && r.score > score).length;
      return json(res, 200, { rank, top: top(kept, game), title: GAMES[game] });
    }
    return next();
  } catch (error) {
    return json(res, 400, { error: error.message });
  }
}

// ---------- The plugin ----------
export function learnPages() {
  return {
    name: 'learn-pages',
    configureServer(server) {
      startSync((text) => server.config.logger.info(`\n  ${text}`));
      server.middlewares.use(handle);
    },
    // `npm run preview` (the built app on a local server) gets the same page and data. No live sync there.
    configurePreviewServer(server) {
      // The page reads the app's sites and missions. The dev server serves them from the project folder by itself
      // (and must: the app imports them as modules); the preview server only has the built files.
      server.middlewares.use((req, res, next) => {
        const path = req.url.split('?')[0];
        return path === '/data/sites.json' || path === '/data/missions.json' ? sendFile(res, join(ROOT, path.slice(1))) : next();
      });
      server.middlewares.use(handle);
    },
    // Links from the main page to Education and the Explorer (index.html itself is not changed). Like the main
    // page's other extras they show only with ?tools in the address, so the demo page stays clean.
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.path !== '/index.html' || !wantsTools(ctx)) return html;
        const style = 'color:#c9c4bb;text-decoration:none;padding:5px 10px;border-radius:7px;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.12)';
        const nav = `<nav aria-label="Other pages" style="position:fixed;right:12px;top:48px;z-index:50;display:flex;gap:6px;font:12px system-ui,sans-serif">`
          + `<a href="/learn" style="${style}">Education</a><a href="/classic" style="${style}">Explorer &rarr;</a></nav>`;
        return html.replace('</body>', `${nav}\n</body>`);
      },
    },
  };
}
