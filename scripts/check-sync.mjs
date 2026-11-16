/* Checks for sync (architecture §37) — `npm run check`. The pure part
   (canonical, hash, wire forms, diff, the merge decision, the clock), then
   the app's sync engine end to end against the real proxy Worker on an
   in-memory SQL database, with a second "device" speaking HTTP. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.document = { getElementById: () => null, activeElement: null, addEventListener() {} };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'node' }, configurable: true });
/* a shell with protected storage, so the session is a bearer token */
const vault = new Map();
globalThis.Capacitor = {
  isNativePlatform: () => true, getPlatform: () => 'ios',
  Plugins: { SecureStorage: { get: async ({ key }) => ({ value: vault.get(key) ?? null }), set: async ({ key, value }) => { vault.set(key, value); }, remove: async ({ key }) => { vault.delete(key); } } },
};

const store = await import('../src/store.js');
const { S } = store;
const sync = await import('../src/sync.js');
const account = await import('../src/account.js');
const net = await import('../src/net.js');

/* ── pure ───────────────────────────────────────────────────────────── */
assert.equal(sync.canonical({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
assert.equal(sync.canonical({ a: 1, u: undefined }), '{"a":1}');
assert.equal(sync.hash(sync.canonical({ a: 1, b: 2 })), sync.hash(sync.canonical({ b: 2, a: 1 })), 'key order does not change the hash');
assert.notEqual(sync.hash('a'), sync.hash('b'));

const t0 = S.tasks[0];
const wire = sync.toWire('task', { ...t0, reminderFiredAt: 123 });
assert.ok(!('reminderFiredAt' in wire), 'when a reminder fired stays on the device');
assert.deepEqual(sync.fromWire('task', wire, { ...t0, reminderFiredAt: 123 }), { ...t0, reminderFiredAt: 123 });
const meet = { ...store.blankMeeting(), recording: { key: 'r1', durationMs: 5, sizeBytes: 9 }, jobs: { transcribe: { id: 'j' }, summarise: null }, lastError: { code: 'x' } };
const mw = sync.toWire('meeting', meet);
for (const k of ['recording', 'jobs', 'lastError']) assert.ok(!(k in mw), `${k} never leaves the device`);
assert.deepEqual(sync.fromWire('meeting', mw, meet), meet, 'fromWire(toWire(x), x) is x');
const sw = sync.toWire('settings', S);
assert.deepEqual(Object.keys(sw).sort(), ['dateFormat', 'labels', 'priorities']);
const col = sync.collect(S);
for (const k of ['theme', 'currentList', 'view', 'sort', 'plan', 'ai', 'onboarded']) {
  assert.ok(![...col.values()].some((r) => r.data && k in r.data && r.kind === 'settings'), `${k} is per device`);
}
assert.ok(col.has('settings:settings') && col.has(`task:${t0.id}`) && col.has('list:work'));

/* diff: new, unchanged, changed, removed; changedAt always moves forward */
let shadow = {};
let ch = sync.diff(col, shadow, 1000);
assert.equal(ch.length, col.size, 'everything is new against an empty shadow');
ch.forEach((c) => { shadow[c.key] = [c.hash, c.changedAt]; });
assert.equal(sync.diff(col, shadow, 2000).length, 0, 'nothing changed');
const edited = new Map(col);
edited.set(`task:${t0.id}`, { ...col.get(`task:${t0.id}`), data: { ...col.get(`task:${t0.id}`).data, title: 'Edited' } });
edited.delete('list:family');
ch = sync.diff(edited, shadow, 500);   // a clock that went back
assert.deepEqual(ch.map((c) => [c.kind, c.deleted]).sort(), [['list', true], ['task', false]]);
assert.ok(ch.every((c) => c.changedAt > 1000), 'later than the last changedAt, whatever the device clock says');
assert.equal(sync.nextChangedAt(5000, -1000, 3000), 4000);
assert.equal(sync.nextChangedAt(5000, -1000, 9000), 9001);
shadow['task:gone'] = [null, 10];
assert.ok(!sync.diff(col, shadow, 1).some((c) => c.id === 'gone'), 'a known tombstone is not sent again');

/* the merge decision (AC-06.1 to 06.4) */
const c = (task, note = 0, meeting = 0, list = 1) => ({ list, task, note, meeting });
assert.equal(sync.mergePlan({ untouched: false, counts: c(3) }, { counts: c(0, 0, 0, 0) }), 'upload');
assert.equal(sync.mergePlan({ untouched: true, counts: c(15) }, { counts: c(0, 0, 0, 0) }), 'upload', 'samples go up to an empty account, so a second device does not add its own');
assert.equal(sync.mergePlan({ untouched: true, counts: c(15) }, { counts: c(4) }), 'download', 'untouched samples are not merged');
assert.equal(sync.mergePlan({ untouched: false, counts: c(0) }, { counts: c(4) }), 'download');
assert.equal(sync.mergePlan({ untouched: false, counts: c(2) }, { counts: c(4) }), 'ask');

/* samples */
assert.equal(store.isUntouchedSeed(), true, 'a fresh install is the samples');

/* signed out: nothing is ever sent (AC-01.2) */
let sent = 0;
net.setFetch(async () => { sent++; throw new Error('no network expected'); });
account.init();
sync.request('boot');
await sync.now();
assert.equal(sent, 0, 'a signed-out device makes no sync request');

/* ── end to end against the Worker ──────────────────────────────────── */
if (!existsSync(new URL('../proxy/node_modules', import.meta.url))) {
  console.log('check-sync: pure part ok; end to end skipped (run npm ci in proxy/)');
  process.exit(0);
}
const { default: worker } = await import('../proxy/src/index.js');
const { d1 } = await import('../proxy/test/d1.mjs');
const legal = await import('../src/legal.js');
const db = d1();
db.migrate(new URL('../proxy/migrations/', import.meta.url));
const outbox = [];
const env = {
  APP_TOKEN: store.APP_TOKEN, DB: db, POOL: { get: async () => null, put: async () => {}, delete: async () => {} },
  PIN_PEPPER: 'p'.repeat(40), CODE_PEPPER: 'c'.repeat(40),
  TERMS_VERSION: legal.TERMS_VERSION, PRIVACY_VERSION: legal.PRIVACY_VERSION,
  MAIL_PROVIDER: 'stub', MAIL_OUTBOX: outbox, ALLOWED_ORIGINS: '',
};
const quiet = console.log;
console.log = () => {};
const toWorker = async (url, init = {}) => worker.fetch(new Request(url, { method: init.method, headers: { ...init.headers, 'CF-Connecting-IP': '198.51.100.1' }, body: init.body }), env);
net.setFetch(toWorker);
const code = (email) => /code is (\d{6})/.exec([...outbox].reverse().find((m) => m.to === email).text)[1];

/* device A: this app — register, and the first sync uploads */
const EMAIL = 'dev@example.com';
await account.start(EMAIL);
const { ticket } = await account.verify(EMAIL, code(EMAIL));
await account.register(EMAIL, ticket, '2580');
assert.equal(account.signedIn(), true);
assert.ok(vault.get('stackd-session'), 'the session is in protected storage');
assert.ok(!mem.get(account.ACCOUNT_KEY).includes(vault.get('stackd-session')), 'and not in plain storage');
const planA = await sync.firstPlan();
assert.equal(planA.plan, 'upload');
const m1 = store.newMeeting();
store.updateMeeting(m1.id, { title: 'Weekly' });
store.setRecording(m1.id, { key: 'rec-a', mimeType: 'audio/webm', durationMs: 1000, sizeBytes: 10, recordedAt: 1 });
await sync.firstSync('upload');
assert.equal(sync.state().state, 'synced');
const userId = account.current().userId;
const stored = db.raw.prepare('SELECT kind, COUNT(*) AS n FROM records WHERE user_id = ? GROUP BY kind').all(userId);
assert.deepEqual(Object.fromEntries(stored.map((r) => [r.kind, r.n])), { list: 4, meeting: 1, settings: 1, task: S.tasks.length });
const mRow = JSON.parse(db.raw.prepare("SELECT data FROM records WHERE kind = 'meeting'").get().data);
assert.equal(mRow.title, 'Weekly'); assert.ok(!('recording' in mRow), 'the recording stays on the device that made it');
assert.ok(!db.raw.prepare("SELECT data FROM records WHERE kind = 'task'").all().some((r) => 'reminderFiredAt' in JSON.parse(r.data)));

/* nothing changed: nothing sent */
let pushes = [];
net.setFetch(async (url, init) => { if (url.endsWith('/v1/sync')) pushes.push(JSON.parse(init.body).changes.length); return toWorker(url, init); });
await sync.now();
assert.deepEqual(pushes, [0], 'an unchanged device sends no change');

/* device B: HTTP, signs in, pulls, edits */
const B = async (path, body, token) => {
  const res = await worker.fetch(new Request(`https://proxy.test${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Stackd-App': store.APP_TOKEN, 'X-Stackd-Client': 'android', 'CF-Connecting-IP': '198.51.100.2', 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return res.status === 204 ? null : res.json();
};
const now0 = Date.now();
await B('/v1/auth/start', { email: EMAIL });
const tb = (await B('/v1/auth/verify', { email: EMAIL, code: code(EMAIL) })).ticket;
const bTok = (await B('/v1/auth/signin', { email: EMAIL, ticket: tb, pin: '2580', label: 'Android' })).token;
let pull = await B('/v1/sync', { cursor: 0, changes: [] }, bTok);
const bTask = pull.changes.find((x) => x.kind === 'task' && x.data.title === 'Call the dentist');
assert.ok(bTask, 'device B has the tasks');
await B('/v1/sync', { cursor: pull.cursor, changes: [{ ...bTask, changedAt: now0 + 5000, data: { ...bTask.data, title: 'Call the dentist (from B)' } }] }, bTok);

/* A pulls B's edit: applied as it came, updatedAt untouched, no echo */
const before = store.taskById(bTask.id).updatedAt;
pushes = [];
await sync.now();
assert.equal(store.taskById(bTask.id).title, 'Call the dentist (from B)');
assert.equal(store.taskById(bTask.id).updatedAt, before, 'a remote edit keeps the record\'s own updatedAt');
await sync.now();
assert.equal(pushes.at(-1), 0, 'applying a remote change does not look like a local edit');
assert.ok(store.meetingById(m1.id).recording, 'the local recording survives pulls');

/* A deletes forever, B's later edit to it stays deleted (AC-05.7) */
const victim = S.tasks.find((x) => x.title === 'Fix the bike tire');
store.deleteForever(victim.id);
await sync.now();
pull = await B('/v1/sync', { cursor: 0, changes: [{ kind: 'task', id: victim.id, changedAt: Date.now() + 60_000, deleted: false, data: { ...sync.toWire('task', victim), title: 'Revived' } }] }, bTok);
assert.deepEqual(pull.rejected, [{ kind: 'task', id: victim.id, reason: 'deleted' }]);
await sync.now();
assert.equal(store.taskById(victim.id), undefined);

/* B deletes a note-free board's task; A loses it at the next sync */
const bDel = pull.changes.find((x) => x.kind === 'task' && x.data.title === 'Milk and eggs');
await B('/v1/sync', { cursor: pull.cursor, changes: [{ kind: 'task', id: bDel.id, changedAt: Date.now() + 1000, deleted: true, data: null }] }, bTok);
await sync.now();
assert.equal(store.taskById(bDel.id), undefined, 'a delete on another device arrives');

/* an unreadable record from the server is skipped, not applied */
const evil = { kind: 'note', id: 'evilnote', changedAt: Date.now() + 2000, deleted: false, data: { id: 'evilnote', title: 'x', body: '<img src=x onerror=alert(1)>Hi', color: 'javascript:', tags: [], checklist: null, status: 'active', createdAt: 1, updatedAt: 1, order: 0 } };
await B('/v1/sync', { cursor: 0, changes: [evil] }, bTok);
await sync.now();
const n = store.noteById('evilnote');
assert.ok(n, 'the note arrives');
assert.ok(!n.body.includes('onerror'), 'its body is sanitised like typed text');
assert.equal(n.color, null, 'an unknown colour is dropped');

/* a second device signing in with untouched samples downloads, never doubles (AC-06.1) */
const local = { untouched: true, counts: { list: 4, task: 15, note: 0, meeting: 0 } };
assert.equal(sync.mergePlan(local, { counts: (await B('/v1/sync/summary', undefined, bTok)).counts }), 'download');

/* ── shared boards (PRD-improvements US-12) ─────────────────────────── */
{
  const share = await import('../src/share.js');
  const gone = [];
  sync.onGone((name) => gone.push(name));
  /* a second person, over HTTP */
  const OTHER = 'pal@example.com';
  await B('/v1/auth/start', { email: OTHER });
  const tp = (await B('/v1/auth/verify', { email: OTHER, code: code(OTHER) })).ticket;
  const pal = (await B('/v1/auth/register', { email: OTHER, ticket: tp, pin: '7531', adult: true, termsVersion: legal.TERMS_VERSION, privacyVersion: legal.PRIVACY_VERSION, label: 'Android' })).token;

  assert.deepEqual(share.parseEmails('a@x.io, not-mail'), { error: '“not-mail” is not an email address.' });
  assert.deepEqual(share.parseEmails('A@x.io\nb@y.io; a@x.io').emails, ['a@x.io', 'b@y.io']);
  assert.equal(share.parseEmails('dev@example.com', EMAIL).error, 'You are already on this board.');

  /* this device shares a new board; it and its card go to the space only */
  const trip = await share.createShared('Trip', [OTHER]);
  assert.equal(trip.share.role, 'owner');
  store.addTask({ listId: trip.id, title: 'Pack', priority: 'none', tags: [] });
  await sync.now();
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM records WHERE id = ?').get(trip.id).n, 0, 'never in the personal records');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM space_records WHERE space_id = ?').get(trip.id).n, 2);
  assert.ok(!JSON.parse(db.raw.prepare("SELECT data FROM space_records WHERE kind = 'list'").get().data).share, 'who it is shared with is not part of the board');

  /* the other person accepts, adds a card, and it arrives here */
  let s = await B('/v1/sync', { cursor: 0, changes: [] }, pal);
  await B(`/v1/invites/${s.shared.invites[0].id}/accept`, {}, pal);
  s = await B('/v1/sync', { cursor: 0, changes: [], spaces: { [trip.id]: { cursor: 0, changes: [] } } }, pal);
  assert.deepEqual(s.spaces[trip.id].changes.filter((c) => c.kind === 'task').map((c) => c.data.title), ['Pack']);
  await B('/v1/sync', { cursor: 0, changes: [], spaces: { [trip.id]: { cursor: s.spaces[trip.id].cursor, changes: [
    { kind: 'task', id: 'palcard1', changedAt: Date.now() + 1000, deleted: false, data: { ...sync.toWire('task', store.blankTask(trip.id, 'Book tickets')), id: 'palcard1', priority: 'urgent-pal' } },
  ] } } }, pal);
  await sync.now();
  const card = store.taskById('palcard1');
  assert.equal(card?.title, 'Book tickets', 'a member\'s card arrives');
  assert.equal(card.priority, 'urgent-pal', 'an unknown priority level is kept, shown as none');
  assert.equal(store.listById(trip.id).share.members.filter((m) => m.state === 'active').length, 2);
  pushes = [];
  await sync.now();
  assert.ok(pushes.at(-1) === 0, 'nothing echoes back');

  /* this device is invited to the other person's board, accepts, and loses it when it is deleted */
  const PAL = (await B('/v1/spaces', { boardId: 'palboard1', boardName: 'Pal board', emails: [EMAIL] }, pal)).id;
  assert.notEqual(PAL, 'palboard1', 'the server picks the id, not the client');
  const palBoard = { kind: 'list', id: PAL, changedAt: Date.now(), deleted: false, data: { id: PAL, name: 'Pal board', lanes: store.defaultLanes(), status: 'active' } };
  await B('/v1/sync', { cursor: 0, changes: [], spaces: { [PAL]: { cursor: 0, changes: [palBoard] } } }, pal);
  await sync.now();
  assert.deepEqual(sync.shared().invites.map((i) => i.boardName), ['Pal board']);
  await share.answer(sync.shared().invites[0].id, true);
  assert.equal(store.listById(PAL)?.share?.role, 'member', 'the board is here, shared');
  const delRes = await worker.fetch(new Request(`https://proxy.test/v1/spaces/${PAL}`, { method: 'DELETE', headers: { 'X-Stackd-App': store.APP_TOKEN, 'X-Stackd-Client': 'android', Authorization: `Bearer ${pal}` } }), env);
  assert.equal(delRes.status, 200);
  await sync.now();
  assert.equal(store.listById(PAL), undefined, 'gone from this device when its owner deletes it');
  assert.deepEqual(gone, ['Pal board']);

  /* a space that somehow has the id of a personal board here (the server
     no longer allows it; forced in the database) takes nothing from it and
     puts nothing on it */
  {
    const mine = store.activeLists().find((l) => !l.share);
    store.addTask({ listId: mine.id, title: 'Private card', priority: 'none', tags: [] });
    await sync.now();
    const uid = (email) => db.raw.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
    db.raw.prepare('INSERT INTO spaces (id, owner_id, rev, created_at) VALUES (?, ?, 0, ?)').run(mine.id, uid(OTHER), Date.now());
    db.raw.prepare("INSERT INTO space_members (space_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?), (?, ?, 'member', ?)").run(mine.id, uid(OTHER), Date.now(), mine.id, uid(EMAIL), Date.now());
    await B('/v1/sync', { cursor: 0, changes: [], spaces: { [mine.id]: { cursor: 0, changes: [
      { kind: 'list', id: mine.id, changedAt: Date.now() + 2000, deleted: false, data: { id: mine.id, name: 'Taken', lanes: store.defaultLanes(), status: 'active' } },
      { kind: 'task', id: 'palplant1', changedAt: Date.now() + 2000, deleted: false, data: { ...sync.toWire('task', store.blankTask(mine.id, 'Planted')), id: 'palplant1' } },
    ] } } }, pal);
    const before = S.tasks.filter((t) => t.listId === mine.id).length;
    await sync.now(); await sync.now();
    assert.equal(store.listById(mine.id).share, undefined, 'the personal board does not become shared');
    assert.notEqual(store.listById(mine.id).name, 'Taken');
    assert.equal(store.taskById('palplant1'), undefined, 'nothing from that space lands here');
    assert.equal(S.tasks.filter((t) => t.listId === mine.id).length, before);
    const up = db.raw.prepare("SELECT id FROM space_records WHERE space_id = ? AND id != 'palplant1'").all(mine.id).map((r) => r.id);
    assert.deepEqual(up, [mine.id], 'only the other person\'s own board record is in the space; none of this device\'s cards');
    assert.ok(db.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE kind = 'list' AND id = ? AND deleted = 0").get(mine.id).n === 1, 'still a personal board on the server');
    db.raw.prepare('DELETE FROM spaces WHERE id = ?').run(mine.id);
    await sync.now();
  }

  /* the owner here deletes Trip for everyone: personal and in Deleted, with its cards */
  await share.deleteForEveryone(trip.id);
  assert.equal(store.listById(trip.id).share, undefined);
  assert.equal(store.listById(trip.id).status, 'deleted');
  await sync.now();
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM records WHERE kind = 'list' AND id = ?").get(trip.id).n, 1, 'now it syncs as a personal board');
}

/* sign-out forgets the session and the shadow, keeps the data */
const tasksBefore = S.tasks.length;
await account.signOut({ keepData: true });
assert.equal(account.signedIn(), false);
assert.equal(vault.get('stackd-session'), undefined);
assert.equal(mem.get(sync.SYNC_KEY), undefined);
assert.equal(S.tasks.length, tasksBefore, 'Keep a copy keeps everything');
sent = 0;
net.setFetch(async () => { sent++; throw new Error('no network expected'); });
sync.request('boot'); await sync.now();
assert.equal(sent, 0, 'signed out again: silent');

console.log = quiet;
console.log('check-sync: pure part and end to end against the Worker pass');
