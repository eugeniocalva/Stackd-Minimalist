/* `npm run bundle`: writes app.bundle.js, the classic-script copy of the app
   that index.html loads when opened from disk (file://). Run it after
   changing app.js or anything in src/; `npm run check` fails until the
   committed bundle matches the modules again. */
import { writeFileSync } from 'node:fs';
import { BUNDLE, bundleSource } from './bundle-lib.mjs';

const text = await bundleSource();
writeFileSync(BUNDLE, text);
console.log(`bundle: wrote app.bundle.js (${Math.round(text.length / 1024)} KB)`);
