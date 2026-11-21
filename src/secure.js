/* Protected storage in the shells (PRD-accounts AC-04.6): the session
   token and the lock's PIN verifier go to the Keychain / Keystore, reached
   through the bridge like every other plugin (no import, so the module
   build keeps loading on the web).

   The plugin is not chosen yet: it must support Capacitor 8 and expose
   get({ key }) → { value }, set({ key, value }) and remove({ key }) under
   Capacitor.Plugins.SecureStorage (or be wrapped to). Until it is in both
   shells, available() is false there and the app offers no sign-in in the
   shells rather than keep a token in plain storage. The web needs none of
   this: its session is a cookie the page cannot read. */

const plugin = () => globalThis.Capacitor?.Plugins?.SecureStorage;
const native = () => !!globalThis.Capacitor?.isNativePlatform?.();

export const needed = () => native();
export const available = () => native() && ['get', 'set', 'remove'].every((f) => typeof plugin()?.[f] === 'function');

export async function get(key) {
  if (!available()) return null;
  try { return (await plugin().get({ key }))?.value ?? null; } catch { return null; }
}
export async function set(key, value) {
  if (!available()) return false;
  await plugin().set({ key, value: String(value) });
  return true;
}
export async function remove(key) {
  if (!available()) return;
  try { await plugin().remove({ key }); } catch { /* already gone */ }
}
