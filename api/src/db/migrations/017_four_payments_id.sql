-- ASG Card — Database Migration 017: four_payments_id column
-- This column was missing from tracked migrations (added manually via GUI).
-- Adding it here to ensure schema reproducibility on clean deploys.
-- Created: 2026-04-08

ALTER TABLE cards ADD COLUMN IF NOT EXISTS four_payments_id TEXT;
CREATE INDEX IF NOT EXISTS idx_cards_four_payments_id ON cards (four_payments_id);

COMMENT ON COLUMN cards.four_payments_id IS '4payments provider card ID — links local card to remote issuer card';
