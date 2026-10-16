/* Verifies the service-worker precache list (SHELL in sw.js) against the
   files on disk. cache.addAll() rejects the whole install if one entry is
   missing or duplicated, and a file left out of SHELL is not available
   offline — both fail silently in the browser, so check them here. */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const sw = readFileSync('sw.js', 'utf8');
const block = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (!block) { console.error('check-shell: SHELL array not found in sw.js'); process.exit(1); }
const shell = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name).split('\\').join('/')]));
const app = ['src', 'styles', 'fonts', 'icons'].flatMap(walk).concat(['index.html', 'app.js', 'manifest.webmanifest']);

const notCached = app.filter((f) => !shell.includes(f));
const notOnDisk = shell.filter((f) => f !== './' && !existsSync(f));
const duplicated = shell.filter((f, i) => shell.indexOf(f) !== i);
const version = (sw.match(/const VERSION = '([^']+)'/) || [])[1];

const problems = [
  ...notCached.map((f) => `not precached: ${f}`),
  ...notOnDisk.map((f) => `listed but missing on disk: ${f}`),
  ...duplicated.map((f) => `listed twice: ${f}`),
];
if (problems.length) {
  console.error(`check-shell: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-shell: ${shell.length} entries match the app files (VERSION ${version})`);
