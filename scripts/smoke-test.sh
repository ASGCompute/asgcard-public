#!/usr/bin/env bash
# Smoke test for ASG Card API — Day 2 demo evidence
# Usage: bash scripts/smoke-test.sh [base_url]
set -euo pipefail

BASE="${1:-http://localhost:3000}"
PASS=0
FAIL=0
TOTAL=0

pass() { PASS=$((PASS + 1)); TOTAL=$((TOTAL + 1)); echo "  ✅ $1"; }
fail() { FAIL=$((FAIL + 1)); TOTAL=$((TOTAL + 1)); echo "  ❌ $1"; }

echo "═══════════════════════════════════════════"
echo " ASG Card API Smoke Test"
echo " Base URL: $BASE"
echo "═══════════════════════════════════════════"
echo

# ── 1. GET /health ──────────────────────────────────
echo "1. GET /health"
HTTP_CODE=$(curl -s -o /tmp/asg_health.json -w "%{http_code}" "$BASE/health")
if [ "$HTTP_CODE" = "200" ]; then
  STATUS=$(cat /tmp/asg_health.json | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "ok" ]; then
    pass "200 OK, status=ok"
  else
    fail "200 but status='$STATUS', expected 'ok'"
  fi
else
  fail "HTTP $HTTP_CODE, expected 200"
fi
cat /tmp/asg_health.json | python3 -m json.tool 2>/dev/null || cat /tmp/asg_health.json
echo

# ── 2. GET /pricing ─────────────────────────────────
echo "2. GET /pricing"
HTTP_CODE=$(curl -s -o /tmp/asg_pricing.json -w "%{http_code}" "$BASE/pricing")
if [ "$HTTP_CODE" = "200" ]; then
  HAS_CREATION=$(cat /tmp/asg_pricing.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('creation',{}).get('tiers',[])))" 2>/dev/null || echo "0")
  HAS_FUNDING=$(cat /tmp/asg_pricing.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('funding',{}).get('tiers',[])))" 2>/dev/null || echo "0")
  if [ "$HAS_CREATION" = "6" ] && [ "$HAS_FUNDING" = "6" ]; then
    pass "200 OK, 6 creation tiers + 6 funding tiers"
  else
    fail "200 but creation=$HAS_CREATION, funding=$HAS_FUNDING tiers (expected 6 each)"
  fi
else
  fail "HTTP $HTTP_CODE, expected 200"
fi
echo

# ── 3. GET /cards/tiers ─────────────────────────────
echo "3. GET /cards/tiers"
HTTP_CODE=$(curl -s -o /tmp/asg_tiers.json -w "%{http_code}" "$BASE/cards/tiers")
if [ "$HTTP_CODE" = "200" ]; then
  HAS_BREAKDOWN=$(cat /tmp/asg_tiers.json | python3 -c "import sys,json; d=json.load(sys.stdin); print('ok' if 'breakdown' in d.get('creation',[])[0] else 'missing')" 2>/dev/null || echo "missing")
  if [ "$HAS_BREAKDOWN" = "ok" ]; then
    pass "200 OK, tiers include breakdown"
  else
    fail "200 but tiers missing breakdown field"
  fi
else
  fail "HTTP $HTTP_CODE, expected 200"
fi
echo

# ── 4. POST /cards/create/tier/25 (no X-Payment → 402) ──
echo "4. POST /cards/create/tier/25 (expect 402 challenge)"
HTTP_CODE=$(curl -s -o /tmp/asg_402.json -w "%{http_code}" -X POST "$BASE/cards/create/tier/25")
if [ "$HTTP_CODE" = "402" ]; then
  NETWORK=$(cat /tmp/asg_402.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accepts',[])[0].get('network',''))" 2>/dev/null || echo "")
  ASSET=$(cat /tmp/asg_402.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accepts',[])[0].get('asset',''))" 2>/dev/null || echo "")
  if echo "$NETWORK" | grep -q "stellar"; then
    pass "402 returned, network=$NETWORK ✓"
  else
    fail "402 returned but network='$NETWORK' (expected stellar:pubnet)"
  fi
  if echo "$ASSET" | grep -q "USDC"; then
    pass "402 asset=$ASSET ✓ (Stellar USDC)"
  else
    fail "402 asset='$ASSET' (expected Stellar USDC)"
  fi
else
  fail "HTTP $HTTP_CODE, expected 402"
fi
echo "  Full 402 challenge:"
cat /tmp/asg_402.json | python3 -m json.tool 2>/dev/null || cat /tmp/asg_402.json
echo

# ── 5. POST /cards/fund/tier/100 (no X-Payment → 402) ──
echo "5. POST /cards/fund/tier/100 (expect 402 challenge)"
HTTP_CODE=$(curl -s -o /tmp/asg_402_fund.json -w "%{http_code}" -X POST "$BASE/cards/fund/tier/100")
if [ "$HTTP_CODE" = "402" ]; then
  AMOUNT=$(cat /tmp/asg_402_fund.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('accepts',[])[0].get('maxAmountRequired',''))" 2>/dev/null || echo "")
  if [ "$AMOUNT" = "107000000" ]; then
    pass "402 fund tier/100, maxAmountRequired=$AMOUNT (107 USDC atomic) ✓"
  else
    fail "402 fund tier/100, maxAmountRequired='$AMOUNT' (expected 107000000)"
  fi
else
  fail "HTTP $HTTP_CODE, expected 402"
fi
echo

# ── 6. GET /nonexistent (expect 404) ────────────────
echo "6. GET /nonexistent (expect 404)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/nonexistent")
if [ "$HTTP_CODE" = "404" ]; then
  pass "404 returned for unknown route ✓"
else
  fail "HTTP $HTTP_CODE, expected 404"
fi
echo

# ── Summary ─────────────────────────────────────────
echo "═══════════════════════════════════════════"
echo " Results: $PASS/$TOTAL passed, $FAIL failed"
echo "═══════════════════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
