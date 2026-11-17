/* Shared boards in the app (PRD-improvements US-12): the Personal / Shared
   question on "New board", the email sheet, the "Shared" mark and the people
   sheet on a board, the invitation cards, and Settings › Shared boards. */

import { addList, listById, rerender } from '../store.js';
import { esc, app } from '../util.js';
import { icon } from './icons.js';
import { overlay, choiceDialog, confirmDialog, promptDialog, toast } from './primitives.js';
import { openSignIn } from './signin.js';
import * as account from '../account.js';
import * as sync from '../sync.js';
import * as share from '../share.js';

/* — New board (AC-12.1, AC-12.2) — */

export async function newBoardFlow() {
  /* no Personal / Shared question where there can be no account (the apps until
     the secure-storage plugin, a file:// copy): every board is personal there */
  const kind = !account.availability().ok ? 'personal' : await choiceDialog('New board', 'Only for you, or shared with other people? People on a shared board see and change its cards.',
    [{ id: 'personal', label: 'Personal' }, { id: 'shared', label: 'Shared' }]);
  if (!kind) return;
  if (kind === 'personal') {
    const name = await promptDialog('New board', { placeholder: 'Board name', confirmLabel: 'Create' });
    if (name) addList(name);
    return;
  }
  if (!account.signedIn() || !share.canShare()) {
    const ok = await confirmDialog('Sharing needs an account',
      account.signedIn() ? 'Wait for the first sync to finish, then try again.' : 'Sign in, or create an account, to share a board. Personal boards work without one.',
      { confirmLabel: account.signedIn() ? 'OK' : 'Sign in' });
    if (ok && !account.signedIn()) openSignIn();
    return;
  }
  const name = await promptDialog('New shared board', { placeholder: 'Board name', confirmLabel: 'Next' });
  if (!name) return;
  await emailsSheet({
    title: `Share “${name}” with`,
    action: 'Share',
    submit: async (emails) => { await share.createShared(name, emails); toast(`“${name}” is shared. They see it once they accept.`, { ms: 6000 }); },
  });
}

/** One field for one or more addresses; refuses a bad one in place. */
function emailsSheet({ title, action, submit }) {
  return new Promise((resolve) => {
    const { ov, close } = overlay(`
      <div class="sheet steps-sheet" role="dialog" aria-modal="true" aria-labelledby="share-title">
        <div class="steps-head"><span></span><span></span><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
        <h2 id="share-title">${esc(title)}</h2>
        <label class="sr-only" for="share-emails">Email addresses</label>
        <textarea class="input share-emails" id="share-emails" rows="3" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="name@example.com, another@example.com"></textarea>
        <p class="hint">They get an invitation in Stack'd when they sign in with that email. Nothing is sent by email.</p>
        <p class="step-error" role="alert" data-err></p>
        <button type="button" class="btn btn-primary btn-block" data-go>${esc(action)}</button>
      </div>`, { onClose: (r) => resolve(r === true) });
    const input = ov.querySelector('textarea'), err = ov.querySelector('[data-err]'), go = ov.querySelector('[data-go]');
    ov.querySelector('[data-close]').addEventListener('click', () => close(false));
    go.addEventListener('click', async () => {
      const p = share.parseEmails(input.value, account.current()?.email);
      if (p.error) { err.textContent = p.error; input.focus(); return; }
      go.disabled = true; err.textContent = '';
      try { await submit(p.emails); close(true); }
      catch (e) { err.textContent = e.message; go.disabled = false; }
    });
    input.focus();
  });
}

/* — the mark on a shared board (AC-12.6) — */

export function sharedChipHTML(list) {
  if (!list?.share) return '';
  const n = (list.share.members || []).filter((m) => m.state === 'active').length;
  return `<button type="button" class="tag shared-chip" data-people="${esc(list.id)}" aria-label="Shared with ${n} ${n === 1 ? 'person' : 'people'}. Show who">${icon('meeting', 12)}Shared${n > 1 ? ` · ${n}` : ''}</button>`;
}
export function bindSharedChip(root = app) {
  root.querySelector('[data-people]')?.addEventListener('click', (e) => openPeople(e.currentTarget.dataset.people));
}

export function openPeople(id) {
  const l = listById(id); if (!l?.share) return;
  const owner = l.share.role === 'owner';
  const people = l.share.members || [];
  const { ov, close } = overlay(`
    <div class="sheet steps-sheet" role="dialog" aria-modal="true" aria-labelledby="people-title">
      <div class="steps-head"><span></span><span></span><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      <h2 id="people-title">${esc(l.name)}</h2>
      <p class="step-text">${owner ? 'You share this board. Everyone here can add, move and complete cards and change lanes; only you rename or delete it.' : `Shared with you by ${esc(l.share.ownerEmail)}.`}</p>
      <div class="card list-card people-list">
        ${people.map((p) => `
        <div class="set-row">
          <span class="lrow-icon">${icon('meeting', 18)}</span>
          <div class="set-text"><span class="set-title">${esc(p.email)}</span><span class="set-sub">${p.role === 'owner' ? 'Owner' : p.state === 'pending' ? 'Invited, not accepted yet' : 'Member'}</span></div>
          ${owner && p.role !== 'owner' ? `<button class="btn btn-sm btn-ghost danger" data-remove="${esc(p.email)}">${p.state === 'pending' ? 'Withdraw' : 'Remove'}</button>` : ''}
        </div>`).join('')}
      </div>
      ${owner ? '<button type="button" class="btn btn-secondary btn-block" data-invite>Invite people</button>' : '<button type="button" class="btn btn-ghost btn-block danger" data-leave>Leave this board</button>'}
    </div>`);
  ov.querySelector('[data-close]').addEventListener('click', () => close());
  ov.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
    const email = b.dataset.remove;
    if (!await confirmDialog(`Remove ${email}?`, 'The board leaves their devices at their next sync.', { confirmLabel: 'Remove', danger: true })) return;
    try { await share.removePerson(id, email); close(); openPeople(id); } catch (e) { toast(e.message); }
  }));
  ov.querySelector('[data-invite]')?.addEventListener('click', async () => {
    close();
    await emailsSheet({ title: `Invite to “${l.name}”`, action: 'Invite', submit: async (emails) => { await share.invite(id, emails); toast('Invited'); } });
    rerender();
  });
  ov.querySelector('[data-leave]')?.addEventListener('click', async () => {
    close();
    await askLeave(id);
  });
}

async function askLeave(id) {
  const l = listById(id); if (!l) return;
  if (!await confirmDialog(`Leave “${l.name}”?`, 'The board and its cards leave this device. The others keep them, and the owner can invite you again.', { confirmLabel: 'Leave', danger: true })) return;
  try { await share.leave(id); toast(`You left “${l.name}”`); } catch (e) { toast(e.message); }
}

/** The delete badge on a shared board's row: delete for everyone, or leave. */
export async function askRemoveShared(id) {
  const l = listById(id); if (!l?.share) return;
  if (l.share.role !== 'owner') { await askLeave(id); return; }
  const ok = await confirmDialog(`Delete “${l.name}” for everyone?`,
    'It leaves every member\'s devices at their next sync. Here it goes to Deleted with its cards, for 30 days, as a personal board.',
    { confirmLabel: 'Delete for everyone', danger: true });
  if (!ok) return;
  try { await share.deleteForEveryone(id); toast(`“${l.name}” was deleted for everyone. It stays in Deleted here for 30 days.`, { ms: 6000 }); } catch (e) { toast(e.message); }
}

/* — invitations (AC-12.3) — */

export const invitations = () => (account.signedIn() ? sync.shared().invites : []);

export function invitesHTML() {
  const list = invitations();
  if (!list.length) return '';
  return list.map((i) => `
    <div class="notice notice-neutral invite-card" role="region" aria-label="Invitation">
      ${icon('meeting', 18)}
      <span><strong>${esc(i.ownerEmail)}</strong> shared “${esc(i.boardName)}” with you.</span>
      <span class="invite-actions">
        <button class="btn btn-sm btn-primary" data-accept-invite="${esc(i.id)}">Accept</button>
        <button class="btn btn-sm btn-ghost" data-decline-invite="${esc(i.id)}">Decline</button>
      </span>
    </div>`).join('');
}

export function bindInvites(root = app) {
  root.querySelectorAll('[data-accept-invite]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await share.answer(b.dataset.acceptInvite, true); toast('Joined. The board is in your list.'); } catch (e) { toast(e.message); b.disabled = false; }
    rerender();
  }));
  root.querySelectorAll('[data-decline-invite]').forEach((b) => b.addEventListener('click', async () => {
    try { await share.answer(b.dataset.declineInvite, false); } catch (e) { toast(e.message); }
    rerender();
  }));
}

/* — Settings › Shared boards (AC-12.7) — */

export function sharedSectionHTML() {
  const boards = share.sharedBoards();
  if (!account.signedIn() || !boards.length) return '';
  return `
      <span class="section-title list-label" id="settings-shared">Shared boards</span>
      <div class="card list-card">
        ${boards.map((l) => {
          const me = account.current()?.email;
          const ppl = (l.share.members || []).filter((m) => m.email !== me && m.role !== 'owner')
            .map((m) => `${m.email}${m.state === 'pending' ? ' (invited)' : ''}`).join(', ') || 'nobody yet';
          return `
        <div class="set-row set-wrap">
          <span class="lrow-icon">${icon('board', 18)}</span>
          <div class="set-text"><span class="set-title">${esc(l.name)}</span><span class="set-sub set-long">${l.share.role === 'owner' ? 'You share it with' : `Shared by ${esc(l.share.ownerEmail)} ·`} ${esc(ppl)}</span></div>
          <button class="btn btn-sm btn-secondary" data-people="${esc(l.id)}">People</button>
        </div>`;
        }).join('')}
      </div>`;
}
export function bindSharedSection(root = app) {
  root.querySelectorAll('#settings-shared + .card [data-people]').forEach((b) => b.addEventListener('click', () => openPeople(b.dataset.people)));
}
