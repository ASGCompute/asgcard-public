-- Migration: Add 'profile_only' to owner_telegram_links status CHECK constraint.
-- Sentinel rows (telegram_user_id=0) from cardService use this status
-- to store email/phone without triggering notification delivery queries.

-- Drop the old constraint and recreate with the new value
ALTER TABLE owner_telegram_links DROP CONSTRAINT IF EXISTS owner_telegram_links_status_check;
ALTER TABLE owner_telegram_links ADD CONSTRAINT owner_telegram_links_status_check
  CHECK (status IN ('active', 'revoked', 'profile_only'));

-- Migrate existing sentinel rows to the new status
UPDATE owner_telegram_links
SET status = 'profile_only'
WHERE telegram_user_id = 0 AND status = 'active';
