/* Sync (PRD-accounts US-05, US-06; architecture §29, §30 "Sync protocol").

   Diff against a shadow, not instrument every mutation: after a commit the
   engine takes the wire form of every record, hashes it, and compares with
   the hash it last synced. Changed or new → a change; in the shadow but
   gone → a tombstone. The records' own updatedAt keeps its meaning; sync
   has its own clock (changedAt), corrected by the server's.

   The top half is pure and runs under `npm run check` (check-sync.mjs);
   the runner below it talks to the proxy through net.js and is a no-op on
   a signed-out device (AC-01.2). */

import { S, applyRemote, replaceRecords, isUntouchedSeed, setShares, removeSharedBoard } from './store.js';
import { request as call } from './net.js';
import { signedIn, current, onForget, patch } from './account.js';
import { cleanRemote, keep } from './backup.js';

export const KINDS = ['list', 'task', 'note', 'meeting', 'settings'];
export const SYNC_KEY = 'stackd-sync';
export const BATCH = 200;
export const DEBOUNCE_MS = 2000;
export const POLL_MS = 30_000;               // while visible (PRD-improvements AC-11.1)

/* ── pure ────────────────────────────────────────────────────────────── */

/** JSON with keys sorted, so equal records always hash the same. */
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
}

/** 53-bit string hash (cyrb53), hex. Change detection only, not security. */
export function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** What leaves the device for each kind (AC-05.1, AC-05.2): never a
    recording, a job, an error, or when a reminder last fired. */
export function toWire(kind, x) {
  if (kind === 'task') { const { reminderFiredAt, ...t } = x; return t; }
  if (kind === 'meeting') { const { recording, jobs, lastError, ...m } = x; return m; }
  if (kind === 'settings') return { dateFormat: x.dateFormat, priorities: x.priorities, labels: x.labels };
  if (kind === 'list') { const { share, ...l } = x; return l; }   // who it is shared with is the server's to say
  return { ...x };
}

/** Puts back what the device owns. local: the record here now, if any. */
export function fromWire(kind, data, local) {
  if (kind === 'task') return { ...data, reminderFiredAt: local?.reminderFiredAt ?? null };
  if (kind === 'meeting') {
    return { ...data, recording: local?.recording ?? null, jobs: local?.jobs ?? { transcribe: null, summarise: null }, lastError: local?.lastError ?? null };
  }
  return data;
}

const plural = { list: 'lists', task: 'tasks', note: 'notes', meeting: 'meetings' };

/** 'task:a1b2' → { kind, id, data } for everything that syncs. A shared
    board and its cards live in their space, never in the personal records
    (architecture §39): space: that board's records only; without it,
    everything but the shared boards. */
export function collect(state, { space = null } = {}) {
  const out = new Map();
  const shared = new Set((state.lists || []).filter((l) => l.share).map((l) => l.id));
  const inScope = (kind, x) => {
    const board = kind === 'list' ? x.id : kind === 'task' ? x.listId : null;
    /* a space takes its board only once the board here is the shared one:
       a personal board that happens to have that id never goes into it */
    return space ? board === space && shared.has(space) : !shared.has(board);
  };
  for (const kind of space ? ['list', 'task'] : ['list', 'task', 'note', 'meeting']) {
    for (const x of state[plural[kind]] || []) if (inScope(kind, x)) out.set(`${kind}:${x.id}`, { kind, id: x.id, data: toWire(kind, x) });
  }
  if (!space) out.set('settings:settings', { kind: 'settings', id: 'settings', data: toWire('settings', state) });
  return out;
}

/** A changedAt the server can order: server time, and always later than
    the last one this record had, whatever the device clock says. */
export const nextChangedAt = (now, offset, previous = 0) => Math.max(Math.round(now + offset), previous + 1);

/** shadow: key → [hash, changedAt]. Returns the changes, each with its hash. */
export function diff(collected, shadow, now, offset = 0) {
  const changes = [];
  for (const [key, r] of collected) {
    const h = hash(canonical(r.data));
    const s = shadow[key];
    if (!s || s[0] !== h) changes.push({ key, hash: h, kind: r.kind, id: r.id, changedAt: nextChangedAt(now, offset, s?.[1]), deleted: false, data: r.data });
  }
  for (const key of Object.keys(shadow)) {
    if (collected.has(key) || shadow[key][0] === null) continue;
    const [kind, id] = key.split(':');
    changes.push({ key, hash: null, kind, id, changedAt: nextChangedAt(now, offset, shadow[key][1]), deleted: true, data: null });
  }
  return changes;
}

const countsOf = (s) => ({ list: s.lists?.length || 0, task: s.tasks?.length || 0, note: s.notes?.length || 0, meeting: s.meetings?.length || 0 });
const empty = (c) => !c.task && !c.note && !c.meeting;

/** First sign-in on a device (AC-06.1 to 06.4). local.untouched: only the
    samples. An empty account takes what the device has (samples too, so
    the next device downloads them instead of adding its own: no doubles);
    an empty or untouched device takes the account's; both → ask. */
export function mergePlan(local, remote) {
  if (empty(remote.counts) && !remote.counts.list) return 'upload';
  if (local.untouched || empty(local.counts)) return 'download';
  return 'ask';
}

/* ── the runner ──────────────────────────────────────────────────────── */

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(SYNC_KEY));
    return v && v.userId === current()?.userId ? v : null;
  } catch { return null; }
}
let doc = null;          // { userId, cursor, serverOffset, shadow, lastSyncAt, paused, spaces: { [id]: { cursor, shadow } }, shared }
const saveDoc = () => { if (doc) localStorage.setItem(SYNC_KEY, JSON.stringify(doc)); };
export const started = () => !!(signedIn() && (doc || load()));

let status = { state: 'synced', pending: 0, lastSyncAt: null, paused: null };
const listeners = new Set();
export const state = () => status;
export function onState(fn) { listeners.add(fn); }
function setStatus(patchObj) {
  status = { ...status, ...patchObj };
  listeners.forEach((fn) => fn(status));
}

let timer = null, running = null, again = false, blocked = () => false;
/** lock.js: no sync while the app is locked or the PIN must be proved. */
export function setBlocked(fn) { blocked = fn; }

/** The debounced entry point every trigger uses (AC-05.4). */
export function request(reason = 'edit') {
  if (!signedIn() || !(doc || (doc = load()))) return;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; run(); }, reason === 'edit' ? DEBOUNCE_MS : 0);
}

/** Sync now (AC-05.4): at once, and the answer says how it went. */
export async function now() {
  if (!signedIn() || !(doc || (doc = load()))) return status;
  clearTimeout(timer); timer = null;
  await run();
  return status;
}

const editing = () => {
  const a = globalThis.document?.activeElement;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
};

async function run() {
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do { again = false; await once(); } while (again);
    } finally { running = null; }
  })();
  return running;
}

/* — shared boards (PRD-improvements US-12): one space per shared board — */

const spacesOf = () => (doc.spaces ||= {});
const spaceDiff = (id) => diff(collect(S, { space: id }), spacesOf()[id].shadow, Date.now(), doc.serverOffset);
/** Everything waiting: personal and every shared board. */
function pendingNow() {
  if (!doc) return 0;
  return diff(collect(S), doc.shadow, Date.now(), doc.serverOffset).length
    + Object.keys(spacesOf()).reduce((n, id) => n + spaceDiff(id).length, 0);
}

const sharedListeners = new Set();
/** Membership and invitations as the last sync answer gave them. */
export const shared = () => doc?.shared || { spaces: [], invites: [] };
export function onShared(fn) { sharedListeners.add(fn); }
const goneListeners = new Set();
/** A shared board left this device (removed, left, deleted by its owner). */
export function onGone(fn) { goneListeners.add(fn); }

/** Start syncing a board through its space (after creating or accepting it). */
export function addSpace(id) {
  if (!doc) return;
  spacesOf()[id] ||= { cursor: 0, shadow: {} };
  saveDoc();
}
/** The answer to any /v1/spaces call, or the `shared` part of a sync. */
export function applyShared(sh) {
  if (!doc || !sh) return;
  doc.shared = { spaces: sh.spaces || [], invites: sh.invites || [] };
  for (const s of doc.shared.spaces) spacesOf()[s.id] ||= { cursor: 0, shadow: {} };
  setShares(Object.fromEntries(doc.shared.spaces.map((s) => [s.id, { role: s.role, ownerEmail: s.ownerEmail, members: s.members }])));
  saveDoc();
  sharedListeners.forEach((fn) => fn(doc.shared));
}
function spaceGone(id) {
  const name = S.lists.find((l) => l.id === id)?.name;
  delete spacesOf()[id];
  if (doc.shared) doc.shared.spaces = doc.shared.spaces.filter((s) => s.id !== id);
  if (name !== undefined && removeSharedBoard(id)) goneListeners.forEach((fn) => fn(name));
}
/** The owner deleted the space: the board stays here as a personal one (the caller deletes it). */
export function dropSpace(id) {
  if (!doc) return;
  delete spacesOf()[id];
  if (doc.shared) doc.shared.spaces = doc.shared.spaces.filter((s) => s.id !== id);
  saveDoc();
}
export const leaveSpace = (id) => { if (doc) { spaceGone(id); saveDoc(); } };

async function once() {
  if (!signedIn() || !doc || blocked()) return;
  if (globalThis.navigator?.onLine === false) {
    setStatus({ state: 'offline', pending: pendingNow() });
    return;
  }
  /* inbound changes never move a caret: wait for the field to be left */
  if (editing()) { clearTimeout(timer); timer = setTimeout(() => { timer = null; run(); }, DEBOUNCE_MS); return; }
  setStatus({ state: 'syncing' });
  try {
    let more = true;
    const wire = (cs) => cs.map(({ key, hash: _h, ...c }) => c);
    while (more) {
      const changes = diff(collect(S), doc.shadow, Date.now(), doc.serverOffset).slice(0, BATCH);
      const spaceChanges = Object.fromEntries(Object.keys(spacesOf()).map((id) => [id, spaceDiff(id).slice(0, BATCH)]));
      const spaces = Object.fromEntries(Object.entries(spaceChanges).map(([id, cs]) => [id, { cursor: spacesOf()[id].cursor, changes: wire(cs) }]));
      const sent = performance.now?.() ?? 0;
      const r = await call('/v1/sync', { method: 'POST', body: { cursor: doc.cursor, changes: wire(changes), spaces }, timeout: 60_000 });
      const rtt = (performance.now?.() ?? 0) - sent;
      doc.serverOffset = Math.round(r.serverTime + rtt / 2 - Date.now());
      const refused = new Set((r.rejected || []).map((x) => `${x.kind}:${x.id}`));
      for (const c of changes) if (!refused.has(c.key)) doc.shadow[c.key] = [c.hash, c.changedAt];
      /* refused because the server already deleted it: it goes here too, even if this device missed the tombstone */
      const gone = (r.rejected || []).filter((x) => x.reason === 'deleted')
        .map((x) => ({ kind: x.kind, id: x.id, changedAt: 0, deleted: true, data: null }));
      applyInbound([...(r.changes || []), ...gone]);
      doc.cursor = r.cursor;
      more = r.more || changes.length === BATCH;
      for (const [id, res] of Object.entries(r.spaces || {})) {
        if (!spacesOf()[id]) continue;
        if (res.gone) { spaceGone(id); continue; }
        const sp = spacesOf()[id];
        const no = new Set((res.rejected || []).map((x) => `${x.kind}:${x.id}`));
        for (const c of spaceChanges[id] || []) if (!no.has(c.key)) sp.shadow[c.key] = [c.hash, c.changedAt];
        const dead = (res.rejected || []).filter((x) => x.reason === 'deleted').map((x) => ({ kind: x.kind, id: x.id, changedAt: 0, deleted: true, data: null }));
        /* refused for permission: take the server's version back on the next full pull */
        if ((res.rejected || []).some((x) => x.reason === 'not_allowed')) sp.cursor = 0;
        else sp.cursor = res.cursor;
        applyInbound([...(res.changes || []), ...dead], { space: id });
        if (res.more || (spaceChanges[id] || []).length === BATCH) more = true;
      }
      applyShared(r.shared);
    }
    doc.lastSyncAt = Date.now(); doc.paused = null;
    saveDoc();
    setStatus({ state: 'synced', pending: 0, lastSyncAt: doc.lastSyncAt, paused: null });
  } catch (e) {
    saveDoc();
    const pending = pendingNow();
    if (e.code === 'offline' || e.code === 'timeout') setStatus({ state: 'offline', pending });
    else setStatus({ state: 'paused', pending, paused: { code: e.code, message: e.message, at: Date.now() } });
    if (e.code === 'pin_required') pinRequired.forEach((fn) => fn());
    if (e.code === 'accept_required') patch({ needsAccept: true });
  }
}

const pinRequired = new Set();
export function onPinRequired(fn) { pinRequired.add(fn); }

/** One change per record: the latest by the server's changedAt. */
function latestByKey(changes) {
  const out = new Map();
  for (const c of changes) {
    const key = `${c.kind}:${c.id}`;
    if (!out.has(key) || (c.changedAt || 0) >= (out.get(key).changedAt || 0)) out.set(key, c);
  }
  return [...out.values()];
}

/** Pulled changes → the store, cleaned first; the shadow moves before the
    store does, so applying never looks like a local edit. */
function applyInbound(changes, { space = null } = {}) {
  /* a space's cards that came before its board wait for it (below) */
  const sp = space ? spacesOf()[space] : null;
  if (sp?.held) changes = latestByKey([...Object.values(sp.held), ...changes]);
  if (!changes.length) return;
  /* a space whose id is a personal board here is not that board: ignore it */
  if (space && S.lists.some((l) => l.id === space && !l.share)) return;
  const shadow = space ? sp.shadow : doc.shadow;
  const upserts = [], deletes = [];
  const incomingLists = changes.filter((c) => c.kind === 'list' && !c.deleted).map((c) => c.data);
  const lists = [...S.lists.filter((l) => !incomingLists.some((x) => x?.id === l.id)), ...incomingLists];
  /* Without its board, a card would be cleaned onto the first board here, a
     personal one, and sync from there as personal. It happens when the
     board record is on a later page (renamed after many cards were added)
     or was never sent. Such cards are kept, unapplied and out of the
     shadow, until the board arrives; the space going drops them. */
  const boardHere = !space || lists.some((l) => l?.id === space);
  const held = {};
  const settings = changes.find((c) => c.kind === 'settings' && !c.deleted)?.data;
  const priorities = Array.isArray(settings?.priorities) ? settings.priorities : S.priorities;
  const order = { settings: 0, list: 1, task: 2, note: 3, meeting: 4 };
  const share = space ? S.lists.find((l) => l.id === space)?.share || shared().spaces.find((s) => s.id === space) || { role: 'member' } : null;
  for (const c of [...changes].sort((a, b) => order[a.kind] - order[b.kind])) {
    const key = `${c.kind}:${c.id}`;
    /* a shared board takes only its board and its cards */
    if (space && !(c.kind === 'list' ? c.id === space : c.kind === 'task' && (c.deleted || c.data?.listId === space))) continue;
    /* …and never a board or card this device holds outside that space */
    const mine = space && c.kind !== 'settings' ? (S[plural[c.kind]] || []).find((x) => x.id === c.id) : null;
    const foreign = !!mine && (c.kind === 'list' ? !mine.share : mine.listId !== space);
    if (c.deleted) { shadow[key] = [null, c.changedAt]; if (!foreign) deletes.push({ kind: c.kind, id: c.id }); continue; }
    if (foreign) continue;
    if (!boardHere) { held[key] = c; continue; }
    /* another person's priority level may not exist here: shown as none, kept as it is (AC-12.10) */
    const prios = space && c.kind === 'task' && typeof c.data?.priority === 'string' && !priorities.some((p) => p.id === c.data.priority)
      ? [...priorities, { id: c.data.priority }] : priorities;
    let clean;
    try { clean = cleanRemote(c.kind, c.data, { lists, priorities: prios }); } catch { continue; }   // unreadable: skip, keep ours
    if (space && c.kind === 'task' && clean.listId !== space) continue;                               // never onto another board
    const local = c.kind === 'settings' ? null : (S[plural[c.kind]] || []).find((x) => x.id === c.id);
    const record = c.kind === 'settings' ? clean : fromWire(c.kind, clean, local);
    if (space && c.kind === 'list') record.share = { role: share.role, ownerEmail: share.ownerEmail, members: share.members || [] };
    upserts.push({ kind: c.kind, record, key, changedAt: c.changedAt });
  }
  if (sp) { if (Object.keys(held).length) sp.held = held; else delete sp.held; }
  applyRemote({ upserts, deletes });
  /* the shadow takes what the store now holds, so the next diff sees no change */
  const now = collect(S, { space });
  for (const u of upserts) {
    const r = now.get(u.key);
    if (r) shadow[u.key] = [hash(canonical(r.data)), u.changedAt];
  }
}

/* — first sign-in (AC-06.1 to 06.5) — */

/** → 'upload' | 'download' | 'ask', with both sides' counts. */
export async function firstPlan() {
  const r = await call('/v1/sync/summary');
  const local = { untouched: isUntouchedSeed(), counts: countsOf(S) };
  return { plan: mergePlan(local, { counts: r.counts }), local: local.counts, remote: r.counts, serverTime: r.serverTime };
}

/** choice: 'upload' (account empty), 'download' (device empty or samples),
    'merge' (keep both) or 'replace' (use the account). */
export async function firstSync(choice) {
  const a = current(); if (!a) return;
  doc = { userId: a.userId, cursor: 0, serverOffset: 0, shadow: {}, lastSyncAt: null, paused: null, spaces: {}, shared: null };
  if (choice === 'merge' || choice === 'replace') keep(choice);
  if (choice === 'download' || choice === 'replace') {
    /* everything the account has, then installed in place of this device's */
    const all = [];
    let cursor = 0, more = true;
    while (more) {
      const r = await call('/v1/sync', { method: 'POST', body: { cursor, changes: [] }, timeout: 60_000 });
      all.push(...r.changes); cursor = r.cursor; more = r.more;
    }
    const live = all.filter((c) => !c.deleted);
    const lists = live.filter((c) => c.kind === 'list').map((c) => cleanRemote('list', c.data, { lists: [], priorities: [] }));
    const set = live.find((c) => c.kind === 'settings');
    const settings = set ? cleanRemote('settings', set.data, { lists, priorities: [] }) : { dateFormat: S.dateFormat, priorities: S.priorities, labels: S.labels };
    const read = (kind) => live.filter((c) => c.kind === kind).flatMap((c) => {
      try { return [cleanRemote(kind, c.data, { lists, priorities: settings.priorities })]; } catch { return []; }
    });
    if (lists.some((l) => l.status === 'active')) {
      replaceRecords({ lists, tasks: read('task'), notes: read('note'), meetings: read('meeting'), settings });
    }
    doc.cursor = cursor;
    for (const [key, r] of collect(S)) {
      const c = all.find((x) => `${x.kind}:${x.id}` === key);
      doc.shadow[key] = [hash(canonical(r.data)), c?.changedAt || 0];
    }
    all.filter((c) => c.deleted).forEach((c) => { doc.shadow[`${c.kind}:${c.id}`] = [null, c.changedAt]; });
  }
  saveDoc();
  await run();
}

/** Sign-out: the shadow belongs to the account, it goes with it. */
export function reset() {
  clearTimeout(timer); timer = null;
  doc = null;
  localStorage.removeItem(SYNC_KEY);
  setStatus({ state: 'synced', pending: 0, lastSyncAt: null, paused: null });
}
onForget(reset);

/** Unsynced changes, for the sign-out dialog (AC-06.6). */
export const pendingCount = () => pendingNow();

