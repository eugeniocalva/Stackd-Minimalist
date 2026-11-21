/* Checks for the app lock and the age step (architecture §37) — `npm run
   check`: the lock timing, the offline waits, the device verifier, the
   age boundary and its 24-hour refusal, and an offline unlock. */
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.document = { getElementById: () => null, activeElement: null, addEventListener() {}, visibilityState: 'visible' };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true, userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }, configurable: true });

const lock = await import('../src/lock.js');
const account = await import('../src/account.js');
const net = await import('../src/net.js');

/* timing (AC-07.2) */
const M = 60_000;
assert.equal(lock.shouldLock({ after: 'off', booting: true }), false, 'off never locks');
assert.equal(lock.shouldLock({ after: '5m', booting: true }), true, 'opening the app locks');
assert.equal(lock.shouldLock({ after: '5m', lastActiveAt: 0, now: 5 * M - 1 }), false);
assert.equal(lock.shouldLock({ after: '5m', lastActiveAt: 0, now: 5 * M }), true);
assert.equal(lock.shouldLock({ after: '1h', lastActiveAt: 0, now: 59 * M }), false);
assert.equal(lock.shouldLock({ after: '1h', lastActiveAt: 0, now: 60 * M }), true);
assert.equal(lock.shouldLock({ after: 'immediately', lastActiveAt: 10, now: 10 }), true);

/* offline waits (AC-07.5) */
assert.deepEqual([1, 2, 3, 4].map(lock.backoffMs), [0, 0, 0, 0]);
assert.deepEqual([5, 6, 7].map(lock.backoffMs), [30_000, 60_000, 120_000]);

/* the device verifier: right and wrong PIN, no PIN in it */
const v = await lock.makeVerifier('2580');
assert.ok(await lock.checkVerifier('2580', v));
assert.ok(!await lock.checkVerifier('2581', v));
assert.ok(!JSON.stringify(v).includes('2580'));
assert.ok(!await lock.checkVerifier('2580', null));

/* age (AC-02.2, AC-02.3): younger than 18 on 1 January of this year is refused, for 24 hours */
const jan = new Date(2026, 5, 1);
assert.equal(account.checkAge(2007, jan), true, '19 this year, so 18 on 1 January');
assert.equal(account.ageRefusedUntil(jan.getTime()), 0);
assert.equal(account.checkAge(2008, jan), false, 'may still be 17 on 1 January');
assert.ok(account.ageRefusedUntil(jan.getTime() + 1000) > jan.getTime());
assert.equal(account.ageRefusedUntil(jan.getTime() + 24 * 3600_000 + 1), 0, 'the refusal lasts a day');
assert.equal(account.checkAge('', jan), false);

/* labels (AC-04.3) */
assert.equal(account.deviceLabel('Mozilla/5.0 (Windows NT 10.0)', 'web'), 'Browser on Windows');
assert.equal(account.deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)', 'web'), 'Browser on macOS');
assert.equal(account.deviceLabel('', 'ios'), 'iPhone');

/* signed out: no lock (AC-07.7) */
lock.init();
assert.equal(lock.locked(), false);
lock.lock();
assert.equal(lock.locked(), false, 'a signed-out device has no PIN to ask for');

/* a signed-in device, offline: the device verifier unlocks, with waits after five wrong */
localStorage.setItem(account.ACCOUNT_KEY, JSON.stringify({ userId: 'u'.repeat(24), email: 'x@example.com', lock: { after: '5m', biometrics: false }, verifier: v, offlineFails: 0, offlineWaitUntil: 0 }));
account.init();
lock.lock();
assert.equal(lock.locked(), true);
net.setFetch(async () => { throw new TypeError('Failed to fetch'); });
for (let i = 0; i < 4; i++) assert.equal((await lock.unlockWithPin('1111')).code, 'pin_wrong');
const fifth = await lock.unlockWithPin('1111');
assert.deepEqual([fifth.code, fifth.waitMs], ['wait', 30_000]);
assert.equal((await lock.unlockWithPin('2580')).code, 'wait', 'even the right PIN waits');
account.patch({ offlineWaitUntil: 0 });
assert.equal((await lock.unlockWithPin('2580')).ok, true, 'offline, the right PIN opens the app (AC-07.3)');
assert.equal(lock.locked(), false);

console.log('check-lock: timing, waits, verifier, age and offline unlock pass');
