PRAGMA foreign_keys = ON;

-- Gort's persistent memory is deliberately isolated from the general assistant's memories.
CREATE TABLE IF NOT EXISTS gort_memories (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content TEXT NOT NULL CHECK(length(content) <= 1000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS gort_memories_user_updated_idx ON gort_memories(user_id, updated_at DESC);
