/* Fails `npm run check` when app.bundle.js no longer matches app.js and src/:
   a stale bundle would make a double-clicked index.html run old code.
   Nothing runs this automatically (no CI step): run `npm run check` before
   committing. */
import { existsSync, readFileSync } from 'node:fs';

let lib;
try {
  lib = await import('./bundle-lib.mjs');
} catch (e) {
  if (e.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('check-bundle: esbuild is not installed. Run `npm install` first.');
    process.exit(1);
  }
  throw e;
}

const fresh = await lib.bundleSource();
const committed = existsSync(lib.BUNDLE) ? readFileSync(lib.BUNDLE, 'utf8').replace(/\r\n/g, '\n') : null;

if (committed === null) {
  console.error('check-bundle: app.bundle.js is missing. Run `npm run bundle` and commit it.');
  process.exit(1);
}
if (committed !== fresh) {
  console.error('check-bundle: app.bundle.js is out of date with app.js / src. Run `npm run bundle` and commit it.');
  process.exit(1);
}
console.log(`check-bundle: app.bundle.js matches the modules (${Math.round(fresh.length / 1024)} KB)`);
