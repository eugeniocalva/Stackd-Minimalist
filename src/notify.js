/* Reminder notifications (PRD US-10): the platform side of src/reminders.js.

   Web / PWA (AC-10.1): while the app is open, one tab at a time (the holder
   of a Web Lock) checks every 60 s and whenever the page comes back into
   view, and shows due reminders through the service worker. Each occurrence
   fires once: task.reminderFiredAt plus a small cross-tab ledger in
   localStorage that whole-document saves from other tabs cannot erase.

   Native (AC-10.2): Capacitor iOS injects window.Capacitor.Plugins.
   LocalNotifications before any page script runs, so it is used directly —
   no bundler and no @capacitor/core import (a bare import would blank the
   app). Pending notifications are reconciled with the wanted set after every
   change, at launch and on resume; iOS fires them even when the app is
   closed. Nothing is scheduled until permission is granted, because the
   plugin's schedule() would otherwise prompt on its own.

   Permission is only ever requested from a tap: the dates dialog's Save. */

import { S, STORE_KEY, markReminderFired } from './store.js';
import {
  planReminders, dueForWeb, ledgerKey, pruneLedger, summaryText,
  nativePlan, diffNative, nativeNotification, pastUnfired, deliveredSince, heldRequests, isTimely, SUMMARY_AT,
} from './reminders.js';

const LEDGER_KEY = 'stackd-reminders-fired';
const SCHEDULED_KEY = 'stackd-native-scheduled';
const CHECK_MS = 60000;

const plugin = () => globalThis.Capacitor?.Plugins?.LocalNotifications;
/** Inside the Capacitor app, with the LocalNotifications plugin installed. */
export const isNative = () =>
  !!(globalThis.Capacitor?.isNativePlatform?.() && typeof plugin()?.schedule === 'function');

let nativePermission = 'default';
const fromNative = (display) => (display === 'granted' || display === 'denied' ? display : 'default');

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

/** Where reminders stand on this device: 'granted', 'default' (not asked
    yet), 'denied', 'install' (an iPhone Safari tab: only Home Screen apps
    may notify) or 'unsupported'. */
export function reminderPermission() {
  if (isNative()) return nativePermission;
  if (isIOS() && !isStandalone()) return 'install';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission === 'granted' || Notification.permission === 'denied' ? Notification.permission : 'default';
}

/** Ask to allow notifications. Call it synchronously from a tap: browsers
    ignore or block a prompt that no gesture started. Resolves to the new
    reminderPermission() value. */
export function requestReminderPermission() {
  if (isNative()) {
    return Promise.resolve(plugin().requestPermissions())
      .then((r) => { nativePermission = fromNative(r?.display); syncReminders(); return nativePermission; })
      .catch(() => nativePermission);
  }
  if (reminderPermission() !== 'default') return Promise.resolve(reminderPermission());
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(reminderPermission()); } };
    try {
      const p = Notification.requestPermission(done); // older Safari only calls back
      if (p && typeof p.then === 'function') p.then(done, done);
    } catch { done(); }
  }).then((state) => { if (state === 'granted') checkNow(); return state; });
}

/* ── Web: check, fire, de-duplicate ──────────────────────────────────── */

let openTaskFn = () => {};
let checking = false;
/** Occurrences this tab already handled. Storage writes can fail (quota,
    private mode); this keeps a failed write from re-firing every minute. */
const handledHere = new Set();

const readJSON = (key) => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } };
const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full or blocked */ } };

/** Fire every web reminder whose moment has come. Reads the stored document,
    which holds every tab's latest edits, rather than this tab's memory. */
export async function checkNow() {
  if (isNative() || checking || reminderPermission() !== 'granted') return;
  checking = true;
  try {
    const doc = readJSON(STORE_KEY) || S;
    const now = Date.now();
    const ledger = pruneLedger(readJSON(LEDGER_KEY) || {}, now);
    const handled = { ...ledger };
    for (const k of handledHere) handled[k] = now;
    const { fire, lapse } = dueForWeb(planReminders(doc.tasks || [], doc.lists || []), now, handled);
    if (!fire.length && !lapse.length) return;
    /* record first: a slow or failing show() must never lead to a repeat */
    for (const e of [...fire, ...lapse]) {
      handledHere.add(ledgerKey(e));
      ledger[ledgerKey(e)] = now;
      markReminderFired(e.taskId, now);
    }
    writeJSON(LEDGER_KEY, ledger);
    if (fire.length >= SUMMARY_AT) {
      await show({ ...summaryText(fire), tag: `reminders:${now}`, taskId: fire[0].taskId });
    } else {
      for (const e of fire) await show({ title: e.title, body: e.body, tag: `reminder:${ledgerKey(e)}`, taskId: e.taskId });
    }
  } finally {
    checking = false;
  }
}

/** Show one notification. The service worker path is the only one that
    works on Android Chrome (its Notification constructor throws) and on
    iPhone Home Screen apps; the constructor is a desktop fallback. */
async function show({ title, body, tag, taskId }) {
  const options = { body, tag, data: { taskId }, icon: new URL('icons/icon-192.png', document.baseURI).href, lang: 'en' };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg?.active) { await reg.showNotification(title, options); return; }
  } catch { /* fall back to the page-level constructor */ }
  try {
    const n = new Notification(title, options);
    n.onclick = () => { window.focus(); openTaskFn(taskId); n.close(); };
  } catch { /* no constructor here (Android Chrome); nothing else to try */ }
}

function startWebClock() {
  if (typeof Notification === 'undefined') return;
  const run = () => {
    checkNow();
    setInterval(checkNow, CHECK_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkNow(); });
    addEventListener('focus', checkNow);
    addEventListener('pageshow', checkNow);
  };
  /* one tab checks at a time; the lock passes to another tab when it closes */
  if (navigator.locks?.request) {
    navigator.locks.request('stackd-reminder-clock', () => new Promise(() => run())).catch(run);
  } else run();
}

/* ── Native: reconcile pending notifications ─────────────────────────── */

let syncing = null;
let dirty = false;

/** Make the iOS pending notifications match the tasks. Safe to call after
    every change: one pass runs at a time, and calls made meanwhile coalesce
    into one more pass. Never commits or re-renders. */
export function syncReminders() {
  if (!isNative()) return;
  if (syncing) { dirty = true; return; }
  syncing = (async () => {
    try {
      do { dirty = false; await syncOnce(); } while (dirty);
    } catch (e) {
      console.warn("Stack'd: reminder sync failed", e);
    } finally {
      syncing = null;
    }
  })();
}

async function syncOnce() {
  const ln = plugin();
  nativePermission = fromNative((await ln.checkPermissions())?.display);
  const granted = nativePermission === 'granted';
  const pending = (await ln.getPending())?.notifications || [];
  const record = readJSON(SCHEDULED_KEY) || {};
  const pendingByTask = new Map(pending.filter((p) => p.extra?.taskId).map((p) => [p.extra.taskId, p]));
  let now = Date.now();

  /* 1. record what iOS delivered since last time, so a time-zone change
        cannot bring it back (marking writes storage, never commits) */
  for (const d of deliveredSince(record, new Set(pendingByTask.keys()), S.tasks, now)) markReminderFired(d.taskId, d.fireAt);

  /* 2. retire armed reminders whose moment passed, unless iOS still holds
        the request (it will deliver it) or it is still timely (it will be
        delivered now, like a late web reminder) */
  let plan = planReminders(S.tasks, S.lists);
  const held = heldRequests(plan, pendingByTask, record);
  for (const e of pastUnfired(plan, now)) {
    if (!held.has(e.taskId) && !isTimely(e, now)) markReminderFired(e.taskId, now);
  }

  /* 3. make pending match the wanted set. Without permission nothing is
        scheduled (schedule() would prompt by itself), but stale requests
        for changed, done, archived or deleted tasks are still cancelled. */
  now = Date.now();
  plan = planReminders(S.tasks, S.lists);
  const desired = nativePlan(plan, now, held);
  const { cancel, schedule } = diffNative(desired, pending, { allowSchedule: granted });
  if (cancel.length) await ln.cancel({ notifications: cancel.map((id) => ({ id })) }); // iOS rejects an empty list
  if (schedule.length) await ln.schedule({ notifications: schedule.map((e) => nativeNotification(e, Date.now())) });

  /* 4. remember what is pending now, in absolute time (a held request
        keeps the time it was scheduled for) */
  const stillPending = new Map(pending.map((p) => [Number(p.id), p.extra?.sig ?? null]));
  const live = granted ? desired : desired.filter((e) => stillPending.get(e.id) === e.sig);
  writeJSON(SCHEDULED_KEY, Object.fromEntries(live.map((e) => [e.taskId, e.held ? record[e.taskId] : { fireAt: e.fireAt, key: e.key }])));
}

function startNative() {
  plugin().addListener?.('localNotificationActionPerformed', (e) => {
    const id = e?.notification?.extra?.taskId;
    if (id) openTaskFn(id);
  });
  document.addEventListener('resume', syncReminders); // Capacitor's foreground event
  syncReminders();
}

/* ── Boot ────────────────────────────────────────────────────────────── */

/** Start reminders once the first render is done. openTask(id) shows a task
    when a notification is tapped. */
export function initReminders({ openTask }) {
  openTaskFn = openTask;
  if (isNative()) startNative();
  else startWebClock();
  /* a tap handled by the service worker asks an open window to show the task */
  if (navigator.serviceWorker?.addEventListener) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-task' && e.data.id) openTaskFn(e.data.id);
    });
    navigator.serviceWorker.startMessages?.();
  }
  /* …or opens the app at #task=<id> */
  const m = location.hash.match(/^#task=([\w-]+)$/);
  if (m) {
    history.replaceState(null, '', location.pathname + location.search);
    openTaskFn(m[1]);
  }
}
