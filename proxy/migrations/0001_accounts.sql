-- Accounts and sync (docs/architecture.md §29). Applied with
-- `wrangler d1 migrations apply DB --remote` before the deploy (proxy.yml).
-- Hashes and salts are hex TEXT rather than BLOB, so the same rows read the
-- same in D1 and in the node:sqlite test adapter.

CREATE TABLE users (
  id                 TEXT PRIMARY KEY,           -- 24 chars [a-z0-9]
  email              TEXT NOT NULL UNIQUE,       -- trimmed, lower-cased
  created_at         INTEGER NOT NULL,
  adult_confirmed_at INTEGER NOT NULL,           -- the fact and the time; never a birth year
  terms_version      TEXT NOT NULL,
  privacy_version    TEXT NOT NULL,
  accepted_at        INTEGER NOT NULL,
  pin_salt           TEXT NOT NULL,
  pin_hash           TEXT NOT NULL,
  pin_version        INTEGER NOT NULL DEFAULT 1, -- bumped by change and reset
  pin_fails          INTEGER NOT NULL DEFAULT 0,
  pin_locked         INTEGER NOT NULL DEFAULT 0,
  rev                INTEGER NOT NULL DEFAULT 0, -- last sync revision handed out
  tester             INTEGER NOT NULL DEFAULT 0  -- set by the owner with wrangler d1 execute
);

CREATE TABLE legacy_ids (                        -- anonymous device ids linked at sign-in (AC-08.2)
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscriber_id TEXT NOT NULL,
  linked_at     INTEGER NOT NULL,
  PRIMARY KEY (user_id, subscriber_id)
);

CREATE TABLE login_codes (                       -- one live code per email; no user row needed
  email_key         TEXT PRIMARY KEY,            -- HMAC(CODE_PEPPER, email)
  code_hash         TEXT NOT NULL,               -- HMAC(CODE_PEPPER, email ‖ code)
  expires_at        INTEGER NOT NULL,            -- sent_at + 10 min
  attempts          INTEGER NOT NULL DEFAULT 0,  -- 5 max
  sent_at           INTEGER NOT NULL,
  ticket_hash       TEXT UNIQUE,                 -- set by a correct code; proves the mailbox for 10 min
  ticket_expires_at INTEGER
);

CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,                 -- 's_…', shown in Devices
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,             -- SHA-256 of the 32-byte token
  platform     TEXT NOT NULL,                    -- 'web' | 'ios' | 'android'
  label        TEXT NOT NULL,                    -- 'iPhone', 'Android', 'Browser on Windows' …
  pin_version  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL                  -- written at most once an hour
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE records (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  id         TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT,                               -- JSON; NULL when deleted
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX records_rev ON records(user_id, rev);

CREATE TABLE consent_log (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  what    TEXT NOT NULL,                         -- 'terms' | 'privacy' | 'adult'
  version TEXT NOT NULL,
  at      INTEGER NOT NULL
);

CREATE TABLE rate (                              -- fixed-window counters
  key          TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count        INTEGER NOT NULL
);
