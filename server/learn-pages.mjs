// The education pages (education/) are written to live at /learn/. The dev server serves them there; the
// website build copies them there (npm run build:site).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };

export function learnPages({ root = process.cwd() } = {}) {
  const dir = path.join(root, 'education');
  const handle = (req, res, next) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(dir, rel.endsWith('/') ? `${rel}index.html` : rel);
    if (!file.startsWith(dir) || !existsSync(file)) return next();
    res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
    res.end(readFileSync(file));
  };
  return {
    name: 'learn-pages',
    configureServer: (server) => void server.middlewares.use('/learn', handle),
    configurePreviewServer: (server) => void server.middlewares.use('/learn', handle),
  };
}
