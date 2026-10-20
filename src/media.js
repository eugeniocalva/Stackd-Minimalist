/* Recordings on the device (PRD-meetings AC-04.4, AC-04.6; architecture
   §18, §22): the only module that touches IndexedDB. Database
   'stackd-media', two stores: 'recordings' (one row per recording: key,
   meetingId, mimeType, durationMs, sizeBytes, updatedAt) and 'chunks'
   (one row per MediaRecorder slice, keyed [key, index]), so a 30-minute
   recording is written as it happens, five seconds at a time, and never
   rewritten whole. A crash keeps the chunks written so far. The main
   document (localStorage) only ever holds the key. */

export const DB = 'stackd-media';
const VERSION = 1;
const RECS = 'recordings', CHUNKS = 'chunks';

export const available = () => typeof indexedDB !== 'undefined';
export const keyFor = (meetingId) => `rec-${meetingId}`;

let dbPromise = null;
function open() {
  if (!available()) return Promise.reject(new Error('IndexedDB is not available'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECS)) db.createObjectStore(RECS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['key', 'i'] });
    };
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbPromise = null; }; resolve(req.result); };
    req.onerror = () => { dbPromise = null; reject(req.error); };
    req.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
  return dbPromise;
}

const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
const result = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const range = (key) => IDBKeyRange.bound([key, 0], [key, Number.MAX_SAFE_INTEGER]);

/** Start a recording row (no chunks yet). */
export async function begin(key, { meetingId, mimeType }) {
  const db = await open();
  const tx = db.transaction([RECS, CHUNKS], 'readwrite');
  tx.objectStore(RECS).put({ key, meetingId, mimeType, durationMs: 0, sizeBytes: 0, chunks: 0, updatedAt: Date.now() });
  tx.objectStore(CHUNKS).delete(range(key));
  await done(tx);
}

/** One MediaRecorder slice; the row's size, chunk count and duration follow. */
export async function append(key, chunk, durationMs) {
  const db = await open();
  const tx = db.transaction([RECS, CHUNKS], 'readwrite');
  const recs = tx.objectStore(RECS);
  const row = await result(recs.get(key));
  if (!row) throw new Error('recording row missing');
  tx.objectStore(CHUNKS).put({ key, i: row.chunks, blob: chunk });
  recs.put({ ...row, chunks: row.chunks + 1, sizeBytes: row.sizeBytes + chunk.size, durationMs, updatedAt: Date.now() });
  await done(tx);
  return { chunks: row.chunks + 1, sizeBytes: row.sizeBytes + chunk.size };
}

/** The final duration once the recorder has stopped. */
export async function finish(key, durationMs) {
  const db = await open();
  const tx = db.transaction(RECS, 'readwrite');
  const row = await result(tx.objectStore(RECS).get(key));
  if (row) tx.objectStore(RECS).put({ ...row, durationMs, updatedAt: Date.now() });
  await done(tx);
  return row ? { ...row, durationMs } : null;
}

export async function get(key) {
  const db = await open();
  return result(db.transaction(RECS).objectStore(RECS).get(key)) || null;
}

/** All rows (without chunks). */
export async function list() {
  const db = await open();
  return result(db.transaction(RECS).objectStore(RECS).getAll()) || [];
}

/** The whole recording as one Blob, for playback and upload; null when absent. */
export async function blob(key) {
  const db = await open();
  const tx = db.transaction([RECS, CHUNKS]);
  const row = await result(tx.objectStore(RECS).get(key));
  if (!row) return null;
  const rows = await result(tx.objectStore(CHUNKS).getAll(range(key)));
  rows.sort((a, b) => a.i - b.i);
  return new Blob(rows.map((r) => r.blob), { type: row.mimeType });
}

export async function remove(key) {
  if (!available()) return;
  const db = await open();
  const tx = db.transaction([RECS, CHUNKS], 'readwrite');
  tx.objectStore(RECS).delete(key);
  tx.objectStore(CHUNKS).delete(range(key));
  await done(tx);
}

export async function size(key) { return (await get(key))?.sizeBytes || 0; }

/** Rows whose key is not in `referenced` (boot cleanup, architecture §19). */
export async function orphans(referenced) {
  const keep = new Set(referenced);
  return (await list()).filter((r) => !keep.has(r.key));
}

/* ── Storage (AC-04.6, AC-04.7) ──────────────────────────────────────── */

let persisted = null;
/** Ask once for persistent storage, so the browser does not evict the recordings. */
export async function persist() {
  if (persisted !== null) return persisted;
  try { persisted = navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { persisted = false; }
  return persisted;
}

/** { usage, quota, free } in bytes, or null when the browser will not say. */
export async function estimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e || typeof e.quota !== 'number') return null;
    return { usage: e.usage || 0, quota: e.quota, free: Math.max(0, e.quota - (e.usage || 0)) };
  } catch { return null; }
}

export const fmtBytes = (n) => (n >= 1024 * 1024 ? `${Math.round(n / 1024 / 1024 * 10) / 10} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
