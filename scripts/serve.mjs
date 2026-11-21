/* A small static server for checking the 1.6.0 move by hand (PRD-accounts
   US-12). Development only: nothing ships or deploys with it.

     node scripts/serve.mjs [dir] [--port 8126] [--headers] [--legacy]

   --headers  answers with the headers in <dir>/_headers, as Cloudflare
              does, so the Content-Security-Policy can be exercised
              locally. Build the site first: `npm run build -- --site`,
              then serve `www`.
   --legacy   serves src/legal.js with the hostname faked to the old
              github.io address, so the "Stack'd has moved" banner and
              Download my data can be seen on localhost. The file on disk
              is not touched.

   .claude/launch.json has both as "stackd-site" and "stackd-legacy". */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const port = Number(option('--port', 8126));
const root = resolve(args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port') || '.');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

/* the "/*" block of a Cloudflare _headers file, which is all this project uses */
function siteHeaders() {
  const file = join(root, '_headers');
  if (!existsSync(file)) { console.error(`serve: --headers needs ${file}`); process.exit(1); }
  const out = {};
  let on = false;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { on = line.trim() === '/*'; continue; }
    const i = line.indexOf(':');
    if (on && i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}
const extra = flag('--headers') ? siteHeaders() : {};

const LEGACY_FROM = "host = globalThis.location?.hostname || ''";
const LEGACY_TO = "host = 'eugeniocalva.github.io'";

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(join(root, path.endsWith('/') ? `${path}index.html` : path));
  if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    let body = await readFile(file);
    if (flag('--legacy') && path === '/src/legal.js') {
      const text = body.toString('utf8');
      if (!text.includes(LEGACY_FROM)) throw new Error('src/legal.js changed: update LEGACY_FROM in scripts/serve.mjs');
      body = Buffer.from(text.replace(LEGACY_FROM, LEGACY_TO));
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', ...extra });
    res.end(body);
  } catch (e) {
    const missing = e.code === 'ENOENT' || e.code === 'EISDIR';
    if (!missing) console.error(`serve: ${e.message}`);
    res.writeHead(missing ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8', ...extra }).end(missing ? 'Not found' : 'Server error');
  }
}).listen(port, 'localhost', () => {
  console.log(`serve: ${root} on http://localhost:${port}${flag('--headers') ? ' with _headers' : ''}${flag('--legacy') ? ' as the old github.io address' : ''}`);
});
