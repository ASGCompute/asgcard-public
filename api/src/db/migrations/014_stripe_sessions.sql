-- ASG Card — Database Migration 014: Stripe Beta Sessions
-- Adds managed identity sessions for wallet-less Stripe edition
-- Cards bind to server-generated managed wallets; no external Stellar wallet required
-- Created: 2026-03-20
-- Ticket: STRIPE-MANAGED-IDENTITY

-- ── Stripe Beta Sessions ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS stripe_beta_sessions (
  id                TEXT PRIMARY KEY,       -- 'sess_xxxxx'
  owner_id          TEXT NOT NULL,          -- 'owner_xxxxx'
  email             TEXT NOT NULL,
  managed_wallet    TEXT NOT NULL,          -- Stellar G... address (server-generated)
  managed_secret    BYTEA NOT NULL,         -- AES-256-GCM encrypted S... key
  session_key_hash  TEXT NOT NULL,          -- SHA-256 hash of raw session key
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ             -- NULL = no expiry (v1)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_beta_sessions_key_hash
  ON stripe_beta_sessions (session_key_hash);
CREATE INDEX IF NOT EXISTS idx_beta_sessions_owner
  ON stripe_beta_sessions (owner_id);
CREATE INDEX IF NOT EXISTS idx_beta_sessions_email
  ON stripe_beta_sessions (email);
CREATE INDEX IF NOT EXISTS idx_beta_sessions_wallet
  ON stripe_beta_sessions (managed_wallet);

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE stripe_beta_sessions IS 'Managed identity sessions for Stripe beta edition. No external wallet required.';
COMMENT ON COLUMN stripe_beta_sessions.managed_wallet IS 'Server-generated Stellar public key used as walletAddress bridge for cardService';
COMMENT ON COLUMN stripe_beta_sessions.managed_secret IS 'AES-256-GCM encrypted Stellar secret key. Encrypted with STRIPE_SESSIONS_KEY.';
COMMENT ON COLUMN stripe_beta_sessions.session_key_hash IS 'SHA-256 hash of the raw session key. Raw key never stored.';
