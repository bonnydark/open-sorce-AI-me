ALTER TABLE usage_events ADD COLUMN estimated_cost_usd REAL;
ALTER TABLE usage_events ADD COLUMN model_id TEXT NOT NULL DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS usage_events_user_cost_created_idx ON usage_events(user_id, created_at DESC);
