/* Who is asking and what plan they are on (architecture §20). Order:
   the tester allow-list (TESTERS variable), then RevenueCat's view of the
   subscriber (REST, cached in KV for five minutes, invalidated by the
   webhook), else free. The subscriber id is the app user id the app gave
   RevenueCat, so a purchase restored on another device carries the same
   pool. */

const PAID = ['plus', 'pro', 'max'];
const CACHE_TTL = 300;              // seconds
const RC_API = 'https://api.revenuecat.com/v1/subscribers/';

export function testers(env) {
  return String(env.TESTERS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const cacheKey = (subscriberId) => `rccache:${subscriberId}`;

/** RevenueCat's subscriber object → { tier, renewsAt }: the highest paid
    entitlement that is active (no expiry, or an expiry still ahead). */
export function fromSubscriber(sub, now = Date.now()) {
  const ents = sub?.entitlements || {};
  for (const tier of [...PAID].reverse()) {
    const e = ents[tier];
    if (!e) continue;
    const exp = e.expires_date ? Date.parse(e.expires_date) : null;
    if (exp === null || Number.isNaN(exp) || exp > now) return { tier, renewsAt: Number.isNaN(exp) ? null : exp };
  }
  return { tier: 'free', renewsAt: null };
}

async function lookup(env, subscriberId, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(RC_API + encodeURIComponent(subscriberId), {
    headers: { Authorization: `Bearer ${env.RC_SECRET_KEY}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`RevenueCat answered ${res.status}`);
  const body = await res.json();
  return fromSubscriber(body?.subscriber);
}

/** → { tier, renewsAt }. A RevenueCat failure falls back to the cached
    value when there is one, else to free (the app can retry). */
export async function resolve(env, subscriberId, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (testers(env).includes(subscriberId)) return { tier: 'tester', renewsAt: null };
  if (!env.RC_SECRET_KEY || !env.POOL) return { tier: 'free', renewsAt: null };
  const key = cacheKey(subscriberId);
  const cached = await env.POOL.get(key);
  if (cached) {
    try { const c = JSON.parse(cached); if (!c.renewsAt || c.renewsAt > now) return c; } catch { /* refetch */ }
  }
  try {
    const ent = await lookup(env, subscriberId, fetchImpl);
    await env.POOL.put(key, JSON.stringify(ent), { expirationTtl: CACHE_TTL });
    return ent;
  } catch (e) {
    console.error('entitlement', e?.message || e);
    return cached ? JSON.parse(cached) : { tier: 'free', renewsAt: null };
  }
}

/** POST /v1/rc-webhook: RevenueCat sends every event with the Authorization
    value configured in its dashboard (RC_WEBHOOK_AUTH). Any event for a
    subscriber drops that subscriber's cache, so the next call re-reads. */
export async function webhook(request, env) {
  if (!env.RC_WEBHOOK_AUTH || request.headers.get('Authorization') !== env.RC_WEBHOOK_AUTH) return { status: 401 };
  let body;
  try { body = await request.json(); } catch { return { status: 400 }; }
  const id = body?.event?.app_user_id || body?.event?.original_app_user_id;
  if (id && env.POOL) await env.POOL.delete(cacheKey(id));
  return { status: 204 };
}
