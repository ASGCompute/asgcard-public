-- Payment intents for CryptoBot Crypto Pay integration
CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    telegram_user_id BIGINT NOT NULL,
    tier TEXT NOT NULL,
    amount_usd NUMERIC(10,2) NOT NULL,
    crypto_bot_invoice_id TEXT,
    invoice_url TEXT,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_user ON payment_intents(telegram_user_id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_invoice ON payment_intents(crypto_bot_invoice_id);
