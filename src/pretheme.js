/* Classic script, loaded in <head> before the stylesheets: applies the saved
   theme (Settings → Appearance) before the first paint; src/theme.js keeps
   it in step afterwards. A file rather than an inline script so the web
   host can send `script-src 'self'` (architecture §30). */
(function () {
  var t;
  try { t = (JSON.parse(localStorage.getItem('stackd-v2')) || {}).theme; } catch (e) {}
  if (t !== 'light' && t !== 'dark') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
})();
