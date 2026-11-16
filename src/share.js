/* Shared boards on the device (PRD-improvements US-12; architecture §40):
   the calls to /v1/spaces and /v1/invites, and what each one changes here.
   The board's content travels through sync.js like everything else. */

import { request } from './net.js';
import * as sync from './sync.js';
import { S, addList, unshare, softDeleteList, canRemoveList, listById } from './store.js';

const shareFrom = (shared, id) => {
  const s = shared?.spaces?.find((x) => x.id === id);
  return s ? { role: s.role, ownerEmail: s.ownerEmail, members: s.members } : null;
};

/** Can this device share now? It needs an account whose first sync ran. */
export const canShare = () => sync.started();

/** A new board, made on the server first so it never syncs as personal.
    The server gives the id (never one this device chose), so a space can
    never be opened under a board that already exists somewhere. */
export async function createShared(name, emails) {
  const r = await request('/v1/spaces', { method: 'POST', body: { boardName: name, emails } });
  const id = r?.id;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || listById(id)) throw Object.assign(new Error('The board could not be shared. Try again.'), { code: 'provider_unavailable' });
  sync.addSpace(id);
  addList(name, { id, share: shareFrom(r.shared, id) || { role: 'owner', ownerEmail: '', members: [] } });
  sync.applyShared(r.shared);
  sync.request('share');
  return listById(id);
}

export async function invite(id, emails) {
  const r = await request(`/v1/spaces/${encodeURIComponent(id)}/invite`, { method: 'POST', body: { emails, boardName: listById(id)?.name } });
  sync.applyShared(r.shared);
}

export async function removePerson(id, email) {
  const r = await request(`/v1/spaces/${encodeURIComponent(id)}/remove`, { method: 'POST', body: { email } });
  sync.applyShared(r.shared);
}

/** A member leaves: the board and its cards go from this device. */
export async function leave(id) {
  await request(`/v1/spaces/${encodeURIComponent(id)}/leave`, { method: 'POST', body: {} });
  sync.leaveSpace(id);
}

/** The owner deletes it for everyone. Here it becomes a personal board in
    Deleted, with its cards, for the usual 30 days. */
export async function deleteForEveryone(id) {
  await request(`/v1/spaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
  sync.dropSpace(id);
  unshare(id);
  if (canRemoveList(id)) softDeleteList(id);
  sync.request('share');
}

/** Accept or decline an invitation (AC-12.3). */
export async function answer(inviteId, accept) {
  const r = await request(`/v1/invites/${encodeURIComponent(inviteId)}/${accept ? 'accept' : 'decline'}`, { method: 'POST', body: {} });
  sync.applyShared(r.shared);
  if (accept) await sync.now();
}

export async function refresh() {
  const r = await request('/v1/spaces');
  sync.applyShared(r.shared);
}

/** "a@x.com, b@y.com\nc@z.com" → the addresses, or an error naming the first bad one. */
export function parseEmails(text, own = '') {
  const parts = String(text ?? '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: 'Add at least one email address.' };
  if (parts.length > 9) return { error: 'A shared board has at most 10 people.' };
  const bad = parts.find((p) => !/^[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+$/.test(p));
  if (bad) return { error: `“${bad}” is not an email address.` };
  if (own && parts.some((p) => p.toLowerCase() === own.toLowerCase())) return { error: 'You are already on this board.' };
  return { emails: [...new Set(parts.map((p) => p.toLowerCase()))] };
}

/** Boards on this device that are shared, with their people. */
export const sharedBoards = () => S.lists.filter((l) => l.share && (l.status ?? 'active') === 'active');
