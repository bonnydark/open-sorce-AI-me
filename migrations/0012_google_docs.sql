PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS google_docs_connections (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_enc TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.file',
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
