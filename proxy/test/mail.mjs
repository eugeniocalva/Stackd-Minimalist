/* The mail adapter (proxy/src/mail/index.js): the Brevo branch against a
   stand-in fetch, what makes accounts ready, and what may never leave in a
   log. No network. */
import assert from 'node:assert/strict';
import { send, mailReady, senderOf } from '../src/mail/index.js';

const base = { MAIL_PROVIDER: 'brevo', BREVO_API_KEY: ' xkeysib-test ', MAIL_FROM: "Stack'd <code@stackdplatform.com>", MAIL_REPLY_TO: 'hi@stackdplatform.com', OWNER_FOOTER: "Stack'd Development Studio · hi@stackdplatform.com" };

/* the sender */
assert.deepEqual(senderOf(base), { name: "Stack'd", email: 'code@stackdplatform.com' });
assert.deepEqual(senderOf({ MAIL_FROM: 'code@StackdPlatform.com' }), { email: 'code@stackdplatform.com' });
assert.deepEqual(senderOf({ MAIL_FROM: '"Stack\'d" <code@stackdplatform.com>' }), { name: "Stack'd", email: 'code@stackdplatform.com' });
for (const bad of ['', 'Stack\'d <code@gmail.com>', 'code@stackdplatform.com.evil.io', 'code@mail.stackdplatform.com.io', '<a b@stackdplatform.com>', 'x@stackdplatform.com, y@stackdplatform.com']) {
  assert.equal(senderOf({ MAIL_FROM: bad }), null, `not a sender: ${bad}`);
}

/* ready only with everything it needs */
assert.equal(mailReady(base), true);
assert.equal(mailReady({ ...base, BREVO_API_KEY: '' }), false, 'no key');
assert.equal(mailReady({ ...base, BREVO_API_KEY: '   ' }), false, 'a blank key');
assert.equal(mailReady({ ...base, MAIL_FROM: 'someone@gmail.com' }), false, 'a sender outside stackdplatform.com');
assert.equal(mailReady({ ...base, MAIL_PROVIDER: 'resend' }), false, 'a provider that does not exist here');
assert.equal(mailReady({ MAIL_PROVIDER: 'stub' }), true);
assert.equal(mailReady({}), false);

/* what Brevo is sent */
const calls = [];
const ok = async (url, init) => { calls.push({ url, init }); return new Response('{"messageId":"<1@relay>"}', { status: 201 }); };
await send(base, { to: 'ana@example.com', template: 'code', vars: { code: '482913' } }, ok);
assert.equal(calls.length, 1);
const { url, init } = calls[0];
assert.equal(url, 'https://api.brevo.com/v3/smtp/email');
assert.equal(init.method, 'POST');
assert.deepEqual(init.headers, { 'api-key': 'xkeysib-test', 'content-type': 'application/json', accept: 'application/json' }, 'the key trimmed, in its header');
assert.ok(init.signal instanceof AbortSignal, 'a request that hangs is given up');
const body = JSON.parse(init.body);
assert.deepEqual(Object.keys(body).sort(), ['replyTo', 'sender', 'subject', 'tags', 'textContent', 'to']);
assert.deepEqual(body.replyTo, { email: 'hi@stackdplatform.com' }, 'a reply reaches a mailbox that is read');
assert.deepEqual(body.sender, { name: "Stack'd", email: 'code@stackdplatform.com' });
assert.deepEqual(body.to, [{ email: 'ana@example.com' }]);
assert.equal(body.subject, "Your Stack'd code: 482913");
assert.ok(body.textContent.includes('valid for 10 minutes') && body.textContent.includes('If you did not ask for this, ignore this message.'));
assert.ok(body.textContent.endsWith("Stack'd Development Studio · hi@stackdplatform.com\nYou receive this because of activity on your Stack'd account.\n"), 'the footer and the closing line (AC-09.2)');
assert.ok(!/https?:\/\//.test(body.textContent), 'no link in the message (AC-09.3)');
assert.deepEqual(body.tags, ['code'], 'the kind of message, not the code');
assert.ok(!('htmlContent' in body), 'plain text only');

/* no reply address, or one outside stackdplatform.com: none is sent */
for (const r of ['', 'someone@gmail.com']) {
  const seen = [];
  await send({ ...base, MAIL_REPLY_TO: r }, { to: 'ana@example.com', template: 'code', vars: { code: '1' } }, async (u, i) => { seen.push(JSON.parse(i.body)); return new Response('{}', { status: 201 }); });
  assert.ok(!('replyTo' in seen[0]), `no replyTo for "${r}"`);
}

/* a refusal is an error that names the status and nothing else */
for (const status of [400, 401, 429, 500]) {
  const err = await send(base, { to: 'ana@example.com', template: 'pin_reset', vars: { at: Date.UTC(2026, 10, 27) } },
    async () => new Response('{"code":"unauthorized","message":"Key not found for ana@example.com"}', { status })).catch((e) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.message, `mail provider answered ${status}`, 'no address, no code, no provider text in what is logged');
}
await assert.rejects(() => send({ ...base, BREVO_API_KEY: '' }, { to: 'a@b.co', template: 'code', vars: { code: '1' } }, ok), /not set up/);
await assert.rejects(() => send({ MAIL_PROVIDER: 'other' }, { to: 'a@b.co', template: 'code', vars: { code: '1' } }, ok), /not set/);
assert.equal(calls.length, 1, 'nothing sent when not set up');

/* the stub still keeps messages for the tests and wrangler dev */
const box = [];
await send({ MAIL_PROVIDER: 'stub', MAIL_OUTBOX: box }, { to: 'a@b.co', template: 'deleted', vars: { at: 0 } }, async () => { throw new Error('no network for the stub'); });
assert.equal(box.length, 1);

console.log('mail: Brevo request, sender, readiness, refusals and the stub pass');
