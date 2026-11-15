// Puts the education page (education/) into the website build, at /learn, with the files it loads from elsewhere
// in the project. Runs after `vite build` (npm run build:site). Works on Windows too (no rm or cp).
//
// A build has no server, so on the hosted website the education page has its pages, the 3D lab, the facts,
// topics, guide and games, but nothing that asks a server: Sun and Earth in a site's sky (/api/site), Diviner
// temperatures (/api/diviner), the NASA EPIC and SDO pictures, the JPL Horizons check, the leaderboard and the
// Explorer (/classic). Those need `npm run dev` or `npm run preview` (server/learn-plugin.mjs answers them).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What goes where: [file or folder in the project, address in the build]. The addresses are the ones the page
 * asks for (education/index.html, education/*.js), the same ones server/learn-plugin.mjs answers on the dev server.
 * `optional` files are made by a script and may not be there; the page copes without them.
 */
export const LEARN_COPIES = [
  ['education', 'learn'],
  ['lunar-planner/public/vendor', 'vendor'],
  ['lunar-planner/public/lunar-game.js', 'lunar-game.js'],
  ['data/sites.json', 'data/sites.json'],
  ['data/missions.json', 'data/missions.json'],
  ['public/textures/moon_lroc_color_4k.jpg', 'textures/moon-hd.jpg'],
  ['lunar-planner/public/textures/moon-elevation.json', 'textures/moon-elevation.json'],
  ['lunar-planner/public/textures/moon-elevation.png', 'textures/moon-elevation.png'],
  ['lunar-planner/public/textures/moon-elevation-grid.bin', 'textures/moon-elevation-grid.bin', 'optional'],
];

export function copyLearn(root = ROOT, out = join(root, 'dist')) {
  rmSync(join(out, 'learn'), { recursive: true, force: true });
  for (const [from, to, optional] of LEARN_COPIES) {
    const source = join(root, from);
    if (!existsSync(source)) {
      if (optional) continue;
      throw new Error(`The education page needs ${from}, which is not there.`);
    }
    mkdirSync(dirname(join(out, to)), { recursive: true });
    cpSync(source, join(out, to), { recursive: true });
  }
  // The page asks for this script, which reloads it after a pull on the dev server. A build never changes.
  writeFileSync(join(out, 'live-sync.js'), '// Live sync is for the dev server only (server/learn-plugin.mjs).\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  copyLearn();
  console.log('Education page copied to dist/learn (pages, 3D lab and games; live data needs npm run dev).');
}
