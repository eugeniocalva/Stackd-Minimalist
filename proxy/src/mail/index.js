/* One mail adapter, like speech-to-text (architecture §30, "Mail"), chosen
   by MAIL_PROVIDER:

   - 'brevo' (decision 60 of PRD 1.7.0): Brevo's transactional API, for the
     whole Stack'd family. A French company that keeps its data in the EU.
     Needs the secret BREVO_API_KEY (set in the Cloudflare dashboard, never
     in a file), MAIL_FROM, the sender: "Stack'd <account@stackdplatform.com>",
     and MAIL_REPLY_TO, where a reply goes: hi@stackdplatform.com.
     The sender must be an address at stackdplatform.com (AC-09.2), whose
     domain is set up in Brevo with SPF, DKIM and DMARC (AC-09.4).
   - 'stub': keeps messages in memory (env.MAIL_OUTBOX in the tests, the
     module's own list under `wrangler dev`) and sends nothing.

   Accounts stay switched off (503 'misconfigured') until mailReady() says
   the chosen provider has what it needs. Plain text only, five templates
   (mail/templates.js). Sending runs in the background (ctx.waitUntil), so a
   failure is only logged, by status, never with the address, the code or
   the text (AC-11.7); the person can ask for a new code after 60 seconds. */

import { render } from './templates.js';

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const SENDER_DOMAIN = 'stackdplatform.com';
const TIMEOUT_MS = 10000;

const devOutbox = [];
const outbox = (env) => env.MAIL_OUTBOX || devOutbox;

/** MAIL_FROM (or another setting) → { name, email }, or null when it is not an address at stackdplatform.com. */
export function senderOf(env, key = 'MAIL_FROM') {
  const raw = String(env[key] || '').trim();
  const m = /^(?:(.*?)\s*<([^<>\s]+)>|([^<>\s]+))$/.exec(raw);
  if (!m) return null;
  const email = (m[2] || m[3]).toLowerCase();
  if (!email.endsWith(`@${SENDER_DOMAIN}`) || !/^[a-z0-9._+-]+@/.test(email)) return null;
  const name = (m[1] || '').replace(/^"|"$/g, '').trim();
  return name ? { name, email } : { email };
}

export const mailReady = (env) => env.MAIL_PROVIDER === 'stub'
  || (env.MAIL_PROVIDER === 'brevo' && !!String(env.BREVO_API_KEY || '').trim() && !!senderOf(env));

/** Sends one of the five messages. Throws when the provider does not take it. */
export async function send(env, { to, template, vars }, fetchImpl = globalThis.fetch) {
  const msg = render(template, vars, env);
  if (env.MAIL_PROVIDER === 'stub') {
    const box = outbox(env);
    box.push({ to, template, ...msg });
    if (box.length > 50) box.splice(0, box.length - 50);
    return;
  }
  if (env.MAIL_PROVIDER === 'brevo') {
    const sender = senderOf(env);
    if (!sender || !env.BREVO_API_KEY) throw new Error('mail provider not set up');
    const res = await fetchImpl(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': String(env.BREVO_API_KEY).trim(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender,
        ...(senderOf(env, 'MAIL_REPLY_TO') ? { replyTo: senderOf(env, 'MAIL_REPLY_TO') } : {}),
        to: [{ email: to }],
        subject: msg.subject,
        textContent: msg.text,
        tags: [template],                       // the kind of message, to read Brevo's log by; never the code
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`mail provider answered ${res.status}`);
    return;
  }
  throw new Error('mail provider not set');
}

/** Local development only (`wrangler dev --config wrangler.dev.toml`): the
    stub's last message to an address, so the code can be typed in. The
    router serves it only when DEV_MAIL is '1' and the request is to localhost. */
export const devLastMessage = (env, to) => [...outbox(env)].reverse().find((m) => m.to === to) || null;
