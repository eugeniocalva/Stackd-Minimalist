/* The store's age signal (docs/prd-age-signals.md): Google Play Age Signals
   on Android, Apple's Declared Age Range on iOS, through
   @capawesome/capacitor-age-signals. On the web there is no store, and
   nothing here does anything.

   The answer is kept in memory for this run of the app and never leaves the
   phone: not to our server, not to local storage, not to a log (AC-02).
   What it decides:
   - creating an account: a store-reported adult skips the birth year, a
     minor is refused (§04, 2);
   - buying a plan: a minor is not offered Buy (§04, 3);
   - a minor whose parent has not approved the app (Play: the latest
     significant change pending or declined) sees only the approval screen
     until the store says approved (§04, 4).

   read() is pure, so scripts/check-age.mjs checks it without a store. */

export const ADULT = 18;

const plugin = () => {
  const cap = globalThis.Capacitor;
  return cap?.isNativePlatform?.() ? cap.Plugins?.AgeSignals || null : null;
};
const platform = () => globalThis.Capacitor?.getPlatform?.() || 'web';

/** The plugin's result → { age: 'adult' | 'minor', waiting } or null when the
    store has not told us (not shared, verification required in the Play
    Store, a range that straddles 18). */
export function read(r) {
  if (!r || (r.status && r.status !== 'SHARED') || !r.ageRange) return null;
  const { lowerBound: lo, upperBound: hi } = r.ageRange;
  const age = Number.isFinite(lo) && lo >= ADULT ? 'adult'
    : Number.isFinite(hi) && hi < ADULT ? 'minor'
    : null;
  if (!age) return null;
  const sc = r.significantChange?.status;
  return { age, waiting: age === 'minor' && (sc === 'PENDING' || sc === 'DECLINED') };
}

let answer;              // undefined: not asked yet; null: asked, no answer
let fake;                // set by useFake() only (the preview, the checks)
const listeners = new Set();

const set = (next) => {
  const was = JSON.stringify(answer ?? null);
  answer = next;
  if (JSON.stringify(next) !== was) listeners.forEach((fn) => fn(next));
  return next;
};

/** The last answer, without asking: null when there is none. */
export const current = () => answer ?? null;
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** At launch and when the app comes back (California AB 1043: on download
    and launch). Never a prompt: Android reads what Play already shares;
    iOS asks only where Apple says the law applies, where the system shares
    without a prompt. */
export async function check() {
  if (fake !== undefined) return set(fake);
  const p = plugin();
  if (!p) return set(null);
  try {
    if (platform() === 'android') return set(read(await p.getAgeRange()));
    const req = await p.getRegulatoryRequirements().catch(() => null);
    if (!req?.ageAssuranceRequired) return set(answer ?? null);
    return set(read(await p.requestAgeRange({ ageGates: [ADULT] })));
  } catch { return set(answer ?? null); }
}

/** When the app needs the answer (creating an account, buying a plan): may
    show the store's prompt once; the store remembers the user's choice. */
export async function ask() {
  if (fake !== undefined) return set(fake);
  if (answer) return answer;
  const p = plugin();
  if (!p) return set(null);
  try {
    return set(read(await p.requestAgeRange({ ageGates: [ADULT] })));
  } catch { return set(null); }
}

/** The store says a minor: no account, no Buy. */
export const isMinor = () => current()?.age === 'minor';
/** The store says a minor whose parent has not approved the app yet. */
export const waiting = () => current()?.waiting === true;

/** Tests and the preview only: an answer as the store would give it, or
    undefined to go back to the store. Nothing in the app calls it. */
export function useFake(r) { fake = r === undefined ? undefined : read(r); answer = undefined; }
