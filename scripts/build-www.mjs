/* Copies the web app into www/ — the clean asset root Capacitor wraps.
   Source files stay at the repo root so GitHub Pages keeps serving them
   directly; www/ is generated and git-ignored. */
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';

const ASSETS = [
  'index.html',
  'app.js',
  'src',
  'styles',
  'fonts',
  'manifest.webmanifest',
  'sw.js',
  'icons',
];

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });

for (const a of ASSETS) {
  if (!existsSync(a)) {
    console.error(`build-www: missing asset "${a}"`);
    process.exit(1);
  }
  cpSync(a, `www/${a}`, { recursive: true });
}

console.log(`build-www: copied ${ASSETS.length} entries into www/`);
