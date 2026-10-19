/* Haptic feedback for gestures that commit something (long-press delete).
   Native: @capacitor/haptics through the bridge-injected plugin, as notify.js
   does for LocalNotifications (iOS has no web vibration API). Web: Android
   browsers expose navigator.vibrate; everywhere else this is a no-op. */

const plugin = () => globalThis.Capacitor?.Plugins?.Haptics;

/** style: 'LIGHT' | 'MEDIUM' | 'HEAVY' (ImpactStyle). Fire-and-forget. */
export function buzz(style = 'MEDIUM') {
  const h = plugin();
  if (typeof h?.impact === 'function') { Promise.resolve(h.impact({ style })).catch(() => {}); return; }
  try { navigator.vibrate?.(style === 'HEAVY' ? 40 : style === 'LIGHT' ? 10 : 20); } catch {}
}
