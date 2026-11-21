/* Theme preference (S.theme: 'light' | 'dark' | 'system'). index.html applies
   the saved one before the first paint; app.js calls applyTheme() on every
   render and re-renders when the system theme changes. */

import { S } from './store.js';

export const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

export const resolvedTheme = () =>
  S.theme === 'light' || S.theme === 'dark' ? S.theme : systemDark.matches ? 'dark' : 'light';

let toldNative = '';

export function applyTheme() {
  const theme = resolvedTheme();
  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
      m.content = theme === 'dark' ? '#0b0f19' : '#f4f7f9';
    });
  }
  /* The iOS app in the app's theme, not the phone's (owner's review of
     build 10 and of build 11). Not behind the check above: pretheme.js has
     already set data-theme when this first runs.
     - The keyboard's style, through the Keyboard plugin.
     - The setting itself, to the native window: a message handler the iOS
       workflow adds to AppDelegate.swift, which reads data-theme-setting if
       it starts listening late. The window takes the app's light or dark,
       so the space around the keyboard matches the page. 'system' is sent
       as such: forcing the resolved theme on the window would also fix the
       web view's prefers-color-scheme, and the app could no longer follow
       the phone.
     All of it is a no-op on the web and on Android. */
  const setting = S.theme === 'light' || S.theme === 'dark' ? S.theme : 'system';
  if (toldNative === `${setting}/${theme}`) return;
  toldNative = `${setting}/${theme}`;
  document.documentElement.dataset.themeSetting = setting;
  globalThis.webkit?.messageHandlers?.stackdTheme?.postMessage(setting);
  globalThis.Capacitor?.Plugins?.Keyboard?.setStyle?.({ style: theme === 'dark' ? 'DARK' : 'LIGHT' })?.catch?.(() => {});
}
