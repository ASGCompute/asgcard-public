-- ASG Card — Database Migration 013: Payment Rails
-- Adds rail-agnostic payment metadata to cards table
-- Supports multiple payment rails (stellar_x402, stripe_mpp) on one shared schema
-- Created: 2026-03-19
-- Ticket: STRIPE-BETA-001

-- ── Add payment rail columns ──────────────────────────────────
-- Existing cards default to stellar_x402 (backward-compatible)
ALTER TABLE cards ADD COLUMN IF NOT EXISTS payment_rail TEXT NOT NULL DEFAULT 'stellar_x402';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS payment_reference TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'settled';
ALTER TABLE cards ADD COLUMN IF NOT EXISTS issuer_provider TEXT NOT NULL DEFAULT '4payments';

-- ── Index for querying by rail ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cards_payment_rail ON cards (payment_rail);

COMMENT ON COLUMN cards.payment_rail IS 'Payment rail used: stellar_x402, stripe_mpp';
COMMENT ON COLUMN cards.payment_reference IS 'Rail-specific reference: tx hash (Stellar) or pi_... (Stripe)';
COMMENT ON COLUMN cards.payment_status IS 'Payment status: settled, pending, failed';
COMMENT ON COLUMN cards.issuer_provider IS 'Card issuer: 4payments';
