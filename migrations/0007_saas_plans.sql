ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','business'));
ALTER TABLE users ADD COLUMN plan_updated_at TEXT;

CREATE INDEX IF NOT EXISTS users_plan_idx ON users(plan);
