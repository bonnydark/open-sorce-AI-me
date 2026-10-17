-- Business plan shared-workspace memberships.
-- Each user can belong to at most one Business team; invitations require an existing account.
CREATE TABLE IF NOT EXISTS business_team_memberships (
  id TEXT PRIMARY KEY NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  invited_email TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(owner_user_id, invited_email),
  CHECK(owner_user_id <> member_user_id)
);
CREATE INDEX IF NOT EXISTS business_team_owner_idx ON business_team_memberships(owner_user_id,status);
