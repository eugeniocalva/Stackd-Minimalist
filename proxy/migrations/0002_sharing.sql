-- Shared boards (docs/architecture.md Part V §39, docs/prd-improvements.md US-12).
-- A space is one shared board: its board record and its tasks live here,
-- once, and every member's device syncs them with its own cursor.

CREATE TABLE spaces (
  id         TEXT PRIMARY KEY,                   -- equals the board id
  owner_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rev        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE space_members (
  space_id  TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX space_members_user ON space_members(user_id);

CREATE TABLE invites (
  id         TEXT PRIMARY KEY,
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  email_key  TEXT NOT NULL,                      -- HMAC(CODE_PEPPER, 'invite:' ‖ email): how the invitee finds it
  email      TEXT NOT NULL,                      -- shown to the owner as "pending"; gone when answered or expired
  board_name TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (space_id, email_key)
);
CREATE INDEX invites_email ON invites(email_key);

CREATE TABLE space_records (
  space_id   TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('list', 'task')),
  id         TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  changed_by TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  data       TEXT,
  PRIMARY KEY (space_id, kind, id)
);
CREATE INDEX space_records_rev ON space_records(space_id, rev);
