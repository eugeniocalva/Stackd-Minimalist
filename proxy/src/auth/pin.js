/* The account PIN (PRD-accounts US-03; architecture §30). Four digits,
   never stored readable: PBKDF2 over an HMAC with a Worker-only pepper, so
   the database alone cannot be searched through the 10 000 values. Five
   wrong PINs in a row lock it for every device until a reset. */

import { hmac, pbkdf2, randomBytes, hex, safeEqual } from './crypto.js';

export const MAX_FAILS = 5;

/** 'ok', 'pin_weak' (four of a kind, a straight run) or 'bad_request'. */
export function validPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) return 'bad_request';
  const d = [...pin].map(Number);
  const steps = d.slice(1).map((x, i) => x - d[i]);
  if (steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1)) return 'pin_weak';
  return 'ok';
}

async function derive(env, userId, pin, salt) {
  return pbkdf2(await hmac(env.PIN_PEPPER, `${userId}:${pin}`), salt);
}

/** A fresh salt and hash for this user and PIN. */
export async function hashPin(env, userId, pin) {
  const salt = hex(randomBytes(16));
  return { salt, hash: await derive(env, userId, pin, salt) };
}

/** user: the users row. A locked PIN accepts no PIN at all, right or wrong;
    the fail count only resets on a correct PIN (or a reset elsewhere). */
export async function checkPin(env, user, pin) {
  if (user.pin_locked) return { ok: false, code: 'pin_locked', left: 0 };
  if (validPin(pin) === 'bad_request') return { ok: false, code: 'pin_wrong', left: Math.max(0, MAX_FAILS - user.pin_fails) };
  const ok = safeEqual(await derive(env, user.id, pin, user.pin_salt), user.pin_hash);
  if (ok) {
    if (user.pin_fails) await env.DB.prepare('UPDATE users SET pin_fails = 0 WHERE id = ?').bind(user.id).run();
    return { ok: true };
  }
  /* counted in the database, so the five are shared by every device and survive a restart */
  const row = await env.DB.prepare(`
    UPDATE users SET pin_fails = pin_fails + 1, pin_locked = CASE WHEN pin_fails + 1 >= ?2 THEN 1 ELSE 0 END
    WHERE id = ?1 RETURNING pin_fails, pin_locked`).bind(user.id, MAX_FAILS).first();
  return row.pin_locked
    ? { ok: false, code: 'pin_locked', left: 0 }
    : { ok: false, code: 'pin_wrong', left: MAX_FAILS - row.pin_fails };
}

/** Change and reset: a new hash, the next version, the lock and count cleared. Returns the new version. */
export async function setPin(env, userId, pin) {
  const { salt, hash } = await hashPin(env, userId, pin);
  const row = await env.DB.prepare(`
    UPDATE users SET pin_salt = ?2, pin_hash = ?3, pin_version = pin_version + 1, pin_fails = 0, pin_locked = 0
    WHERE id = ?1 RETURNING pin_version`).bind(userId, salt, hash).first();
  return row.pin_version;
}
