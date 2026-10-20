/* Purchases (PRD-meetings US-12) through RevenueCat's Capacitor plugin,
   reached the way haptics and notifications are: the bridge-injected
   globalThis.Capacitor.Plugins.Purchases, no import (a bare import would
   blank the module build, see notify.js). On the web the plugin does not
   exist and available() is false, so Settings shows the Free variant
   (AC-12.8). The app user id is the subscriber id from S.plan, so the
   proxy's counters follow the purchase across devices (AC-12.4).

   Products: plus_monthly / pro_monthly / max_monthly in one offering,
   packages named plus / pro / max, entitlements plus / pro / max
   (architecture §20, §22). Prices come from the store through
   getOfferings(); PLAN_PRICES is the fallback for the web and for a store
   that has not answered. */

import { PLAN_TIERS } from './store.js';

/* RevenueCat public SDK keys: meant to ship in the client (they identify
   the app, they cannot read or charge anything). Filled in once the
   RevenueCat project exists (PRD §09 owner checklist). */
export const RC_KEYS = { ios: 'appl_REPLACE_ME', android: 'goog_REPLACE_ME' };
export const PAID_TIERS = ['plus', 'pro', 'max'];
export const PRODUCT_IDS = { plus: 'plus_monthly', pro: 'pro_monthly', max: 'max_monthly' };

const plugin = () => globalThis.Capacitor?.Plugins?.Purchases;
export const platform = () => globalThis.Capacitor?.getPlatform?.() || 'web';
/** Inside a shell with the plugin, and a key for this platform. */
export const available = () =>
  !!(globalThis.Capacitor?.isNativePlatform?.() && typeof plugin()?.configure === 'function' && RC_KEYS[platform()] && !RC_KEYS[platform()].includes('REPLACE_ME'));

let configured = false;
let offeringsCache = null;

/** Once per launch, after the store is loaded (app.js boot). Never throws. */
export async function configure(subscriberId) {
  if (!available() || configured) return false;
  try {
    await plugin().configure({ apiKey: RC_KEYS[platform()], appUserID: subscriberId });
    configured = true;
  } catch (e) {
    console.warn('purchases: configure failed', e?.message || e);
  }
  return configured;
}

/** { plus: { price: '€9.99', package }, … } for the tiers the store offers; {} when unavailable. */
export async function offerings({ force = false } = {}) {
  if (!configured) return {};
  if (offeringsCache && !force) return offeringsCache;
  try {
    const res = await plugin().getOfferings();
    const packages = res?.current?.availablePackages || [];
    const out = {};
    PAID_TIERS.forEach((tier) => {
      const pkg = packages.find((p) => p.identifier === tier || p.product?.identifier === PRODUCT_IDS[tier] || p.product?.identifier?.startsWith(`${tier}_`));
      if (pkg) out[tier] = { price: pkg.product?.priceString || '', package: pkg };
    });
    offeringsCache = out;
    return out;
  } catch (e) {
    console.warn('purchases: offerings failed', e?.message || e);
    return {};
  }
}

/** The highest active paid entitlement in a CustomerInfo, or 'free'. */
export function tierOf(customerInfo) {
  const active = customerInfo?.entitlements?.active || {};
  for (const tier of [...PAID_TIERS].reverse()) if (active[tier]) return tier;
  return 'free';
}

const cancelled = (e) => e?.userCancelled === true || String(e?.code) === '1' || /cancel/i.test(String(e?.message || ''));

/** The native purchase sheet. Resolves { tier } on success, { cancelled: true }
    when the user backed out; throws with a message otherwise. */
export async function buy(tier) {
  if (!PAID_TIERS.includes(tier) || !PLAN_TIERS.includes(tier)) throw new Error('Unknown plan');
  const offer = (await offerings())[tier];
  if (!offer) throw new Error('This plan is not available in the store right now.');
  try {
    const res = await plugin().purchasePackage({ aPackage: offer.package });
    return { tier: tierOf(res?.customerInfo), customerInfo: res?.customerInfo };
  } catch (e) {
    if (cancelled(e)) return { cancelled: true };
    throw new Error(e?.message || 'The purchase did not go through.');
  }
}

/** Restore through the store account (AC-12.4). */
export async function restore() {
  const res = await plugin().restorePurchases();
  return { tier: tierOf(res?.customerInfo), customerInfo: res?.customerInfo };
}

/** The store's subscription management page, or null. */
export async function manageUrl() {
  try {
    const res = await plugin().getCustomerInfo();
    return res?.customerInfo?.managementURL || null;
  } catch { return null; }
}
