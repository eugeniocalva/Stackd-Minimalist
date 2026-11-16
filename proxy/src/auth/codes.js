/* Email codes and tickets (PRD-accounts AC-02.6, AC-02.7, AC-02.9;
   architecture §30, "Sign-in sequence"). A code proves the mailbox once;
   a correct code becomes a ticket, which proves it for ten minutes more
   and is spent by register, sign-in or reset. Known and unknown emails
   take the same path, so the answer to start says nothing about either. */

import { hmac, sha256, sixDigits, token, safeEqual } from './crypto.js';
import { hit, HOUR, LIMITS } from './ratelimit.js';
import { AuthError } from './http.js';
import { send } from '../mail/index.js';

export const CODE_MS = 10 * 60_000;
export const TICKET_MS = 10 * 60_000;
export const RESEND_MS = 60_000;
export const MAX_ATTEMPTS = 5;

const emailKey = (env, email) => hmac(env.CODE_PEPPER, `email:${email}`);
const codeHash = (env, email, code) => hmac(env.CODE_PEPPER, `${email}:${code}`);
/* the address is never stored; its keyed hash names a rate window */
const addressKey = async (env, request) => hmac(env.CODE_PEPPER, `ip:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);

const limited = (retryAfter) => new AuthError('rate_limited', `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute${retryAfter > 60 ? 's' : ''}.`, 429, { retryAfter });

/** Stores a new code and hands the mail to `later`. */
export async function startCode(env, request, email, { now, later }) {
  const key = await emailKey(env, email);
  const byAddress = await hit(env, `code:n:${await addressKey(env, request)}`, { limit: LIMITS.codePerAddress, windowMs: HOUR, now });
  if (!byAddress.ok) throw limited(byAddress.retryAfter);
  const existing = await env.DB.prepare('SELECT sent_at FROM login_codes WHERE email_key = ?').bind(key).first();
  if (existing && now - existing.sent_at < RESEND_MS) throw limited(Math.ceil((existing.sent_at + RESEND_MS - now) / 1000));
  const byEmail = await hit(env, `code:e:${key}`, { limit: LIMITS.codePerEmail, windowMs: HOUR, now });
  if (!byEmail.ok) throw limited(byEmail.retryAfter);
  const code = sixDigits();
  await env.DB.prepare(`
    INSERT INTO login_codes (email_key, code_hash, expires_at, attempts, sent_at, ticket_hash, ticket_expires_at)
    VALUES (?1, ?2, ?3, 0, ?4, NULL, NULL)
    ON CONFLICT(email_key) DO UPDATE SET code_hash = ?2, expires_at = ?3, attempts = 0, sent_at = ?4, ticket_hash = NULL, ticket_expires_at = NULL`)
    .bind(key, await codeHash(env, email, code), now + CODE_MS, now).run();
  later(send(env, { to: email, template: 'code', vars: { code } }));
}

/** A correct code → { ticket }. Says which of wrong, expired or used it was. */
export async function verifyCode(env, request, email, code, { now }) {
  const byAddress = await hit(env, `verify:n:${await addressKey(env, request)}`, { limit: LIMITS.verifyPerAddress, windowMs: HOUR, now });
  if (!byAddress.ok) throw limited(byAddress.retryAfter);
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw new AuthError('code_wrong', 'The code is six digits.', 400, { left: null });
  const key = await emailKey(env, email);
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email_key = ?').bind(key).first();
  if (!row) throw new AuthError('code_expired', 'This code has expired. Ask for a new one.');
  if (row.ticket_hash) throw new AuthError('code_used', 'This code was already used. Ask for a new one.');
  if (now > row.expires_at) throw new AuthError('code_expired', 'This code has expired. Ask for a new one.');
  if (row.attempts >= MAX_ATTEMPTS) throw new AuthError('code_expired', 'Too many wrong codes. Ask for a new one.');
  if (!safeEqual(await codeHash(env, email, code), row.code_hash)) {
    const n = await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email_key = ? RETURNING attempts').bind(key).first();
    const left = Math.max(0, MAX_ATTEMPTS - n.attempts);
    throw left
      ? new AuthError('code_wrong', `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, 400, { left })
      : new AuthError('code_expired', 'Too many wrong codes. Ask for a new one.');
  }
  const ticket = token();
  await env.DB.prepare('UPDATE login_codes SET ticket_hash = ?2, ticket_expires_at = ?3 WHERE email_key = ?1')
    .bind(key, await sha256(ticket), now + TICKET_MS).run();
  return { ticket };
}

/** The email a ticket proves, spending the ticket. Throws ticket_expired. */
export async function spendTicket(env, ticket, { now, keep = false } = {}) {
  if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 100) throw new AuthError('ticket_expired', 'Start again with a new code.', 401);
  const row = await env.DB.prepare('SELECT email_key, ticket_expires_at FROM login_codes WHERE ticket_hash = ?').bind(await sha256(ticket)).first();
  if (!row || now > row.ticket_expires_at) throw new AuthError('ticket_expired', 'Start again with a new code.', 401);
  if (!keep) await env.DB.prepare('DELETE FROM login_codes WHERE email_key = ?').bind(row.email_key).run();
  return row.email_key;
}

/** Which email does this ticket belong to? The ticket only knows the
    email's keyed hash, so the caller passes the email and both must agree. */
export async function ticketMatches(env, ticket, email, opts) {
  const key = await spendTicket(env, ticket, { ...opts, keep: true });
  if (key !== await emailKey(env, email)) throw new AuthError('ticket_expired', 'Start again with a new code.', 401);
  return key;
}

export const consumeTicket = (env, emailKeyValue) =>
  env.DB.prepare('DELETE FROM login_codes WHERE email_key = ?').bind(emailKeyValue).run();
