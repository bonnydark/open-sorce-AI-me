ALTER TABLE users ADD COLUMN token_balance INTEGER NOT NULL DEFAULT 0 CHECK (token_balance >= 0);

CREATE TABLE IF NOT EXISTS admin_token_ledger (
  id TEXT PRIMARY KEY NOT NULL,
  admin_email TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS admin_token_ledger_user_created_idx ON admin_token_ledger(user_id, created_at DESC);
