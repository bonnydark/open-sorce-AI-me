-- Add model identity and estimated provider cost to usage events.
-- Safe for databases created by migration 0009_admin_tokens.sql.
ALTER TABLE usage_events ADD COLUMN model_id TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE usage_events ADD COLUMN estimated_cost_usd REAL;
