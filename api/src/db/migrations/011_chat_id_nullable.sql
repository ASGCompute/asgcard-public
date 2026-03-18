-- Migration: Make chat_id nullable (Mini App onboarding inserts without chat_id)
ALTER TABLE owner_telegram_links ALTER COLUMN chat_id DROP NOT NULL;
