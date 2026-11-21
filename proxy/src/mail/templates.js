/* The five account emails (PRD-accounts US-09). Plain text, English, no
   link that signs anyone in, each ending with the owner's footer. */

const LINE = 'You receive this because of activity on your Stack\'d account.';

const when = (at) => new Date(at).toUTCString().replace(' GMT', ' UTC');

export const TEMPLATES = {
  code: ({ code }) => ({
    subject: `Your Stack'd code: ${code}`,
    text: `Your Stack'd sign-in code is ${code}.\n\nIt is valid for 10 minutes.\n\nIf you did not ask for this, ignore this message.`,
  }),
  new_signin: ({ label, at }) => ({
    subject: 'New sign-in to your Stack\'d account',
    text: `Your Stack'd account was signed in on a new device: ${label}, ${when(at)}.\n\nIf this was not you, reset your PIN in the app with an email code; that signs out every other device.`,
  }),
  pin_changed: ({ at }) => ({
    subject: 'Your Stack\'d PIN was changed',
    text: `The PIN of your Stack'd account was changed on ${when(at)}. Your other devices will ask for the new PIN.\n\nIf this was not you, reset your PIN in the app with an email code.`,
  }),
  pin_reset: ({ at }) => ({
    subject: 'Your Stack\'d PIN was reset',
    text: `The PIN of your Stack'd account was reset with an email code on ${when(at)}, and every other device was signed out.\n\nIf this was not you, someone can read your email: secure your mailbox, then reset the PIN again.`,
  }),
  deleted: ({ at }) => ({
    subject: 'Your Stack\'d account was deleted',
    text: `Your Stack'd account and everything synced to it were deleted on ${when(at)}.\n\nA subscription bought in the App Store or Google Play continues until you cancel it there.`,
  }),
};

export function render(template, vars, env) {
  const t = TEMPLATES[template];
  if (!t) throw new Error(`unknown mail template ${template}`);
  const { subject, text } = t(vars);
  const footer = String(env.OWNER_FOOTER || '').trim();
  return { subject, text: `${text}\n\n--\n${footer ? `${footer}\n` : ''}${LINE}\n` };
}
