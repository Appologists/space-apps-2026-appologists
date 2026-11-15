// The dev-server plugin for the education page: what it must not do to the main app.
import { existsSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { learnPages, syncWanted, wantsTools } from '../server/learn-plugin.mjs';
import { LEARN_COPIES } from '../tools/copy-learn.mjs';

describe('live sync', () => {
  it('is off unless asked for', () => {
    expect(syncWanted({})).toBe(false);
    expect(syncWanted({ LUNAR_SYNC: '0' })).toBe(false);
    expect(syncWanted({ LUNAR_SYNC: '1' })).toBe(true);
  });

  it('never runs in CI', () => {
    expect(syncWanted({ LUNAR_SYNC: '1', CI: 'true' })).toBe(false);
  });
});

describe('links on the main page', () => {
  const page = '<html><body><div id="app"></div></body></html>';
  const { handler } = learnPages().transformIndexHtml;

  it('are added only on the dev server with ?tools in the address', () => {
    expect(wantsTools({ server: {}, originalUrl: '/?tools' })).toBe(true);
    expect(wantsTools({ server: {}, originalUrl: '/' })).toBe(false);
    expect(wantsTools({ originalUrl: '/?tools' })).toBe(false); // a build has no server, and no /learn
    expect(handler(page, { path: '/index.html', server: {}, originalUrl: '/?tools' })).toContain('href="/learn"');
  });

  it('leave the demo page and the built page as they are', () => {
    expect(handler(page, { path: '/index.html', server: {}, originalUrl: '/' })).toBe(page);
    expect(handler(page, { path: '/index.html' })).toBe(page);
    expect(handler(page, { path: '/other.html', server: {}, originalUrl: '/other.html?tools' })).toBe(page);
  });
});

describe('requests', () => {
  function middleware() {
    let handler;
    learnPages().configureServer({ config: { logger: { info() {} } }, middlewares: { use: (fn) => (handler = fn) } });
    return handler;
  }

  it('passes on an address it cannot read instead of throwing', async () => {
    const next = vi.fn();
    await expect(middleware()({ url: '/%E0%A4%A', method: 'GET' }, {}, next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes on what is not its own', async () => {
    const next = vi.fn();
    await middleware()({ url: '/src/main.js', method: 'GET' }, {}, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('the built app on a local server (npm run preview)', () => {
  /** Every middleware the preview server is given, tried in order like the server does. */
  function middleware() {
    const chain = [];
    learnPages().configurePreviewServer({ middlewares: { use: (fn) => chain.push(fn) } });
    return async (req, res, next) => {
      for (const fn of chain) {
        let passed = false;
        await fn(req, res, () => (passed = true));
        if (!passed) return;
      }
      next();
    };
  }
  function reply() {
    const res = { headers: {}, setHeader: (k, v) => (res.headers[k] = v), end: (body) => (res.body = body) };
    return res;
  }

  it('gets the education page and the data it reads, from the one plugin', async () => {
    const page = reply();
    await middleware()({ url: '/learn', method: 'GET' }, page, vi.fn());
    expect(page.statusCode).toBe(200);
    expect(String(page.body)).toContain('/learn/learn.js');
    const sites = reply();
    await middleware()({ url: '/data/sites.json', method: 'GET' }, sites, vi.fn());
    expect(JSON.parse(String(sites.body)).sites.length).toBeGreaterThan(0);
  });

  it('passes on what is not its own', async () => {
    const next = vi.fn();
    await middleware()({ url: '/assets/index.js', method: 'GET' }, reply(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('the dev server', () => {
  it('leaves the app\'s data files to Vite, which serves them as modules', async () => {
    let handler;
    learnPages().configureServer({ config: { logger: { info() {} } }, middlewares: { use: (fn) => (handler = fn) } });
    const next = vi.fn();
    await handler({ url: '/data/missions.json?import', method: 'GET' }, {}, next);
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('the website build (npm run build:site)', () => {
  it('copies files that exist, to the addresses the education page asks for', () => {
    for (const [from, , optional] of LEARN_COPIES) {
      if (!optional) expect(existsSync(new URL(`../${from}`, import.meta.url)), from).toBe(true);
    }
    const to = LEARN_COPIES.map(([, address]) => address);
    for (const address of ['learn', 'vendor', 'lunar-game.js', 'data/sites.json', 'data/missions.json', 'textures/moon-hd.jpg']) {
      expect(to).toContain(address);
    }
  });
});
