/* Stack'd service worker — offline-first app shell.
   Bump VERSION whenever app files change so installed clients pick them up. */
const VERSION = 'stackd-v1.3.0';

const SHELL = [
  './',
  'index.html',
  'app.js',
  'src/boot.js',
  'src/util.js',
  'src/dates.js',
  'src/store.js',
  'src/reminders.js',
  'src/notify.js',
  'src/theme.js',
  'src/richtext.js',
  'src/search.js',
  'src/ui/search.js',
  'src/ui/shell.js',
  'src/ui/notes.js',
  'src/ui/noteeditor.js',
  'src/ui/notedetail.js',
  'src/ui/board.js',
  'src/ui/detail.js',
  'src/ui/addsheet.js',
  'src/ui/icons.js',
  'src/ui/primitives.js',
  'src/ui/actions.js',
  'src/ui/folders.js',
  'src/ui/movecopy.js',
  'src/ui/tagpicker.js',
  'src/ui/schedule.js',
  'src/ui/settings.js',
  'styles/fonts.css',
  'styles/variables.css',
  'styles/base.css',
  'styles/components.css',
  'styles/screens.css',
  'fonts/inter-latin.woff2',
  'fonts/inter-latin-ext.woff2',
  'fonts/manrope-latin.woff2',
  'fonts/manrope-latin-ext.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Same-origin: stale-while-revalidate — instant (and offline)
   from cache, refreshed in the background for the next load. */
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const cacheable =
    url.origin === location.origin;
  if (!cacheable) return;

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request);
      const network = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200) cache.put(e.request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

/* Reminder tapped (PRD US-10): focus an open Stack'd window and ask it to
   show the task, or open the app at #task=<id>. URLs resolve against the
   registration scope because Pages serves the app from a sub-path; a hash
   (not a query) keeps the precached './' entry usable offline. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const data = e.notification.data || {};
  const id = data.taskId || (e.notification.tag.match(/^reminder:([^:]+):/) || [])[1];
  const url = new URL(id ? `./#task=${id}` : './', self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    /* same origin is not enough: other Pages sites share it */
    const win = wins.find((w) => w.url.startsWith(self.registration.scope));
    if (win) {
      try { await win.focus(); } catch { /* focus may be refused; still deliver the message */ }
      if (id) win.postMessage({ type: 'open-task', id });
      return;
    }
    await self.clients.openWindow(url);
  })());
});
