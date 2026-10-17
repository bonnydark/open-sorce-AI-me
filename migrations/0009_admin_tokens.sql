ALTER TABLE users ADD COLUMN token_balance INTEGER NOT NULL DEFAULT 0 CHECK (token_balance >= 0);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL DEFAULT 'ai-engine',
  input_characters INTEGER NOT NULL DEFAULT 0,
  image_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS usage_events_user_created_idx ON usage_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_events_user_module_created_idx ON usage_events(user_id, module_id, created_at DESC);

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
