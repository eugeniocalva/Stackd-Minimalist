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
| `POST /v1/transcribe` | multipart audio | Phase 20 (501 until then) |
| `GET /v1/transcribe/:id` | — | Phase 20 |
| `POST /v1/rc-webhook` | RevenueCat event | Phase 18 |

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

Until Phase 18 the entitlement is a stub: subscriber ids listed in the
`TESTERS` variable get the tester tier, everyone else is `free`.

## Secrets and setup (once)

```bash
cd proxy
npm ci
npx wrangler login
npx wrangler kv namespace create POOL      # paste the id into wrangler.toml
npx wrangler secret put ANTHROPIC_API_KEY  # the Anthropic key for the minutes
npx wrangler secret put APP_TOKEN          # any long random string; the same value goes into src/store.js APP_TOKEN
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
APP_TOKEN=dev-token
```

and the app's Settings › Meetings & AI › Developer field points at
`http://localhost:8787`.

## Benchmark (PRD-meetings Q15)

`npm run benchmark` runs every `benchmark/transcripts/*.txt` (pasted-shape
transcripts, git-ignored) through the small and the mid model tier and
writes `benchmark/out/<name>.A.json` and `.B.json` with the model names
hidden in `benchmark/out/key.json`, so they can be rated blind on: actions
found vs missed, actions invented, summary accuracy. The winner goes into
`SUMMARY_MODEL`. Needs `ANTHROPIC_API_KEY` in the environment.

## Tests

`npm test` covers `plans.js` (limits, periods), `pool.js` (reserve, charge,
release on an in-memory KV) and `schema.js` (validation, date and priority
rules). No network.
