/* Copies the web app into www/ — the clean asset root Capacitor wraps.
   Source files stay at the repo root so GitHub Pages keeps serving them
   directly; www/ is generated and git-ignored.

   `npm run build -- --site` builds the same tree for the web host
   (https://app.stackdplatform.com, architecture §30): it adds the legal
   pages and _headers, which the phone apps do not ship. */
import { rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';

const SITE = process.argv.includes('--site');

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
/* web host only */
const SITE_ASSETS = ['privacy.html', 'terms.html', 'account-deletion.html', '_headers'];
const SITE_OPTIONAL = [];

const wanted = SITE ? [...ASSETS, ...SITE_ASSETS, ...SITE_OPTIONAL.filter(existsSync)] : ASSETS;

rmSync('www', { recursive: true, force: true });
mkdirSync('www', { recursive: true });

for (const a of wanted) {
  if (!existsSync(a)) {
    console.error(`build-www: missing asset "${a}"`);
    process.exit(1);
  }
  cpSync(a, `www/${a}`, { recursive: true });
}

console.log(`build-www: copied ${wanted.length} entries into www/${SITE ? ' (site: legal pages and _headers included)' : ''}`);
