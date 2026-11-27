/* Checks for the export file and its import (src/backup.js, PRD-accounts
   AC-12.2) — `npm run check`. Same minimal browser as check-store.mjs. */
import assert from 'node:assert/strict';

const mem = new Map();
let failWrites = false;
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k),
};
globalThis.document = { getElementById: () => null };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };

const store = await import('../src/store.js');
const backup = await import('../src/backup.js');
const { S } = store;
const file = (value) => new Blob([typeof value === 'string' ? value : JSON.stringify(value)], { type: 'application/json' });
const clone = (x) => JSON.parse(JSON.stringify(x));
const rejects = async (blob, code, message) => {
  const before = JSON.stringify(S);
  await assert.rejects(() => backup.importFile(blob), (e) => e instanceof backup.ImportError && e.code === code, message);
  assert.equal(JSON.stringify(S), before, `${message}: nothing changed`);
};

let renders = 0, commits = 0;
const removed = [];
store.setRenderer(() => { renders++; });
store.setAfterCommit(() => { commits++; });
store.setMediaRemover((keys) => removed.push(...keys));

/* ── a document with one of everything ───────────────────────────────── */

const task = S.tasks.find((t) => t.title === 'Book 1:1s for next sprint');
store.setTags(task.id, ['Team', 'q3']);
store.setDescription(task.id, 'Agenda in the <b>shared</b> doc<br>30 minutes each');
store.archiveTask(S.tasks.find((t) => t.title === 'Water the plants').id);
store.softDelete(S.tasks.find((t) => t.title === 'Fix the bike tire').id);
store.addLabel('someday');
store.addPriority('Urgent');
store.addLane('work', 'Review');
const note = store.addNote({ title: 'Weekly sync', body: 'Agenda:<br>budget <b>Q4</b>', color: 'blue', tags: ['meeting'], checklist: [{ text: 'Book room', done: true }, { text: 'Send invite', done: false }] });
store.archiveNote(store.addNote({ title: 'Old idea', body: 'x', color: null, tags: [], checklist: null }).id);
const meeting = store.newMeeting();
store.updateMeeting(meeting.id, { title: 'Kick-off' });
store.setTranscript(meeting.id, {
  source: 'pasted',
  segments: [{ speaker: 'S1', startMs: 0, text: 'We ship on Friday.' }, { speaker: 'S2', startMs: 4000, text: 'I will tell the vendor.' }],
  speakers: { S1: null, S2: 'Marco' },
});
store.setMinutes(meeting.id, { summary: 'Ship Friday.', decisions: ['Ship on Friday'], openQuestions: ['Who tests?'] },
  [{ title: 'Tell the vendor', due: '2026-12-01', priority: 'High', excerpt: 'I will tell the vendor.' }]);
store.addActionToBoard(meeting.id, S.meetings[0].actions[0].id, { listId: 'work', title: 'Tell the vendor', due: '2026-12-01', priority: 'high', tags: [] });
store.setRecording(meeting.id, { key: `rec-${meeting.id}`, mimeType: 'audio/webm', durationMs: 60000, sizeBytes: 1000, recordedAt: Date.now() });
const second = store.newMeeting();
store.setRecording(second.id, { key: `rec-${second.id}`, mimeType: 'audio/webm', durationMs: 1000, sizeBytes: 10, recordedAt: Date.now() });
assert.ok(note && S.meetings.length === 2);

/* ── export ──────────────────────────────────────────────────────────── */

const doc = backup.exportDocument(1760000000000);
assert.equal(doc.app, 'stackd');
assert.equal(doc.format, backup.FILE_FORMAT);
assert.deepEqual(Object.keys(doc.records).sort(), ['lists', 'meetings', 'notes', 'settings', 'tasks']);
assert.deepEqual(Object.keys(doc.records.settings).sort(), ['dateFormat', 'imports', 'labels', 'priorities']);
assert.ok(doc.records.meetings.every((m) => !('recording' in m) && !('jobs' in m) && !('lastError' in m)), 'device-only meeting fields stay behind');
assert.equal(backup.recordingsLeftBehind(), 2);
const json = await backup.makeBackup().blob.text();
assert.ok(!json.includes(S.plan.subscriberId), 'the subscriber id is not in the file');
for (const key of ['"plan"', '"ai"', '"proxyUrl"', '"theme"', '"subscriberId"']) assert.ok(!json.includes(key), `${key} is not in the file`);
/* the backup file (PRD 1.7.0 §06.3): its name carries the local date and time, so two on one day keep apart */
assert.equal(backup.backupFileName(new Date(2026, 10, 13, 9, 5).getTime()), 'stackd-backup-2026-11-13-0905.json');
assert.equal(backup.backupFileName(new Date(2026, 10, 13, 14, 30).getTime()), 'stackd-backup-2026-11-13-1430.json');
{
  const made = backup.makeBackup(1760000000000);
  assert.equal(made.blob.type, 'application/json');
  assert.equal(made.name, backup.backupFileName(1760000000000));
  assert.equal(made.at, 1760000000000);
  assert.deepEqual(made.counts, backup.countsOf(doc.records), 'the counts are those of the file');
  assert.deepEqual(JSON.parse(await made.blob.text()), clone(doc), 'with no shared board, the file is the whole document');
  assert.ok(!json.includes('lastFileBackupAt'), 'when a backup was made is not in the file');

  /* shared boards stay out, with their cards and with the people on them (decision 34) */
  const sharedId = 'sharedboard1';
  S.lists.push({ id: sharedId, name: 'With Ana', lanes: store.defaultLanes(), status: 'active', archivedAt: null, deletedAt: null,
    share: { role: 'member', ownerEmail: 'owner@example.test', members: [{ email: 'ana@example.test', role: 'member', state: 'active' }] } });
  S.tasks.push(store.blankTask(sharedId, 'A card on the shared board'));
  assert.equal(backup.sharedBoards(), 1);
  const text = await backup.makeBackup().blob.text();
  for (const s of ['With Ana', sharedId, 'owner@example.test', 'ana@example.test', 'A card on the shared board']) assert.ok(!text.includes(s), `${s} is not in a backup`);
  assert.equal(JSON.parse(text).records.lists.length, doc.records.lists.length, 'the personal boards are all there');
  backup.keep('merge');
  assert.ok(mem.get(backup.BACKUP_KEY).includes(sharedId) && mem.get(backup.BACKUP_KEY).includes('A card on the shared board'), 'the copy kept before a first sign-in still takes every board');
  assert.equal(backup.info().counts.boards, S.lists.length);
  backup.dropBackup();
  assert.equal(backup.info(), null);

  /* the person's own boards all archived, a shared board in use: the notes, meetings and archived boards still go
     into a file, with an empty board standing in so that it restores */
  const personal = S.lists.filter((l) => !l.share);
  const statusWas = personal.map((l) => [l.status, l.archivedAt]);
  personal.forEach((l) => { l.status = 'archived'; l.archivedAt = 1; });
  const lone = JSON.parse(await backup.makeBackup().blob.text());
  assert.deepEqual(lone.records.lists.map((l) => l.status), ['active', ...personal.map(() => 'archived')], 'one stand-in board, then the archived ones');
  assert.equal(lone.records.lists[0].name, 'Board');
  assert.equal(lone.records.notes.length, doc.records.notes.length, 'the notes are in it');
  assert.doesNotThrow(() => backup.readDocument(lone), 'and it restores');
  personal.forEach((l, i) => { [l.status, l.archivedAt] = statusWas[i]; });
  /* nothing at all but shared boards: no file, and the sentence says why */
  const keptNotes = S.notes, keptMeetings = S.meetings, keptTasks = S.tasks;
  S.lists = S.lists.filter((l) => l.share); S.notes = []; S.meetings = []; S.tasks = S.tasks.filter((t) => t.listId === sharedId);
  assert.throws(() => backup.makeBackup(), (e) => e instanceof backup.ImportError && e.code === 'nothing' && /Only shared boards/.test(e.message));
  S.lists = [...personal, ...S.lists]; S.notes = keptNotes; S.meetings = keptMeetings; S.tasks = keptTasks;
  S.lists = S.lists.filter((l) => !l.share);
  S.tasks = S.tasks.filter((t) => t.listId !== sharedId);
  assert.equal(backup.sharedBoards(), 0);

  /* nor one with more records than a restore accepts */
  const tasks = S.tasks;
  S.tasks = Array.from({ length: backup.MAX_RECORDS + 1 }, (_, i) => store.blankTask('work', `t${i}`));
  assert.throws(() => backup.makeBackup(), (e) => e instanceof backup.ImportError && e.code === 'too_large');
  S.tasks = tasks;
  assert.deepEqual(JSON.parse(await backup.makeBackup(1760000000000).blob.text()), clone(doc), 'and the store is as it was');
}

/* the validator changes nothing in a file the app wrote itself */
const original = store.exportRecords();
const withDeviceFields = (records) => ({ ...records, meetings: records.meetings.map((m) => ({ ...m, recording: null, jobs: { transcribe: null, summarise: null }, lastError: null })) });
assert.deepEqual(backup.cleanRecords(clone(doc.records)), withDeviceFields(clone(doc.records)), 'cleanRecords keeps every field of a real export');
assert.deepEqual(backup.cleanRecords(backup.cleanRecords(clone(doc.records))), backup.cleanRecords(clone(doc.records)), 'cleanRecords is idempotent');

/* ── import into a fresh profile: everything is there ────────────────── */

const blob = backup.makeBackup().blob;
const subscriber = S.plan.subscriberId;
store.noteFileBackup(1700000000000);   // a backup was made on this device at some point
assert.ok(!(await backup.makeBackup().blob.text()).includes('lastFileBackupAt') && !(await backup.makeBackup().blob.text()).includes('1700000000000'), 'when a backup was made is never in a file');
/* a "fresh profile": another document under the same roof */
S.lists = [{ id: 'solo', name: 'Solo', lanes: store.defaultLanes() }];
S.tasks = [store.blankTask('solo', 'Only here')];
S.notes = []; S.labels = []; S.currentList = 'solo';
S.meetings = [{ ...store.blankMeeting(), id: 'gone', recording: { key: 'rec-gone', mimeType: 'audio/webm', durationMs: 1, sizeBytes: 1, recordedAt: 1 } },
  { ...clone(original.meetings.find((m) => m.id === meeting.id)), title: 'Local title' }];
S.ai.proxyUrl = 'https://dev.example.test'; S.theme = 'dark';
store.save();
renders = 0; commits = 0; removed.length = 0;

let asked = null;
const result = await backup.importFile(blob, { confirm: (info) => { asked = info; return true; } });
assert.deepEqual(result.counts, { boards: original.lists.length, tasks: original.tasks.length, notes: original.notes.length, meetings: 2 });
assert.deepEqual(asked.counts, result.counts);
assert.deepEqual(asked.current, { boards: 1, tasks: 1, notes: 0, meetings: 2 });
assert.equal(asked.recordingsLost, 1, 'only the meeting that goes loses its recording');
assert.ok(Number.isFinite(asked.exportedAt) && asked.exportedAt > 0, 'the confirmation is told when the backup was made');
assert.equal(S.lastFileBackupAt, 1700000000000, 'a restore leaves the time of the last backup on this device alone');
assert.equal(JSON.parse(localStorage.getItem(store.STORE_KEY)).lastFileBackupAt, 1700000000000, 'and it is on disk');

const after = store.exportRecords();
assert.deepEqual(after.lists, original.lists, 'every board and lane');
assert.deepEqual(after.tasks, original.tasks, 'every task, field for field');
assert.deepEqual(after.notes, original.notes, 'every note, field for field');
assert.deepEqual(after.settings, original.settings);
const strip = ({ recording, jobs, lastError, ...m }) => m;
assert.deepEqual(after.meetings.map(strip), original.meetings.map(strip), 'every meeting with transcript, minutes and actions');
assert.equal(store.meetingById(meeting.id).recording.key, `rec-${meeting.id}`, 'a meeting already on the device keeps its recording');
assert.equal(store.meetingById(second.id).recording, null, 'a recording never arrives through the file');
assert.deepEqual(removed, ['rec-gone'], 'the recording of a meeting that went is removed');
assert.equal(S.currentList, original.lists[0].id, 'the current board is one that exists');
assert.equal(S.plan.subscriberId, subscriber, 'the device keeps its subscriber id');
assert.equal(S.ai.proxyUrl, 'https://dev.example.test', 'the device keeps its AI settings');
assert.equal(S.theme, 'dark', 'the device keeps its theme');
assert.deepEqual(JSON.parse(mem.get(store.STORE_KEY)).tasks, original.tasks, 'saved');
assert.ok(renders === 1 && commits === 1, 'one render, one after-commit');

/* declining the confirmation changes nothing */
const untouched = JSON.stringify(S);
assert.equal(await backup.importFile(blob, { confirm: () => false }), null);
assert.equal(JSON.stringify(S), untouched);

/* ── refusals ────────────────────────────────────────────────────────── */

const good = () => clone(doc);
const mutate = (fn) => { const d = good(); fn(d.records, d); return file(d); };

await rejects(file('not json at all'), 'not_stackd', 'text that is not JSON');
await rejects(file('[1,2,3]'), 'not_stackd', 'JSON that is not a document');
await rejects(mutate((r, d) => { d.app = 'other'; }), 'not_stackd', 'another app');
await rejects(mutate((r, d) => { d.format = backup.FILE_FORMAT + 1; }), 'newer', 'a newer format');
await rejects(mutate((r, d) => { delete d.records; }), 'bad_file', 'no records');
await rejects(mutate((r) => { r.lists = []; }), 'bad_file', 'no boards');
await rejects(mutate((r) => { r.lists.forEach((l) => { l.status = 'deleted'; l.deletedAt = 1; }); }), 'bad_file', 'no board that is not archived or deleted');
/* 1.6.0 (PRD-improvements US-02, US-10): a board keeps its status and dates, and Done comes back last */
{
  const r = clone(doc.records);
  r.lists.push({ id: 'awayboard', name: 'Away', lanes: [{ id: 'done', name: 'Finished' }, { id: 'backlog', name: 'Backlog' }], status: 'archived', archivedAt: 5, deletedAt: null });
  const away = backup.cleanRecords(r).lists.at(-1);
  assert.deepEqual([away.status, away.archivedAt, away.deletedAt], ['archived', 5, null], 'an archived board stays archived');
  assert.deepEqual(away.lanes, [{ id: 'backlog', name: 'Backlog' }, { id: 'done', name: 'Finished' }], 'Done is last and keeps its name');
  assert.ok(backup.cleanRecords(clone(doc.records)).lists.every((l) => l.status === 'active' && l.archivedAt === null && l.deletedAt === null));
}
await rejects(mutate((r) => { r.tasks = 'x'; }), 'bad_file', 'tasks that are not a list');
await rejects(mutate((r) => { r.tasks[0].id = '"><img src=x onerror=alert(1)>'; }), 'bad_file', 'markup in a task id');
await rejects(mutate((r) => { r.lists[0].id = 'a b'; }), 'bad_file', 'a space in a board id');
await rejects(mutate((r) => { r.lists[0].lanes[0].id = '<b>'; }), 'bad_file', 'markup in a lane id');
await rejects(mutate((r) => { r.tasks[1].id = r.tasks[0].id; }), 'bad_file', 'two tasks with one id');
await rejects(mutate((r) => { r.notes[0].checklist[0].id = '__proto__'; }), 'bad_file', 'a reserved name as an id');
await rejects(mutate((r) => { r.settings.priorities[0].id = 'none'; }), 'bad_file', 'a priority called none');
await rejects(mutate((r) => { r.meetings.find((m) => m.transcript).transcript.segments[0].speaker = '<i>'; }), 'bad_file', 'markup in a speaker label');
await rejects(mutate((r) => { r.meetings.find((m) => m.transcript).transcript.speakers = JSON.parse('{"__proto__": "x"}'); }), 'bad_file', '__proto__ as a speaker');
await rejects(mutate((r) => { r.tasks = Array.from({ length: backup.MAX_RECORDS + 1 }, (_, i) => ({ id: `t${i}`, listId: 'work', title: 'x' })); }), 'bad_file', 'too many records');
await rejects({ size: backup.MAX_FILE_BYTES + 1, text: async () => '{}' }, 'too_large', 'a file over the limit');

/* other files an app called Stack'd writes are refused by name, not as "not a backup" */
{
  const says = async (value, pattern) => {
    await assert.rejects(() => backup.importFile(file(value)), (e) => e instanceof backup.ImportError && e.code === 'not_stackd' && pattern.test(e.message), String(pattern));
  };
  await says({ app: 'stackd-account-export', exportedAt: 1, records: [] }, /Export my data/);
  await says({ format: 'stackd-backup', app: "Stack'd 1.3.1", accounts: [] }, /Stack'd Finance/);
  await says([{ title: 'a list of tasks' }], /not a Stack'd Minimalist backup/);
  await says('not json at all', /not a Stack'd Minimalist backup/);
}

/* signed in: the account is the copy */
mem.set('stackd-account', '{}');
assert.equal(backup.canImport(), false);
await rejects(blob, 'signed_in', 'import while signed in');
mem.delete('stackd-account');
assert.equal(backup.canImport(), true);

/* storage refuses the document: everything stays, no recording is removed */
removed.length = 0;
failWrites = true;
await rejects(mutate((r) => { r.meetings = []; r.tasks = []; }), 'storage', 'a document that does not fit');
failWrites = false;
assert.deepEqual(removed, []);
assert.ok(store.meetingById(meeting.id), 'the meetings are still there');

/* ── a hostile but well-formed file is made harmless ─────────────────── */

const hostile = mutate((r, d) => {
  const t = r.tasks[0];
  Object.assign(t, {
    listId: 'nowhere', lane: '<lane>', priority: '"><script>', status: 'weird', order: '<img>', done: 'yes',
    due: '2026-13-45', dueTime: '99:99', recur: 'hourly', reminder: 7, reminderFiredAt: '<x>', completedCount: -3,
    tags: ['ok', 5, { a: 1 }, '#dup', 'DUP'], subtasks: [{ id: 's1', title: 5, done: 1 }],
    origin: { listId: '<x>', lane: 'y', order: 1 }, from: { meetingId: '<m>', actionId: 'a' },
    createdAt: 'yesterday', updatedAt: -5, injected: '<script>alert(1)</script>',
    description: 'Hi<script>alert(1)</script> <i onmouseover="x">there</i><img src=x onerror=alert(3)>',
  });
  delete r.tasks[1].description;      // a file written by 1.6.0
  r.tasks[2].description = 5;         // not text
  r.notes[0].body = 'Hi<script>alert(1)</script><img src=x onerror=alert(2)> <b onclick="x()">bold</b>';
  r.notes[0].color = 'javascript:alert(1)';
  r.settings.priorities[0].color = 'red" onmouseover="x';
  r.settings.dateFormat = '<fmt>';
  r.lists[1].lanes = [];
  r.meetings[0].recording = { key: '../../etc', mimeType: 'x', durationMs: '<b>', sizeBytes: 1, recordedAt: 1 };
  r.meetings[0].jobs = { transcribe: { id: 'job_x', startedAt: 1, phase: 'wait' }, summarise: null };
  r.plan = { tier: 'max', subscriberId: 'someoneelse0001' };
  r.ai = { proxyUrl: 'https://attacker.example', disclosed: true, consented: true };
  d.records.theme = 'dark'; d.onboarded = false; r.currentList = '<x>';
});
const dateFormat = S.dateFormat;
S.meetings.forEach((m) => { m.recording = null; });
await backup.importFile(hostile);
const h = S.tasks[0];
assert.equal(h.listId, S.lists[0].id, 'an unknown board falls back to the first one');
assert.ok(store.lanesOf(h.listId).some((l) => l.id === h.lane), 'an unknown lane falls back to one the board has');
assert.deepEqual(
  { priority: h.priority, status: h.status, done: h.done, due: h.due, dueTime: h.dueTime, recur: h.recur, reminder: h.reminder, reminderFiredAt: h.reminderFiredAt, completedCount: h.completedCount, origin: h.origin, from: h.from },
  { priority: 'none', status: 'active', done: false, due: null, dueTime: null, recur: 'none', reminder: null, reminderFiredAt: null, completedCount: 0, origin: null, from: null },
);
assert.equal(typeof h.order, 'number');
assert.deepEqual(h.tags, ['ok', 'dup']);
assert.deepEqual(h.subtasks, [{ id: 's1', title: '', done: false }]);
assert.ok(Number.isFinite(h.createdAt) && h.updatedAt >= h.createdAt);
assert.ok(!('injected' in h), 'unknown fields are dropped');
assert.equal(h.description, 'Hi <i>there</i>', 'a description passes the sanitiser (1.7.0)');
assert.ok(!('description' in S.tasks[1]) && !('description' in S.tasks[2]), 'no description in the file: none is made up, so sync can tell an old record apart');
const n = S.notes[0];
assert.equal(n.body, 'Hi <b>bold</b>', 'a note body passes the sanitiser');
assert.equal(n.color, null);
assert.equal(S.priorities[0].color, 'gray');
assert.equal(S.dateFormat, dateFormat, 'an unknown date format leaves the device setting alone');
assert.deepEqual(S.lists[1].lanes, store.defaultLanes(), 'a board without lanes gets the built-in ones');
assert.ok(S.meetings.every((m) => m.recording === null && m.jobs.transcribe === null), 'a file cannot bring a recording or a job');
assert.equal(S.plan.subscriberId, subscriber, 'a file cannot set the subscriber id');
assert.notEqual(S.plan.tier, 'max', 'a file cannot set the plan');
assert.equal(S.ai.proxyUrl, 'https://dev.example.test', 'a file cannot point the AI steps at another server');
assert.equal(S.theme, 'dark');
assert.ok(store.listById(S.currentList), 'the current board exists');
const stored = mem.get(store.STORE_KEY);
for (const s of ['<script', 'onerror', 'onclick', 'onmouseover', 'attacker.example', 'someoneelse0001', 'javascript:']) {
  assert.ok(!stored.includes(s), `"${s}" did not reach the stored document`);
}

/* a reminder whose moment passed while the file travelled is not fired on arrival */
const past = mutate((r) => {
  Object.assign(r.tasks[1], { status: 'active', archivedAt: null, deletedAt: null, origin: null, done: false, due: '2020-01-01', dueTime: '09:00', reminder: 0, reminderFiredAt: null });
});
await backup.importFile(past);
assert.equal(typeof S.tasks[1].reminderFiredAt, 'number', 'a past reminder arrives used');

console.log('check-backup: export, round trip, refusals and sanitising all pass');
