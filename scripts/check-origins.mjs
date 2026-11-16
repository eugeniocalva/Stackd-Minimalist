/* No third-party requests (PRD-accounts AC-11.6, architecture §37) —
   `npm run check`.

   Every URL written in the app shell (index.html, the legal pages, the
   manifest, styles/, src/, app.js, sw.js, _headers) must be on the
   allow-list below: the app's own address, the proxy, the store pages
   where a subscription is managed, XML namespaces and the local addresses
   used in development. Anything else fails: a font, a script, an image or
   an analytics call from another company's server.

   The phone apps receive no response headers, so for them this list is the
   only guard; on the web the Content-Security-Policy in _headers enforces
   the same thing in the browser. The script also keeps the pieces of the
   move in step (the CSP, the proxy's origin list, the legal versions) and
   fails on a string shaped like a provider key anywhere in the tracked
   code, because the repository is public. */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ORIGIN, TERMS_URL, PRIVACY_URL, DELETION_URL, TERMS_VERSION, PRIVACY_VERSION, isLegacyOrigin } from '../src/legal.js';

const read = (f) => readFileSync(f, 'utf8');
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.name !== 'node_modules')
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name).split('\\').join('/')]));
const TEXT = /\.(?:html|css|js|mjs|cjs|json|webmanifest|toml|yml|yaml|svg|txt|md)$|(?:^|\/)_headers$/;
const present = (files) => files.filter((f) => existsSync(f) && statSync(f).isFile() && TEXT.test(f));

const problems = [];
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/* ── 1. Origins in the shell ─────────────────────────────────────────── */

const PROXY_URL = (read('src/store.js').match(/^export const PROXY_URL = '([^']+)';/m) || [])[1];
if (!PROXY_URL) problems.push('src/store.js: PROXY_URL not found');

/* exact origins: anything under them is the app's own */
const OWN = [APP_ORIGIN, PROXY_URL].filter(Boolean);
/* exact prefixes outside the app: pages a person is sent to, never fetched */
const PAGES = [
  'https://apps.apple.com/account/subscriptions',
  'https://play.google.com/store/account/subscriptions',
];
/* identifiers, not addresses: nothing is requested from them */
const NAMESPACES = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/XML/1998/namespace',
];
/* development only: the Developer proxy override and its hint text */
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/;

const under = (url, base) => url === base || url.startsWith(`${base}/`) || url.startsWith(`${base}?`) || url.startsWith(`${base}#`);
const allowed = (url) => OWN.some((o) => under(url, o)) || PAGES.some((p) => under(url, p))
  || NAMESPACES.includes(url) || LOCAL.test(url);

const SHELL_FILES = present([
  'index.html', 'privacy.html', 'terms.html', 'account-deletion.html', 'manifest.webmanifest',
  'app.js', 'sw.js', '_headers', ...walk('src'), ...walk('styles'),
]);
/* a scheme and a host, or a protocol-relative reference right after a quote, "(" or "=" */
const URLS = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>)\\]+|(?<=["'`(=]\s*)\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+[^\s"'`<>)\\]*/gi;
const trim = (u) => u.replace(/[.,;:!?]+$/, '').replace(/%3C.*$/i, '');   // sentence punctuation; a data: URI's own markup

let urls = 0;
for (const file of SHELL_FILES) {
  const text = read(file);
  for (const m of text.matchAll(URLS)) {
    const url = trim(m[0]);
    urls += 1;
    if (!allowed(url)) problems.push(`${file}:${lineOf(text, m.index)}: ${url} is not on the origin allow-list`);
  }
}

/* ── 2. The pieces of the move agree ─────────────────────────────────── */

for (const [name, url] of Object.entries({ TERMS_URL, PRIVACY_URL, DELETION_URL })) {
  if (!under(url, APP_ORIGIN)) problems.push(`src/legal.js: ${name} is not under APP_ORIGIN`);
}
const cases = { 'eugeniocalva.github.io': true, 'GitHub.io': true, [new URL(APP_ORIGIN).hostname]: false, localhost: false, '': false, 'github.io.example.com': false, 'notgithub.io': false };
for (const [host, want] of Object.entries(cases)) {
  if (isLegacyOrigin(host) !== want) problems.push(`src/legal.js: isLegacyOrigin('${host}') should be ${want}`);
}

/* the versions are the effective dates printed on the pages */
for (const [page, version] of [['terms.html', TERMS_VERSION], ['privacy.html', PRIVACY_VERSION]]) {
  const printed = (read(page).match(/effective (\d{4}-\d{2}-\d{2})/) || [])[1];
  if (printed !== version) problems.push(`${page}: effective date ${printed} does not match src/legal.js (${version})`);
}

/* the legal pages carry [OWNER: …] where the owner's own details go; no
   release (a VERSION past 1.5) may ship them (PRD-accounts §09) */
{
  const version = (read('sw.js').match(/const VERSION = 'stackd-v(\d+)\.(\d+)/) || []).slice(1).map(Number);
  const releasing = version.length === 2 && (version[0] > 1 || version[1] >= 6);
  for (const page of present(['privacy.html', 'terms.html', 'account-deletion.html'])) {
    const n = (read(page).match(/\[OWNER:/g) || []).length;
    if (n && releasing) problems.push(`${page}: ${n} [OWNER: …] placeholder(s) left; fill them before the release`);
    else if (n) console.log(`check-origins: ${page} has ${n} [OWNER: …] placeholder(s) to fill before 1.6.0`);
  }
}

/* _headers: the policy of §30, with the proxy as the only outside origin */
const headers = read('_headers');
const csp = (headers.match(/^\s*Content-Security-Policy:\s*(.+)$/m) || [])[1] || '';
const directive = (name) => (csp.split(';').map((d) => d.trim().split(/\s+/)).find((d) => d[0] === name) || []).slice(1);
const want = {
  'default-src': ["'self'"], 'script-src': ["'self'"], 'connect-src': ["'self'", PROXY_URL],
  'frame-ancestors': ["'none'"], 'base-uri': ["'none'"], 'form-action': ["'none'"], 'object-src': ["'none'"],
};
for (const [name, value] of Object.entries(want)) {
  if (directive(name).join(' ') !== value.join(' ')) problems.push(`_headers: ${name} should be ${value.join(' ')}, found "${directive(name).join(' ')}"`);
}
for (const h of ['Referrer-Policy: no-referrer', 'X-Content-Type-Options: nosniff', 'Strict-Transport-Security: max-age=']) {
  if (!headers.includes(h)) problems.push(`_headers: missing ${h}`);
}

/* script-src 'self' only holds while the pages carry no inline script */
for (const page of present(['index.html', 'privacy.html', 'terms.html', 'account-deletion.html'])) {
  const html = read(page);
  if (/<script\b(?![^>]*\bsrc\s*=)/i.test(html)) problems.push(`${page}: inline <script> (the Content-Security-Policy would block it)`);
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) problems.push(`${page}: inline event handler (the Content-Security-Policy would block it)`);
}

/* the proxy answers the new address */
const allowedOrigins = ((read('proxy/wrangler.toml').match(/^ALLOWED_ORIGINS = "([^"]*)"/m) || [])[1] || '').split(',');
if (!allowedOrigins.includes(APP_ORIGIN)) problems.push(`proxy/wrangler.toml: ALLOWED_ORIGINS does not include ${APP_ORIGIN}`);

/* ── 3. Nothing shaped like a provider key ───────────────────────────── */

const KEYS = [
  ['Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['secret key (sk-…)', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['secret key (sk_…)', /\b[sr]k_(?:live_|test_)?[A-Za-z0-9]{20,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['mail provider key', /\b(?:re_[A-Za-z0-9_]{20,}|SG\.[\w-]{16,}\.[\w-]{16,}|key-[0-9a-f]{32})\b/],
  ['signed token (JWT)', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}/],
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const KEY_FILES = present([
  ...SHELL_FILES, 'capacitor.config.json', 'package.json', 'proxy/wrangler.toml', 'proxy/package.json',
  ...walk('scripts'), ...walk('proxy/src'), ...walk('proxy/test'), ...walk('.github/workflows'),
]);
for (const file of new Set(KEY_FILES)) {
  const text = read(file);
  for (const [what, re] of KEYS) {
    const m = text.match(re);
    if (m) problems.push(`${file}:${lineOf(text, m.index)}: looks like a provider key (${what})`);
  }
}

if (problems.length) {
  console.error(`check-origins: ${problems.length} problem(s)\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-origins: ${urls} URLs in ${SHELL_FILES.length} shell files are on the allow-list; headers, versions and proxy origins agree; no key-shaped strings in ${new Set(KEY_FILES).size} files`);
