-- ASG Card — Database Migration 015: Payment Requests
-- Adds owner-approval payment request flow for agent-initiated payments
-- Created: 2026-03-20
-- Ticket: PAYMENT-REQUEST-APPROVAL

CREATE TABLE IF NOT EXISTS stripe_payment_requests (
  id                  TEXT PRIMARY KEY,          -- 'pr_xxxxx'
  session_id          TEXT NOT NULL REFERENCES stripe_beta_sessions(id),
  owner_id            TEXT NOT NULL,
  email               TEXT NOT NULL,
  amount_usd          NUMERIC(10,2) NOT NULL,
  description         TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  -- lifecycle: pending → approved → completed / failed
  --            pending → rejected / expired
  approval_token_hash TEXT NOT NULL,             -- SHA-256 of one-time approval URL token
  name_on_card        TEXT,
  phone               TEXT,
  stripe_pi_id        TEXT,                      -- Stripe PaymentIntent ID after payment
  card_id             TEXT,                      -- resulting card ID after completion
  result_json         JSONB,                     -- full creation result for agent retrieval
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL        -- request expiry (default 1h)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_requests_session
  ON stripe_payment_requests (session_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_owner
  ON stripe_payment_requests (owner_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_requests_token
  ON stripe_payment_requests (approval_token_hash);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status
  ON stripe_payment_requests (status) WHERE status = 'pending';

-- ── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE stripe_payment_requests IS 'Agent-initiated payment requests requiring owner approval via one-time URL.';
COMMENT ON COLUMN stripe_payment_requests.approval_token_hash IS 'SHA-256 hash of the one-time approval token. Raw token is only in the approval URL.';
COMMENT ON COLUMN stripe_payment_requests.result_json IS 'Full card creation result stored for agent polling after completion.';
