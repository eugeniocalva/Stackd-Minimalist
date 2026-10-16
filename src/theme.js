/* Theme preference (S.theme: 'light' | 'dark' | 'system'). index.html applies
   the saved one before the first paint; app.js calls applyTheme() on every
   render and re-renders when the system theme changes. */

import { S } from './store.js';

export const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export const resolvedTheme = () =>
  S.theme === 'light' || S.theme === 'dark' ? S.theme : systemDark.matches ? 'dark' : 'light';

export function applyTheme() {
  const theme = resolvedTheme();
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.content = theme === 'dark' ? '#0b0f19' : '#f4f7f9';
  });
}
