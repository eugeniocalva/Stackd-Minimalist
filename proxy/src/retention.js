/* The daily clean-up (architecture §30, "Retention"): expired codes and
   tickets, sessions idle for 90 days, tombstones older than 90 days, rate
   windows older than a day. Logs counts only. */

import { IDLE_MS } from './auth/sessions.js';

const DAY = 86400_000;

export async function retention(env, now = Date.now()) {
  if (!env.DB) return null;
  const res = await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?1 AND (ticket_expires_at IS NULL OR ticket_expires_at < ?1)').bind(now),
    env.DB.prepare('DELETE FROM sessions WHERE last_seen_at < ?').bind(now - IDLE_MS),
    env.DB.prepare('DELETE FROM records WHERE deleted = 1 AND changed_at < ?').bind(now - 90 * DAY),
    env.DB.prepare('DELETE FROM rate WHERE window_start < ?').bind(now - DAY),
  ]);
  const [codes, sessions, tombstones, rate] = res.map((r) => r.meta?.changes ?? 0);
  console.log('retention', JSON.stringify({ codes, sessions, tombstones, rate }));
  return { codes, sessions, tombstones, rate };
}
