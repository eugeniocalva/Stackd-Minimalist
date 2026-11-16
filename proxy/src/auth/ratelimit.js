/* Fixed-window counters in the `rate` table (architecture §29). One
   statement per hit: the row is created, restarted when its window has
   passed, or counted up, and the new count comes back. */

export async function hit(env, key, { limit, windowMs, now }) {
  const row = await env.DB.prepare(`
    INSERT INTO rate (key, window_start, count) VALUES (?1, ?2, 1)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate.window_start <= ?2 - ?3 THEN 1 ELSE rate.count + 1 END,
      window_start = CASE WHEN rate.window_start <= ?2 - ?3 THEN ?2 ELSE rate.window_start END
    RETURNING count, window_start`).bind(key, now, windowMs).first();
  if (row.count <= limit) return { ok: true };
  return { ok: false, retryAfter: Math.max(1, Math.ceil((row.window_start + windowMs - now) / 1000)) };
}

export const HOUR = 3600_000;
export const LIMITS = {
  codePerEmail: 5,       // AC-02.9
  codePerAddress: 20,
  verifyPerAddress: 30,
  syncPerUser: 600,      // a sync every 6 s for an hour is far beyond any real device
};
