/* Checks for the store age signal (docs/prd-age-signals.md, AC-02, AC-08) —
   `npm run check`: how each store answer is read, what each platform asks
   and when, that nothing is stored or sent, and the web doing nothing. */
import assert from 'node:assert/strict';

const age = await import('../src/agesignal.js');
const { read } = age;

/* reading (§04): Android ranges, iOS gates, and everything that is no answer */
assert.deepEqual(read({ status: 'SHARED', ageRange: { lowerBound: 18, ageRangeSource: 'TIER_C' } }), { age: 'adult', waiting: false }, 'Play 18+');
assert.deepEqual(read({ ageRange: { lowerBound: 18 } }), { age: 'adult', waiting: false }, 'getAgeRange has no status');
assert.deepEqual(read({ status: 'SHARED', ageRange: { lowerBound: 13, upperBound: 15 } }), { age: 'minor', waiting: false }, 'Play 13-15');
assert.deepEqual(read({ status: 'SHARED', ageRange: { upperBound: 17 } }), { age: 'minor', waiting: false }, 'iOS under the 18 gate');
assert.deepEqual(read({ status: 'SHARED', ageRange: { lowerBound: 16, upperBound: 17 }, significantChange: { status: 'PENDING' } }), { age: 'minor', waiting: true }, 'parent has not approved');
assert.deepEqual(read({ status: 'SHARED', ageRange: { lowerBound: 0, upperBound: 12 }, significantChange: { status: 'DECLINED' } }), { age: 'minor', waiting: true }, 'parent declined');
assert.deepEqual(read({ status: 'SHARED', ageRange: { lowerBound: 13, upperBound: 15 }, significantChange: { status: 'APPROVED', approvalDate: '2026-12-01T00:00:00.000Z' } }), { age: 'minor', waiting: false }, 'parent approved');
assert.deepEqual(read({ status: 'SHARED', ageRange: { lowerBound: 18 }, significantChange: { status: 'PENDING' } }), { age: 'adult', waiting: false }, 'an adult never waits');
for (const [r, why] of [
  [null, 'no result'],
  [{ status: 'NOT_SHARED' }, 'not shared'],
  [{ status: 'VERIFICATION_REQUIRED' }, 'verify in the Play Store first'],
  [{ status: 'UNSPECIFIED', ageRange: { lowerBound: 18 } }, 'unspecified counts as not shared'],
  [{ status: 'SHARED' }, 'shared without a range'],
  [{ status: 'SHARED', ageRange: { ageRangeSource: 'TIER_A' } }, 'a range without bounds'],
  [{ status: 'SHARED', ageRange: { lowerBound: 16 } }, 'straddles 18'],
]) assert.equal(read(r), null, why);

/* a fake store, the way the plugin answers on each platform */
const calls = [];
let next = {};
const plugin = {
  getAgeRange: async () => { calls.push('getAgeRange'); return next.get; },
  getRegulatoryRequirements: async () => { calls.push('getRegulatoryRequirements'); return next.req; },
  requestAgeRange: async (o) => { calls.push(`requestAgeRange ${JSON.stringify(o)}`); if (next.err) throw next.err; return next.request; },
};
let os = 'android';
globalThis.Capacitor = { isNativePlatform: () => os !== 'web', getPlatform: () => os, Plugins: { AgeSignals: plugin } };
const fresh = () => { age.useFake(undefined); calls.length = 0; };

/* Android, at launch: reads what Play shares, never prompts */
fresh(); next = { get: { ageRange: { lowerBound: 13, upperBound: 15 }, significantChange: { status: 'PENDING' } } };
assert.deepEqual(await age.check(), { age: 'minor', waiting: true });
assert.deepEqual(calls, ['getAgeRange']);
assert.equal(age.waiting(), true); assert.equal(age.isMinor(), true);

/* the parent approves; the next check (the app comes back) lets the app open, and says so */
let told = null;
const off = age.onChange((a) => { told = a; });
next.get = { ageRange: { lowerBound: 13, upperBound: 15 }, significantChange: { status: 'APPROVED' } };
await age.check();
assert.equal(age.waiting(), false); assert.deepEqual(told, { age: 'minor', waiting: false });
off();

/* Android, when needed: may prompt, with the 18 gate; an answer is not asked again */
fresh(); next = { request: { status: 'SHARED', ageRange: { lowerBound: 18 } } };
assert.deepEqual(await age.ask(), { age: 'adult', waiting: false });
await age.ask();
assert.deepEqual(calls, ['requestAgeRange {"ageGates":[18]}']);

/* a failing store is no answer, never an error */
fresh(); next = { err: new Error('API_NOT_AVAILABLE') };
assert.equal(await age.ask(), null);
next = { get: undefined }; plugin.getAgeRange = async () => { throw new Error('APP_NOT_OWNED'); };
assert.equal(await age.check(), null);

/* iOS, at launch: the sheet only where Apple says the law applies */
os = 'ios';
fresh(); next = { req: { ageAssuranceRequired: false, regulatoryFeatures: [] } };
assert.equal(await age.check(), null);
assert.deepEqual(calls, ['getRegulatoryRequirements'], 'no sheet outside the regulated regions');
fresh(); next = { req: { ageAssuranceRequired: true, regulatoryFeatures: ['DECLARED_AGE_RANGE_REQUIRED'] }, request: { status: 'SHARED', ageRange: { upperBound: 17 } } };
assert.deepEqual(await age.check(), { age: 'minor', waiting: false });
assert.deepEqual(calls, ['getRegulatoryRequirements', 'requestAgeRange {"ageGates":[18]}']);
fresh(); next = { request: { status: 'NOT_SHARED' } };
assert.equal(await age.ask(), null, 'a declined sheet is no answer');

/* the web: no store, nothing asked, nothing decided (AC-06) */
os = 'web';
fresh();
assert.equal(await age.check(), null); assert.equal(await age.ask(), null);
assert.deepEqual(calls, []);
assert.equal(age.isMinor(), false); assert.equal(age.waiting(), false);

/* never stored, never sent (AC-02): the module has no storage, network or log */
const src = (await import('node:fs')).readFileSync(new URL('../src/agesignal.js', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const word of ['localStorage', 'sessionStorage', 'indexedDB', 'fetch', 'XMLHttpRequest', 'sendBeacon', 'console', 'import ']) {
  assert.equal(src.includes(word), false, `agesignal.js must not use ${word.trim()}`);
}

console.log('check-age: store answers, Android and iOS asks, failures, web and no storage pass');
