/* The first module app.js imports. It marks that the ES module graph started
   evaluating, so index.html's file:// fallback never loads app.bundle.js on
   top of it, even if a later module throws before the first render. */
document.documentElement.dataset.stackdBoot = 'started';
