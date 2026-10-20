/* Per-subscriber usage counters in KV (architecture §20). Keys
   `pool:<subscriber>:<period>` hold { audioSeconds, summaries } used so
   far. Reservation happens before a provider call, release after a failed
   one; KV is eventually consistent and not transactional, so a race on the
   last unit can overspend by one. Accepted (README). */

import { TIERS } from './plans.js';

const TTL = 45 * 86400;   // a period and a half, then the key may go

export const poolKey = (subscriberId, periodKey) => `pool:${subscriberId}:${periodKey}`;

export async function getUsed(kv, subscriberId, periodKey) {
  const raw = await kv.get(poolKey(subscriberId, periodKey));
  const v = raw ? JSON.parse(raw) : {};
  return { audioSeconds: v.audioSeconds || 0, summaries: v.summaries || 0 };
}

async function put(kv, subscriberId, periodKey, used) {
  await kv.put(poolKey(subscriberId, periodKey), JSON.stringify(used), { expirationTtl: TTL });
}

/** Add `want` to the counters if the tier's limits allow it.
    Returns { ok, used } where `used` is the state after the call. */
export async function reserve(kv, subscriberId, periodKey, tier, want) {
  const limits = TIERS[tier] || TIERS.free;
  const used = await getUsed(kv, subscriberId, periodKey);
  const next = { audioSeconds: used.audioSeconds + (want.audioSeconds || 0), summaries: used.summaries + (want.summaries || 0) };
  if (next.audioSeconds > limits.audioSeconds || next.summaries > limits.summaries) return { ok: false, used };
  await put(kv, subscriberId, periodKey, next);
  return { ok: true, used: next };
}

/** Give back a reservation after a failed step (never below zero). */
export async function release(kv, subscriberId, periodKey, amount) {
  const used = await getUsed(kv, subscriberId, periodKey);
  const next = {
    audioSeconds: Math.max(0, used.audioSeconds - (amount.audioSeconds || 0)),
    summaries: Math.max(0, used.summaries - (amount.summaries || 0)),
  };
  await put(kv, subscriberId, periodKey, next);
  return next;
}
