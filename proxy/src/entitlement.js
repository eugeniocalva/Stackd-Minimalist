/* Who is asking and what plan they are on (architecture §20). Phase 16:
   a stub, with the tester allow-list from the TESTERS variable; Phase 18
   adds the RevenueCat lookup, its KV cache and the webhook. */

export function testers(env) {
  return String(env.TESTERS || '').split(',').map((s) => s.trim()).filter(Boolean);
}

/** → { tier, renewsAt } */
export async function resolve(env, subscriberId) {
  if (testers(env).includes(subscriberId)) return { tier: 'tester', renewsAt: null };
  return { tier: 'free', renewsAt: null };
}
