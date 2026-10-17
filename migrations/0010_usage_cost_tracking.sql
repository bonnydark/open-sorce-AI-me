-- Compatibility migration: some production databases already have model_id.
-- The usage module inspects PRAGMA table_info and adds whichever tracking columns
-- are missing, avoiding duplicate-column failures across existing installations.
SELECT 1;
