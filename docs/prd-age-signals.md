# Plan: Stack'd Minimalist — Store Age Signals

Status: **phases 2 to 4 built, 2026-11-19** (§10), after Google Play's
notice of 2026-11-18 ("Updates to the Play Age Signals API and support for
age assurance laws in the U.S. and Brazil"). The owner accepted D-2, D-3
and D-5 the same day. Still open: D-1 and D-4 (lawyer), D-6 and D-7
(owner), phase 5 (words) and phase 6 (release). Target: before **1 January 2027**, when the California
and Alabama laws start, in whichever release reaches the stores first
after that date.

Not legal advice. This plan turns what the sources in §09 say into
engineering work, and lists what a lawyer has to settle. Where a source
was unclear or sources disagreed, the text says so.

---

## 01. Why

The app is on two stores that now pass on the user's age, and laws in
several places put duties on the developer that receives it. Today the
app uses none of it:

| What | Today |
|---|---|
| Using the app | Any age, no account, nothing on our server |
| Creating an account | 18+, from a birth year the user picks (`account.checkAge`); the server keeps only that 18+ was confirmed and when |
| Buying a plan | Google Play and the App Store through RevenueCat (`src/ui/paywall.js`); no age check |
| Store age signals | Not read |

## 02. The laws, as far as they touch the app

| Where | From | What it asks of the developer | Store API |
|---|---|---|---|
| California, AB 1043 | 1 January 2027 | Request the age signal when the app is downloaded and launched. Once received, the developer is treated as knowing the age range, and must treat the signal as the primary indicator unless it has clear and convincing information otherwise. No liability shield for developers. An amending bill (AB 1856) was pending; its status is unconfirmed | Play Age Signals; Apple Declared Age Range |
| Alabama, HB 161 | 1 January 2027 | Confirm through the store each user's age category (under 13, 13–15, 16–17, 18+) and, for a minor, that a parent consented, **before the minor uses the app or buys anything**. Tell the store about significant changes. One source reports an industry lawsuit (October 2026); unconfirmed | Same |
| Brazil, Digital ECA (Law 15.211/2025) | In force since 17 March 2026 | For products likely to be used by minors: reliable age assurance (self-declaration expressly not enough), parental tools. Details left to the data protection authority (ANPD), still open | Play Age Signals returns signals in Brazil since March |
| Texas, Utah, Louisiana | Various, 2026–2027; Texas reportedly paused by a court | App store accountability laws close to Alabama's. Apple applies them through Declared Age Range and PermissionKit | Apple |

Whether Brazil's law covers a task app at all ("likely to be accessed by
minors") is the lawyer's call (§05, D-1).

## 03. What the stores give

**Google Play — Play Age Signals API (beta).** An Android library
(`com.google.android.play:age-signals`) that returns, without a prompt
where sharing is mandatory: the user's status (verified adult, supervised,
supervised with a parent's approval pending or denied, unknown), an age
band for a supervised user, and the date of the last parental approval.
Google's notice adds a new version with:
- an in-app Google Play prompt, so users anywhere can choose to share;
- a method that says whether mandatory sharing applies to this user.

It also ships a fake manager for tests. The exact names and fields
changed between versions; the build uses the current documentation
(a `/v3/` guide exists).

**Apple — Declared Age Range (iOS 26; the Texas additions in 26.2).**
`requestAgeRange` takes up to three age gates (for us: 18) and shows a
system sheet where the user, or the parent for a child, shares the range.
It needs the `com.apple.developer.declared-age-range` entitlement.
PermissionKit adds the "significant change" request that asks a parent to
approve again.

**Capacitor.** Two maintained plugins wrap both:
- `@capawesome/capacitor-age-signals` (0.3.x for Capacitor 8);
- `@capgo/capacitor-age-range`.

The alternative is a small local plugin like `plugins/recording-service`.

## 04. Proposed behaviour

The store's answer is read on the phone and **never sent to our server**.
Only the yes for an account stays as today (`adult_confirmed_at`). On the
web, where there is no store, nothing changes.

1. **At launch** (Android, and iOS where the law applies): ask the store
   for the signal, once per launch, in the background. It does not block
   the first screen. The answer is kept in memory for the session. On iOS
   the system sheet is asked for only where Apple says the law applies,
   or when the app needs the answer (2 and 3), never at every launch.
2. **Creating an account:**
   - Store says 18+: the birth-year question is skipped.
   - Store says under 18: "Accounts are for adults", without the question.
   - No answer (web, a declined sheet, outside the regions): the birth
     year as today.
3. **Buying a plan:**
   - Store says a minor: the paywall does not offer Buy. It says that
     plans need a parent's approval, given through the store.
   - The store's own parental purchase approval (Family Link, Ask to
     Buy) still applies on top.
4. **A minor waiting for a parent** (Alabama; and Texas/Utah/Louisiana on
   iOS if those laws hold): when the store says a parent's approval is
   pending or was denied, the app shows one screen. It says the app needs
   a parent's approval in the store, and nothing else opens until the
   store says approved. Data already on the phone stays on it.
5. **Significant changes** (Alabama, PermissionKit): a release that
   changes what the app collects or who it is for asks the store to get
   the parent's approval again. What counts as significant goes to the
   lawyer (D-4).
6. **Privacy Policy and Terms:** say that the app asks the store for an
   age range, what it does with it, and that it stays on the phone.

## 05. Decisions needed

| # | Question | Who | Proposal |
|---|---|---|---|
| D-1 | Is the app "likely to be accessed by minors" under Brazil's law, and so in scope there? | Lawyer | Treat it as in scope; the work in §04 covers it |
| D-2 | Can a minor use the app without an account? | Owner, lawyer | **Decided 2026-11-19:** yes, as today; only accounts and purchases are gated |
| D-3 | Should store 18+ replace the birth-year question, or come on top of it? | Owner | **Decided 2026-11-19:** replace it when the store has answered (§04, 2) |
| D-4 | What is a "significant change" that needs a parent's approval again? | Lawyer | New data collected, or a change of audience; not features |
| D-5 | Third-party plugin or our own? | Owner | **Decided 2026-11-19:** `@capawesome/capacitor-age-signals`, exact version pinned, its code read before it is added (§10) |
| D-6 | Which release? | Owner | 1.6.0 if it reaches production stores after 1 January 2027; otherwise 1.6.1 by then |
| D-7 | Store settings | Owner | Play Console: the app's age bands with 18 as a threshold, and a "significant change" declared so Google asks parents of supervised users to approve the app (§10). Apple: the Declared Age Range capability on the App ID, then the repository variable `IOS_DECLARED_AGE_RANGE` = `true` |

## 06. Acceptance criteria

- [ ] AC-01 On Android, the app asks Play Age Signals for the signal on
      every launch. On iOS it asks Declared Age Range where the law
      applies. The first screen never waits for the answer.
- [x] AC-02 The answer is not written to our server, to local storage or
      to a log. A test checks that no request carries it.
- [x] AC-03 Account creation follows §04, 2, for each answer: 18+, under
      18, approval pending, unknown, no store.
- [ ] AC-04 A store-reported minor never reaches Buy in the paywall
      (§04, 3).
- [ ] AC-05 A store-reported minor with approval pending or denied sees
      only the approval screen (§04, 4). The approval screen is read by
      VoiceOver and TalkBack.
- [x] AC-06 The web app behaves exactly as before.
- [ ] AC-07 The Privacy Policy and the Terms say what §04, 6 says, and
      the lawyer has read them.
- [ ] AC-08 Each answer is tested with the store's fake (Play's fake
      manager; Apple's test accounts where they exist) and with a check
      script on the pure part (`scripts/check-age.mjs`).
- [ ] AC-09 The security review before the release covers the plugin's
      code and the new entitlement.

## 07. Phases

1. **Decisions** (owner, lawyer): §05. Nothing below starts before D-2,
   D-3 and D-5.
2. **Plugin** (Claude): add and review the plugin.
   - Android: the dependency comes with `cap sync`; check the `.aab` for
     it in `android-play.yml`.
   - iOS: the workflow adds the entitlement to the generated project and
     checks that it landed, as it does for the keyboard handler.
3. **`src/agesignal.js`** (Claude): one module,
   `ask() → { status, minAge, maxAge, approval } | null`. It is pure apart
   from the plugin call, has a fake for the preview, and has a check script.
4. **Flows** (Claude): the account step, the paywall gate, the approval
   screen. Verified in the preview with the fake; on devices by the owner.
5. **Words** (Claude drafts, lawyer reads): Privacy Policy, Terms, store
   listings.
6. **Release** (owner): Play Console minimum ages, the App ID capability,
   a TestFlight and an internal-testing build, then production before
   1 January 2027.

## 08. Risks and limits

- **Short time:** about six weeks to 1 January 2027, with the holidays in
  between.
- **Moving rules:** both APIs are new and changed in 2026. Apple's forums
  report the iOS sheet not showing in some regulated regions. Each build
  is checked against the current docs.
- **Untestable here:** the real signals need store accounts set up as a
  child or a parent. The preview and CI can only use the fakes.
- **Unsettled law:** an amending bill in California, a reported lawsuit in
  Alabama, a court pause in Texas, and the ANPD rules in Brazil may change
  the scope before or after January.
- **Not covered:** apps outside the stores (the web app) have no store to
  ask. These laws are written for app stores, so the plan leaves the web
  as it is, unless the lawyer says otherwise (D-1).

## 09. Sources (read 2026-11-19)

- Google Play's notice to the developer account, 2026-11-18.
- [Google: Use Play Age Signals API (beta)](https://developer.android.com/google/play/age-signals/use-age-signals-api)
- [Google: Request age signals](https://developer.android.com/google/play/age-signals/request-age-signals)
- [Apple: Update on age requirements for apps distributed in Texas](https://developer.apple.com/news/?id=8jzbigf4)
- [MacRumors: iOS 26.2 adds APIs for the Texas law](https://www.macrumors.com/2025/11/04/ios-26-2-texas-age-verification-law/)
- [Kelley Drye: FAQ on California's Digital Age Assurance Act](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/faq-digital-age-assurance-act-california-youth-safety-on-the-internet)
- [Troutman: Analyzing California's Digital Age Assurance Act](https://troutmanprivacy.com/2025/10/analyzing-californias-digital-age-assurance-act/)
- [Hunton: Alabama enacts App Store Accountability Act](https://www.hunton.com/privacy-and-cybersecurity-law-blog/alabama-enacts-app-store-accountability-act-requiring-age-verification)
- [LegiScan: AL HB161, enrolled text](https://legiscan.com/AL/text/HB161/2026)
- [Mayer Brown: Enforcement of Brazil's ECA Digital](https://www.mayerbrown.com/zh-hans/insights/publications/2026/04/enforcement-of-brazils-eca-digital-introduces-new-obligations-for-companies)
- [Baker McKenzie: Brazil regulates the Digital ECA](https://connectontech.bakermckenzie.com/brazil-regulates-the-children-and-adolescents-online-safety-act-digital-eca/)
- [Capawesome: Age Signals plugin](https://capawesome.io/plugins/age-signals/)
- [Capgo: Age Range plugin](https://capgo.app/plugins/capacitor-age-range/)

## 10. As built (2026-11-19)

- **Plugin** (D-5): `@capawesome/capacitor-age-signals` **0.5.1**, pinned
  exactly in `package.json`.
  - **Reviewed before install** (downloaded into its own folder and read):
    no runtime dependencies, no install scripts, about 57 KB of native code.
    It makes no network calls or storage writes of its own; only an error
    goes to Capacitor's log. Its fake manager refuses to run in a release
    build. Android uses Google's `age-signals` 0.0.4. Apache-2.0. The
    installed copy was compared with the reviewed one, byte for byte.
  - `npx cap sync android` added it to `android/capacitor.settings.gradle`
    and `app/capacitor.build.gradle`.
- **What Google's API now says** (0.0.4, as the plugin exposes it).
  - There is no "approval pending" user status any more. A parent's
    approval shows as the status of the app's latest **significant
    change** (`PENDING`, `DECLINED`, `APPROVED`), which the developer
    declares in the Play Console. That is why D-7 asks for one.
  - `VERIFICATION_REQUIRED` (the user must verify their age in the Play
    Store) and a range that straddles 18 count as **no answer**: the
    birth-year question stays. Worth the lawyer's look.
- **`src/agesignal.js`.**
  - `check()` runs at launch and whenever the app comes back. It never
    prompts: Android reads what Play shares; iOS asks only where Apple says
    age assurance is required, where the system shares without a sheet.
  - `ask()` runs when creating an account or buying, and may show the
    store's prompt once.
  - `read()` turns the plugin's answer into `{ age, waiting }`; it is pure.
  - The answer lives in memory only. On the web, with no native platform,
    it does nothing.
  - `useFake()` is for the preview and the checks; nothing in the app
    calls it.
- **Gates.**
  - **Sign-in** (`signin.js`): the store's adult skips the Age step (and
    the step count drops by one). A store-reported minor gets "Accounts are
    for adults", with no 24-hour refusal stored.
  - **Paywall** (`paywall.js`): a minor sees "Plans need a parent's
    approval, given in your store account." instead of Buy, and
    `purchase()` asks the store first.
  - **Approval screen** (`ui/approval.js`): drawn before onboarding and
    the lock, with "Check again". It names Google Family Link or Screen
    Time.
- **Workflows.**
  - Both now check that the plugin landed.
  - iOS adds the entitlement only when `vars.IOS_DECLARED_AGE_RANGE` is
    `true`, because signing fails while the App ID lacks the capability.
    Until then iOS gives no age, and the birth-year question stays.
- **Checks:** `scripts/check-age.mjs` in `npm run check` covers each
  answer, what is asked on each platform and when, failures, the web, and
  the module having no storage, network or log.
- **Verified in the preview** with the fake:
  - the approval screen before onboarding, focused on its title;
  - "Check again" while pending, and the app opening once approved;
  - the minor refusal and the adult skipping the Age step in sign-in;
  - no answer leaving the birth year;
  - no console errors.
- **Not verified:**
  - **Purchases:** the paywall gate, because the web has no store purchases.
  - **Phones:** anything on a device, because accounts in the apps also wait
    for the secure-storage plugin.
  - **Native builds:** the Android build with the new library, and the iOS
    build with the entitlement switched on.

