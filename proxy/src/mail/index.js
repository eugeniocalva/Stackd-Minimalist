/* One mail adapter, like speech-to-text (architecture §30, "Mail"). The
   provider is an owner decision still open (PRD-accounts §09), so only the
   stub exists: it keeps messages in memory (env.MAIL_OUTBOX in the tests,
   the module's own list under `wrangler dev`) and sends nothing. A real
   provider is one more branch here, chosen by MAIL_PROVIDER; nothing else
   changes. */

import { render } from './templates.js';

const devOutbox = [];
const outbox = (env) => env.MAIL_OUTBOX || devOutbox;

export const mailReady = (env) => env.MAIL_PROVIDER === 'stub';

/** Never logs the address, the code or the text (AC-11.7). */
export async function send(env, { to, template, vars }) {
  const msg = render(template, vars, env);
  if (env.MAIL_PROVIDER === 'stub') {
    const box = outbox(env);
    box.push({ to, template, ...msg });
    if (box.length > 50) box.splice(0, box.length - 50);
    return;
  }
  throw new Error('mail provider not set');
}

/** Local development only (`wrangler dev --config wrangler.dev.toml`): the
    stub's last message to an address, so the code can be typed in. The
    router serves it only when DEV_MAIL is '1' and the request is to localhost. */
export const devLastMessage = (env, to) => [...outbox(env)].reverse().find((m) => m.to === to) || null;
