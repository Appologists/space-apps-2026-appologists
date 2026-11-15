import { defineConfig } from 'vitest/config';
import { terrainApi } from './server/terrain-plugin.mjs';
import { learnPages } from './server/learn-plugin.mjs';

// JPL Horizons does not send CORS headers, so a browser cannot call it directly.
// The dev server forwards /api/horizons to it instead. This only exists while `npm run dev`
// (or `npm run preview`) is running, which is fine for an app that runs locally.
const horizonsProxy = {
  '/api/horizons': {
    target: 'https://ssd.jpl.nasa.gov',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/horizons/, '/api/horizons.api'),
  },
};

export default defineConfig({
  // learnPages: the education page at /learn (education/), its data, and live sync (server/learn-plugin.mjs).
  plugins: [terrainApi(), learnPages()],
  server: { proxy: horizonsProxy },
  preview: { proxy: horizonsProxy },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
