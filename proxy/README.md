# Stack'd proxy

A Cloudflare Worker, the only thing in Stack'd that spends money
(`docs/architecture.md` §18–§20, `docs/prd-meetings.md` US-09). The app
sends it a transcript or a recording; it checks who is asking and what
their plan allows, calls the provider, charges the allowance, and returns
the result. It keeps no audio, transcript or minutes.

## Endpoints

Every request carries `X-Stackd-App: <app token>` and
`X-Stackd-Subscriber: <subscriber id>`. Answers are JSON:
`{ ok: true, …, allowance }` or `{ ok: false, code, message }`.

| Method, path | Body | Returns |
|---|---|---|
| `GET /v1/allowance` | — | the plan and this period's remaining audio seconds and summaries |
| `POST /v1/summarise` | `{ transcript: { segments, speakers }, meetingDate: 'YYYY-MM-DD', priorities: ['High', …] }` | `{ minutes: { summary, decisions, openQuestions }, actions: [{ title, due, priority, excerpt }] }` |
| `POST /v1/transcribe` | multipart: `audio` (≤ 40 MB, the recording), `durationMs` | `{ jobId }` once the provider accepted the upload; audio minutes (rounded up) are reserved |
| `GET /v1/transcribe/:id` | — | `{ state: 'queued' \| 'processing' }`, or `{ state: 'done', transcript: { segments, speakers } }`; on failure the error code with `state: 'error'` and the reservation released; `too_quiet` when no speech was found |
| `POST /v1/rc-webhook` | RevenueCat event (its own `Authorization` value) | drops that subscriber's cached entitlement; 204 |

Error codes (`code`): `unauthorized`, `bad_request`, `plan_required`,
`allowance_exhausted` (with `resetsAt`), `too_large`, `refused`,
`provider_unavailable`, `bad_output`, `misconfigured`, `not_implemented`.

## Plans and pools

`src/plans.js` holds the tier limits from the PRD (Plus 8 h / 20, Pro 16 h /
50, Max 24 h / 100 per month; testers 60 min / 10 per day). Pools are
counters in KV keyed by subscriber id and period; a summary is charged
when it succeeds, audio minutes are reserved before the provider call and
released on failure. KV writes are not transactional: two requests racing
on the last unit of a pool can both pass. Accepted at this scale (the cost
is one extra summary), noted here so nobody is surprised.

Entitlement, in order: subscriber ids listed in the `TESTERS` variable get
the tester tier; then RevenueCat's subscriber record (`GET
/v1/subscribers/{id}` with the secret key, cached in KV for five minutes,
dropped by the webhook on any event for that subscriber) gives the highest
active paid entitlement (`plus` / `pro` / `max`) and its expiry as the
renewal date; everyone else is `free`. Without `RC_SECRET_KEY` set, only
testers get an allowance.

## Secrets and setup (once)

```bash
cd proxy
npm ci
npx wrangler login
npx wrangler kv namespace create POOL      # paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY  # the Anthropic key for the minutes (a workspace-scoped Console key)
npx wrangler secret put ANTHROPIC_WORKSPACE_ID  # only for a user-level key not scoped to a workspace: the workspace id (wrkspc_…)
npx wrangler secret put ASSEMBLYAI_API_KEY # the speech-to-text key (STT_PROVIDER in wrangler.toml)
npx wrangler secret put APP_TOKEN          # any long random string; the same value goes into src/store.js APP_TOKEN
npx wrangler secret put RC_SECRET_KEY      # RevenueCat › Project › API keys › secret key (sk_…)
npx wrangler secret put RC_WEBHOOK_AUTH    # any long random string; paste the same into RevenueCat › Integrations › Webhooks › Authorization header
npx wrangler deploy
```

Testers: add their subscriber ids (Settings › Meetings & AI › Subscriber id,
with a Copy button) to `TESTERS` in `wrangler.toml`, comma-separated, and
redeploy.

The GitHub workflow (`.github/workflows/proxy.yml`, manual) runs the tests
and `wrangler deploy` with `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` from the repository secrets; it never touches the
Worker secrets above.

## Local run

```bash
npm run dev
```

reads secrets from a `.dev.vars` file (git-ignored):

```
ANTHROPIC_API_KEY=sk-ant-…
ASSEMBLYAI_API_KEY=…
APP_TOKEN=dev-token
RC_SECRET_KEY=sk_…          # optional: without it only TESTERS get an allowance
RC_WEBHOOK_AUTH=dev-hook
```

and the app's Settings › Meetings & AI › Developer field points at
`http://localhost:8787`.

## RevenueCat setup (once, in its dashboard)

One project with an iOS and an Android app; products `plus_monthly`,
`pro_monthly`, `max_monthly` imported from the stores; entitlements `plus`,
`pro`, `max`, each attached to its product; one offering (current) with
three packages identified `plus`, `pro`, `max`; the webhook pointed at
`https://<worker>/v1/rc-webhook` with the `RC_WEBHOOK_AUTH` value as its
Authorization header. The two public SDK keys go into `src/purchases.js`
(`RC_KEYS`).

## Benchmark (PRD-meetings Q15)

`npm run benchmark` runs every `benchmark/transcripts/*.txt` (pasted-shape
transcripts, git-ignored) through the small and the mid model tier and
writes `benchmark/out/<name>.A.json` and `.B.json` with the model names
hidden in `benchmark/out/key.json`, so they can be rated blind on: actions
found vs missed, actions invented, summary accuracy. The winner goes into
`SUMMARY_MODEL`. Needs `ANTHROPIC_API_KEY` in the environment.

## STT benchmark (PRD-meetings Q13)

`benchmark/stt.mjs` runs every `benchmark/recordings/*` (git-ignored; the
architecture asks for a headset recording, a phone-on-table one and one
with two speakers overlapping) through the provider named by
`STT_PROVIDER` and writes `out/<name>.<provider>.txt` plus a log. Adding a
provider is one file in `src/stt/` with `start(blob, mimeType)` and
`poll(id)`, registered in `src/stt/index.js`.

## Tests

`npm test` covers `plans.js` (limits, periods), `pool.js` (reserve, charge,
release on an in-memory KV) and `schema.js` (validation, date and priority
rules). No network.
