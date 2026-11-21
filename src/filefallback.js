/* Classic script, loaded at the end of <body> after the module entry. A
   file rather than an inline script so the web host can send
   `script-src 'self'` (architecture §30).

   Opened straight from disk (file://)? Most browsers refuse ES modules
   there, so app.js never runs. Deferred module scripts always start before
   DOMContentLoaded, and the first module (src/boot.js) marks the page, so
   if the mark is missing by then, load the same app bundled as one classic
   script (app.bundle.js, built by `npm run bundle`). Exactly one copy runs:
   where modules do load (http, the iOS app, Firefox from disk) the mark is
   set, even if a later module fails, and the bundle is never fetched. */
if (location.protocol === 'file:') {
  addEventListener('DOMContentLoaded', function () {
    if (document.documentElement.dataset.stackdBoot) return;
    var s = document.createElement('script');
    s.src = 'app.bundle.js';
    s.onerror = function () {
      document.getElementById('app').innerHTML =
        '<p style="padding:24px;font:16px/1.5 system-ui,sans-serif;max-width:36em">' +
        "Stack'd can't start from this folder: app.bundle.js is missing. " +
        'Run <code>npm run bundle</code>, or open the app through a web server ' +
        '(start-stackd.cmd on Windows).</p>';
    };
    document.body.appendChild(s);
  });
}

/* Service worker: web build over http(s) only. Inside the Capacitor shell
   the assets are already local and a stale cache would outlive an app
   update; from file:// there is no origin to register it for. */
var isNative = location.protocol === 'capacitor:' ||
  !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if ('serviceWorker' in navigator && !isNative && /^https?:$/.test(location.protocol)) {
  addEventListener('load', function () { navigator.serviceWorker.register('sw.js'); });
}
