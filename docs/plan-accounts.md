# Plan: accounts, sync across devices, and registration compliance

Status: plan, 2026-11-13. Target release 1.6.0. Superseded in detail by
the PRD (`docs/prd-accounts.md`) and by Part IV of
`docs/architecture.md` (§28 onwards), which are the documents to build
from; this file stays as the record of the reasoning and of the
compliance checklist (§4, §5).

Not legal advice. The compliance section is an engineering checklist; have
a lawyer read the new Terms and Privacy Policy before the release.

---

## 1. Decisions taken (owner, 2026-11-13)

| Question | Decision |
|---|---|
| Is an account required? | **Optional.** The app keeps working with no account; signing in turns on sync. |
| How do people sign in? | **Email code, then a 4-digit PIN** set in the app. The PIN is the same on phone and PC and can be replaced by the device's biometrics (Face ID, Touch ID, Android fingerprint, Windows Hello). |
| What syncs in the first version? | **Everything except audio.** Recordings stay on the device that made them. |
| Minimum age to register | **18+.** |

Confirmed by the owner: "usable with Apple ID" means *unlock with the
device's own Face ID / Touch ID*, not a "Sign in with Apple" button.
Sign in with Apple / Google buttons are out of scope (§8).

---

## 2. Where the app is today

- All data is one JSON document in `localStorage['stackd-v2']`
  (`src/store.js`); recordings are blobs in IndexedDB (`src/media.js`).
- There is one server: the Cloudflare Worker in `proxy/`, with a KV
  namespace for allowance counters. It has no database and no notion of a
  user.
- Identity today is `S.plan.subscriberId`, a random id made on each
  device and sent as the `X-Stackd-Subscriber` header. It is not
  authenticated: whoever knows an id can spend that subscriber's allowance.
- A plan bought on the phone does not apply on the PC, because the PC has
  a different random id and the web cannot buy.
- The web app is served from `eugeniocalva.github.io/Stackd-Minimalist/`.
  That origin is shared with every other GitHub Pages project of the same
  GitHub account, so anything stored in the browser there (and soon a
  session) is readable by those other pages.

---

## 3. Target design

### 3.1 Backend: extend the existing Worker

One backend, not two. Add to `proxy/`:

- **D1** (Cloudflare's SQLite) with the **EU jurisdiction**, for users,
  sessions, login codes, the consent log and the synced records. D1 is
  transactional, which the PIN attempt counter and the sync revisions
  need; KV is not.
- **A transactional email sender** for the login code and the security
  notices, sending from `stackdplatform.com` with SPF, DKIM and DMARC.
  Provider is an owner choice in Phase 23 (one with an EU region and a
  data processing agreement).
- No file storage: audio does not sync.

Rejected: Supabase or Firebase. Either would work, but it adds a second
vendor, a client library to a codebase that has none, and a second place
where personal data lives.

### 3.2 Move the web app to its own domain first

Serve the web app from `app.stackdplatform.com`, hosted on Cloudflare
from the same repository. (First drafted as a GitHub Pages custom domain;
the architecture found that this redirects the old address, stranding
its data, and that GitHub Pages cannot send the security headers the
sign-in pages need.) Reasons for the move:

- The session can then be an `HttpOnly` cookie shared only between
  `app.` and `minimalist-api.stackdplatform.com`, which page scripts
  cannot read.
- The app stops sharing browser storage with other github.io projects.
- Terms, Privacy and the account-deletion page get stable URLs for the
  stores.

`localStorage` does not follow a domain change, so the old address keeps
working for one release with a banner: "Stack'd moved. Sign in at the new
address to bring your data", plus the existing data carried over through
the account (or a one-time export/import file for people who do not sign
in).

### 3.3 Sign-in flow

First time on any device:

1. **Age screen.** "What year were you born?" A neutral question, not a
   "I am over 18" tick box. Under 18: registration stops, the app keeps
   working without an account, and the device remembers the refusal so
   the form cannot simply be retried with another year.
2. **Email**, with the acceptance line: "By continuing you accept the
   Terms and the Privacy Policy" (both linked). No pre-ticked boxes.
3. **6-digit code** sent to that email; valid 10 minutes, 5 attempts.
4. **PIN.** A new account chooses a 4-digit PIN (entered twice). An
   existing account enters its PIN.
5. The device gets a session and sync starts.

So signing in on a new device needs two things: access to the mailbox
and the PIN. The PIN alone never signs anyone in from a device the
account has not seen. A forgotten PIN is reset with an email code alone,
so the mailbox is the root of trust, as with any reset by email; a reset
is never silent (below).

Every time after that, on a signed-in device: the app opens to a lock
screen that takes the PIN or the device biometrics (the lock can be set
to "after 5 minutes away" or turned off in Settings).

Rules that keep a 4-digit PIN safe enough:

- The server stores only a keyed, salted hash of the PIN (PBKDF2 plus a
  secret that lives in the Worker, not in the database).
- 5 wrong PINs lock the PIN. Unlocking needs a fresh email code and a new
  PIN.
- Changing or resetting the PIN signs out every other device and sends a
  notice to the email.
- Requests for codes are rate-limited per email and per IP, and the
  answer is the same whether or not the email has an account.

What the PIN is not: it is a lock on the app, not encryption. Data on
the device stays readable to someone who can open the browser's storage.
The Privacy Policy and the Settings text must not claim otherwise.

### 3.4 Biometrics

- **iOS / Android:** a Capacitor biometric plugin shows Face ID, Touch ID
  or the Android prompt in place of the PIN pad. The session token sits in
  the Keychain / Keystore. iOS needs `NSFaceIDUsageDescription`, added in
  the iOS workflow since the iOS project is generated in CI.
- **PC:** Windows Hello or Touch ID through the browser's WebAuthn
  platform authenticator, as a "Should". The PIN works everywhere, so PC
  biometrics can ship one release later without blocking.
- Stack'd never receives a fingerprint or a face. The operating system
  answers yes or no. The policy says so.

### 3.5 Sessions

- Web: `HttpOnly; Secure; SameSite=Strict` cookie, plus an Origin check
  and the existing `X-Stackd-App` header on every write.
- iOS / Android: a bearer token in the Keychain / Keystore (cookies do
  not work across the `capacitor://` origin).
- Tokens are random, stored hashed, expire after 90 days without use.
- Settings › Account lists the signed-in devices with "Sign out" and
  "Sign out everywhere". A new device sign-in sends a notice email.

### 3.6 Sync

Granularity: one record per board, task, note and meeting, plus one
shared-settings record (date format, priorities, labels). Not the whole
document, or the phone and the PC would overwrite each other.

| Syncs | Stays on the device |
|---|---|
| boards and lanes, tasks, notes, meetings with transcript, minutes and actions | the recording blob and `meeting.recording` |
| date format, priorities, labels | theme, current board, view, sort orders |
| | open AI jobs, `reminderFiredAt`, the note draft, UI state |
| | `ai.proxyUrl`, the plan cache |

How it works:

- A new `src/sync.js` keeps a shadow copy of what was last synced. After
  each `commit()` (through the existing `setAfterCommit` hook, debounced
  about 2 s) it compares records with the shadow, so no mutation in
  `store.js` has to be rewritten. A record missing locally becomes a
  tombstone.
- One endpoint, `POST /v1/sync { cursor, changes }`, pushes local changes
  and returns everything newer than the cursor. The server gives every
  accepted change a revision number.
- Conflict rule: the newer change wins per record; the server clamps
  timestamps to its own clock so a device with a wrong clock cannot win
  forever. The architecture gives sync its own change time per record,
  so the records' `updatedAt` is left alone and boards need no new field.
- Sync runs on start, on resume or focus, when the network returns, and
  after edits. No live socket in this version. A small status line in
  Settings and a dot in the shell show "Synced", "Syncing" or "Offline,
  will sync".
- Offline stays first-class: every edit lands locally and syncs later.

First sign-in on a device that already has data:

- Untouched demo data is dropped, so it is not duplicated per device.
- Account empty: the device's data is uploaded.
- Both have data: the user chooses "Merge this device into my account" or
  "Replace this device with my account". A backup of the local document
  is kept under a dated key for 30 days either way.

Sign-out asks "Keep a copy on this device" or "Remove it from this
device" (the default on a shared PC should be remove).

### 3.7 The plan follows the account

- After sign-in the app calls RevenueCat's `logIn(accountId)`, so
  purchases attach to the account, and the proxy resolves the plan from
  the session's account id instead of the header.
- Result: a plan bought on the phone works on the PC web app, and the
  allowance can no longer be spent by someone who learned a subscriber id.
- The old device id is stored on the account as `legacyId` so the current
  period's usage carries over. Testers move from device ids to account
  emails.
- Signed-out devices keep working exactly as today with the anonymous id.

### 3.8 Data model (D1)

```
users        id, email (unique), created_at, age_confirmed_at,
             terms_version, privacy_version, accepted_at,
             pin_hash, pin_salt, pin_fails, pin_locked_until,
             legacy_subscriber_id, deleted_at
login_codes  email_hash, code_hash, expires_at, attempts
sessions     id, user_id, token_hash, platform, device_label,
             created_at, last_seen_at, revoked_at
records      user_id, kind, id, rev, updated_at, deleted, data (JSON)
             PK (user_id, kind, id) · index (user_id, rev)
consent_log  user_id, what, version, at
```

The date of birth is not stored: only the fact and time that 18+ was
confirmed. No marketing column exists until marketing email exists.

### 3.9 New endpoints

```
POST /v1/auth/start      { email }                → always 204
POST /v1/auth/verify     { email, code }          → { needsPin | setPin, ticket }
POST /v1/auth/pin        { ticket, pin }          → session
POST /v1/auth/pin/reset  (fresh code required)    → session, others revoked
GET  /v1/account         → profile, devices
POST /v1/account/signout { all? }
GET  /v1/account/export  → all records as JSON
POST /v1/account/delete  (PIN or fresh code)      → everything purged
POST /v1/sync            { cursor, changes }      → { changes, cursor }
```

---

## 4. Compliance: the six risks from the two videos

Both videos list the same six. Where Stack'd stands and what registration
adds:

| # | Risk in the videos | Today | What this plan does |
|---|---|---|---|
| 1 | Signup never asks for age (COPPA, under 13) | No signup exists | Neutral birth-year screen, 18+, refusal remembered on the device, only the confirmation time stored. Terms say 18+. |
| 2 | Fonts loaded from Google's servers (GDPR, IP leak) | Already fine: Inter and Manrope are self-hosted in `fonts/` | A new check in `npm run check` fails the build on any third-party URL in HTML or CSS, and a Content-Security-Policy limits fonts, scripts and connections to our own origins. |
| 3 | Session replay or keystroke analytics on by default (California CIPA) | Already fine: no analytics at all | Stays none. The CSP makes it impossible to add one silently. Worker logs carry no email, IP or content. If analytics is ever wanted: consent first, inputs masked. |
| 4 | Marketing email with no unsubscribe link or postal address (CAN-SPAM) | No email is sent | Version 1 sends only account email (code, new device, PIN changed, account deleted), each with the sender's name and contact address in the footer. No newsletter. If one is added later: a separate, unticked opt-in at signup, an unsubscribe link and header in every message, a postal address, and a suppression list. |
| 5 | Subscription button without renewal terms next to it (California auto-renewal law) | Partly: the price is on each card, the renewal sentence is one paragraph below all cards (`src/ui/paywall.js`) | Each plan card states, directly above its button: price per month, renews automatically, cancel any time in App Store or Google Play settings. Same text in the "This needs a plan" sheet. |
| 6 | No registered DMCA agent for user uploads | Low exposure: nothing a user adds is shown to anyone else | Terms get a "Copyright complaints" contact. Registering an agent with the US Copyright Office (6 USD) becomes required the day content can be shared or made public; it is cheap enough to do now. |

---

## 5. Compliance the videos do not mention, but registration triggers

Holding emails and people's notes on a server makes Stack'd a data
controller under GDPR. These are part of the release, not extras.

**Must ship with 1.6.0**

- **Rewrite `privacy.html`.** It currently says "no accounts" and "no
  sync and no backup to any server run by us". Both become false. The new
  text needs: who the controller is and how to reach them, what is stored
  (email, synced content, device list, consent record), why (to provide
  the account and sync), where (EU), for how long, who processes it
  (Cloudflare, the email provider, RevenueCat, the speech-to-text and AI
  providers), transfers outside the EU, the user's rights and how to
  complain to a data protection authority.
- **Reword the meetings paragraph.** "Our server keeps none of it" stays
  true for Transcribe and Summarise, but transcripts and minutes of a
  signed-in user are stored by sync. The transcripts contain other
  people's words, so the Terms must say the user is responsible for
  having the right to store them.
- **Delete account, in the app and on a web page.** Apple requires in-app
  deletion for any app with accounts; Google Play requires it in-app and
  at a public URL. Deleting removes records, sessions and the user row,
  asks RevenueCat to delete the subscriber, and tells the user that the
  store subscription must be cancelled separately.
- **Export my data** as a JSON file (access and portability rights).
- **Consent record:** which Terms and Privacy version were accepted, and
  when. A new version asks again at next sign-in.
- **Store forms:** App Store privacy labels and Google Play Data safety
  change from "no data collected" to email and user content, linked to
  the user, not used for tracking.
- **Retention:** codes 10 minutes; idle sessions 90 days; deleted items
  follow the app's 30-day rule and tombstones are purged after 90 days;
  a deleted account is purged at once.
- **Processor agreements** signed or accepted with each provider above
  (owner task; most are a click in the provider's dashboard).

**Should follow soon**

- A one-page breach runbook: who decides, the 72-hour notice to the
  authority, how to revoke every session.
- A short record of processing activities (one table is enough).
- A per-account switch "Do not sync meetings" for users who want
  transcripts to stay on the device.

**Not applicable now, noted so nobody is surprised later**

- California's CCPA applies above revenue or user-count thresholds that
  Stack'd is far below.
- Parental consent flows: avoided entirely by 18+.

---

## 6. Phases

Same rules as the architecture doc: each phase leaves the app working,
ends with `npm run check` green, and is offered for commit.

### Phase 23 — Owner prerequisites and the new domain · S (~3 h + owner tasks)
- Owner: legal name and contact address for the policy and the email
  footer; pick the email provider; DNS records; create the D1 database
  (EU).
- A release branch for 1.6.0: phases are committed there and merged to
  `main` at release, so a half-built sign-in is never live and the
  security review sees the whole release as pending changes.
- `app.stackdplatform.com` live; `ALLOWED_ORIGINS`, `TERMS_URL`,
  `PRIVACY_URL` updated; move banner on the old address.
- **Done when:** the app runs from the new domain and the proxy accepts it.

### Phase 24 — Auth backend · L (~8 h)
- D1 schema and migrations; `/v1/auth/*`, `/v1/account`, sign-out;
  code and PIN hashing, lockout, rate limits; email templates.
- `proxy/test/run.mjs` grows cases: wrong code, expired code, PIN lockout,
  no account enumeration, revoked session.
- **Done when:** a scripted client can register, sign in on a "second
  device" and be locked out after five wrong PINs.

### Phase 25 — Sign-in UI, age screen, acceptance · M (~6 h)
- Settings › Account; the four-step sheet (age, email, code, PIN);
  `src/account.js`; session storage per platform; security notice emails.
- **Done when:** sign-in works on web at 375 px and 1280 px and in both
  shells; an under-18 year stops registration and cannot be retried.

### Phase 26 — Sync engine · L (~10 h)
- `src/sync.js` (shadow diff, push/pull, merge), `/v1/sync`, `updatedAt`
  on boards, first-sign-in merge dialog, sign-out choice, status line.
- New `scripts/check-sync.mjs`: newer wins, tombstones, clock clamp,
  demo data dropped, audio fields never leave the device.
- **Done when:** a task made on the phone appears on the PC within one
  focus, offline edits on both sides merge without loss on reconnect.

### Phase 27 — Plan follows the account · M (~5 h)
- RevenueCat `logIn` / `logOut`; proxy resolves entitlement from the
  session; `legacyId` carry-over; testers by email; web shows the plan.
- **Done when:** a tester plan granted to an account works on phone and
  PC with one shared allowance.

### Phase 28 — App lock: PIN and biometrics · M (~6 h + devices)
- Lock screen, local PIN verifier for offline unlock, timeout setting,
  biometric plugin on iOS and Android, Face ID usage string in the iOS
  workflow. Windows Hello / Touch ID on PC if time allows.
- **Done when:** unlock works offline by PIN on all three platforms and
  by biometrics on both phones.

### Phase 29 — Rights and legal surface · M (~6 h)
- Export, delete account (app and web page), device list; new
  `privacy.html` and `terms.html`; renewal terms on every plan card;
  third-party-URL check and CSP; "Copyright complaints" contact.
- Owner: store privacy forms, processor agreements, optional DMCA agent.
- **Done when:** every row of §4 and every "Must" of §5 is ticked.

### Phase 30 — QA and release 1.6.0 · M (~4 h + two phones)
- QA walk per `agents/qa_tester.md`: two devices plus a PC, offline and
  online, light and dark; findings into `docs/qa-report.md`; README;
  `VERSION` bump; lawyer's read of the two legal pages before publishing.
- **`/security-review` over the whole release branch before the merge**
  (PRD US-13): findings rated high are fixed, the rest fixed or accepted
  with a reason, and the result is written to `docs/qa-report.md`. This
  gate applies to every release from now on, not only 1.6.0.

Total: about 48 hours of focused build, plus owner tasks and device time.

Order rationale: the domain moves first because the session design
depends on it; the backend precedes its UI; sync is useless before
sign-in; the plan link needs a working session; the lock and the legal
surface are independent of each other and can swap if the stores' review
dates require it.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| A 4-digit PIN has only 10 000 values | Never accepted without a known device or a fresh email code; 5-try lockout; keyed hash on the server. |
| Sync loses data on first merge | Local backup key kept 30 days; merge is the default over replace; `check-sync.mjs` covers the merge rules. |
| Two devices edit the same record offline | The newer edit wins for that record only; the loser's other records are untouched. Stated in the PRD so it is a known rule, not a bug. |
| Changing domain strands existing web data | Old address stays up one release with a banner and an export file. |
| Login email lands in spam | SPF, DKIM, DMARC on day one; plain-text, short messages; a resend button with a 60 s wait. |
| The privacy text and the product drift apart again | Phase 29 is a release gate; the policy version is stored per user, so a change forces a visible re-accept. |
| Store review rejects for account rules | In-app deletion and optional sign-in are both in scope; no third-party login, so Sign in with Apple is not required. |

---

## 8. Out of scope for 1.6.0

- Syncing recordings.
- Sign in with Apple / Google buttons.
- Sharing boards or notes with other people.
- End-to-end encryption of synced content.
- Marketing email.
- Live (socket) sync.
