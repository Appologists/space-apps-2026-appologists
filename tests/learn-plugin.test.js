// The dev-server plugin for the education page: what it must not do to the main app.
import { describe, expect, it, vi } from 'vitest';
import { learnPages, syncWanted, wantsTools } from '../server/learn-plugin.mjs';

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
