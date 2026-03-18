-- ASG Card — Migration 012: Analytics Counters
-- Tracks CLI installs, website visits, and agent detection
-- Created: 2026-03-17

-- ── CLI install events ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS install_events (
  id          SERIAL PRIMARY KEY,
  client_type TEXT NOT NULL,          -- 'claude', 'cursor', 'sdk', 'clawhub'
  version     TEXT,
  os          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_install_events_date ON install_events (created_at);
CREATE INDEX idx_install_events_client ON install_events (client_type);

-- ── Website page visits ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS page_visits (
  id          SERIAL PRIMARY KEY,
  page        TEXT NOT NULL,          -- 'home', 'docs', 'pricing'
  referrer    TEXT,
  user_agent  TEXT,
  is_agent    BOOLEAN DEFAULT false,  -- auto-detected from user-agent
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_visits_date ON page_visits (created_at);
CREATE INDEX idx_page_visits_agent ON page_visits (is_agent) WHERE is_agent = true;
