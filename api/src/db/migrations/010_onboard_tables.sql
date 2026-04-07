-- 010_onboard_tables.sql
-- ASG Pay Onboarding: wallet registry, sponsorship tracking, funnel events.
-- All tables: IF NOT EXISTS for idempotent re-runs.

-- 1. Wallet registry (lifecycle tracking)
CREATE TABLE IF NOT EXISTS wallets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL UNIQUE,
  client_type     TEXT,                         -- codex, claude, cursor, gemini, manual
  status          TEXT NOT NULL DEFAULT 'pending_identity'
    CHECK (status IN ('pending_identity','pending_sponsor','sponsoring','active','failed')),
  registered_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sponsored_at    TIMESTAMPTZ,
  ip_address      TEXT,
  metadata        JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);
CREATE INDEX IF NOT EXISTS idx_wallets_ip ON wallets(ip_address, registered_at);

-- 2. Sponsorship tracking (1:1 with wallets)
CREATE TABLE IF NOT EXISTS wallet_sponsorships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL UNIQUE REFERENCES wallets(wallet_address),
  sponsor_xdr     TEXT,                         -- unsigned XDR for co-sign
  sponsor_tx_hash TEXT,                         -- Horizon tx hash after confirmed
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','submitted','confirmed','failed')),
  ops_in_tx       TEXT[],                       -- e.g. ['CreateAccount','ChangeTrust']
  xlm_reserved    NUMERIC(10,4),                -- XLM locked by treasury
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  ip_address      TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_sponsorships_status ON wallet_sponsorships(status);

-- 3. Onboard funnel events (analytics + resumability)
CREATE TABLE IF NOT EXISTS onboard_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT NOT NULL,
  step            TEXT NOT NULL,                 -- e.g. 'register', 'tg_linked', 'sponsored', 'funded'
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboard_wallet ON onboard_events(wallet_address, created_at);

-- RLS (enable but don't add policies — service role bypasses)
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_sponsorships ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboard_events ENABLE ROW LEVEL SECURITY;
