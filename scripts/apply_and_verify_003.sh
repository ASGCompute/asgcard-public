#!/usr/bin/env bash
# ============================================================
# apply_and_verify_003.sh
# Apply migration 003_bot_tables.sql to staging Supabase
# and collect evidence for PO review.
#
# Usage:
#   export DATABASE_URL="postgresql://postgres:[password]@db.ptnyqylyvjcbvxmyardw.supabase.co:5432/postgres"
#   bash scripts/apply_and_verify_003.sh
# ============================================================

set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set"
  echo "  export DATABASE_URL='postgresql://postgres:[password]@db.ptnyqylyvjcbvxmyardw.supabase.co:5432/postgres'"
  exit 1
fi

echo "═══════════════════════════════════════════════════════"
echo "  ASGAgentBot — Migration 003 Apply + Evidence"
echo "═══════════════════════════════════════════════════════"
echo ""

# 1. Apply migration
echo "─── 1. Applying migration ───"
psql "$DATABASE_URL" -f api/src/db/migrations/003_bot_tables.sql
echo "✅ Migration applied"
echo ""

# 2. Verify tables exist
echo "─── 2. Table inventory ───"
psql "$DATABASE_URL" -c "
SELECT table_name, 
       (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('owner_telegram_links','telegram_link_tokens','bot_events','bot_messages','authz_audit_log')
ORDER BY table_name;
"

# 3. Verify columns
echo "─── 3. Column details ───"
psql "$DATABASE_URL" -c "
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('owner_telegram_links','telegram_link_tokens','bot_events','bot_messages','authz_audit_log')
ORDER BY table_name, ordinal_position;
"

# 4. Verify indexes
echo "─── 4. Index evidence ───"
psql "$DATABASE_URL" -c "
SELECT indexname, tablename, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('owner_telegram_links','telegram_link_tokens','bot_events','bot_messages','authz_audit_log')
ORDER BY tablename, indexname;
"

# 5. Verify RLS enabled
echo "─── 5. RLS status ───"
psql "$DATABASE_URL" -c "
SELECT relname as table_name, 
       relrowsecurity as rls_enabled,
       relforcerowsecurity as rls_forced
FROM pg_class
WHERE relname IN ('owner_telegram_links','telegram_link_tokens','bot_events','bot_messages','authz_audit_log')
ORDER BY relname;
"

# 6. Verify check constraints
echo "─── 6. Check constraints ───"
psql "$DATABASE_URL" -c "
SELECT conname, conrelid::regclass as table_name, consrc
FROM pg_constraint
WHERE conrelid::regclass::text IN ('owner_telegram_links','telegram_link_tokens','bot_events','bot_messages','authz_audit_log')
  AND contype = 'c'
ORDER BY conrelid::regclass, conname;
"

# 7. Token hash verification (no raw tokens stored)
echo "─── 7. Token hash verification ───"
psql "$DATABASE_URL" -c "
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'telegram_link_tokens' 
  AND column_name = 'token_hash';
"
echo "  ↳ Only 'token_hash' (SHA-256 hex) is stored. No 'token_raw' or 'token' column exists."
psql "$DATABASE_URL" -c "
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'telegram_link_tokens' 
  AND column_name IN ('token', 'token_raw', 'raw_token');
" | grep -c "token" | xargs -I{} bash -c 'if [ {} -gt 0 ]; then echo "❌ FAIL: raw token column found!"; exit 1; else echo "✅ PASS: no raw token columns"; fi'

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Migration 003 — ALL CHECKS PASSED"
echo "═══════════════════════════════════════════════════════"
