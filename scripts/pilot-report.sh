#!/usr/bin/env bash
# pilot-report.sh — Generate 24h Go/No-Go Pilot Traffic Report
#
# Usage:
#   OPS_API_KEY=xxx API_URL=https://api.asgcard.dev ./scripts/pilot-report.sh
set -euo pipefail

API_URL="${API_URL:-https://api.asgcard.dev}"
OPS_KEY="${OPS_API_KEY:?Set OPS_API_KEY}"

echo "╔══════════════════════════════════════════════════════╗"
echo "║      GO/NO-GO PILOT TRAFFIC REPORT                  ║"
echo "║      $(date -u +%Y-%m-%dT%H:%M:%SZ)                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Current health ──
echo "═══ 1. CURRENT HEALTH (last 15min) ═══"
METRICS=$(curl -sf -H "Authorization: Bearer $OPS_KEY" "$API_URL/ops/metrics" 2>/dev/null || echo '{"error":"unreachable"}')
echo "$METRICS" | python3 -m json.tool 2>/dev/null || echo "$METRICS"
echo ""

HEALTH=$(echo "$METRICS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('health','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")

# ── 2. Rollout state ──
echo "═══ 2. ROLLOUT STATE (24h) ═══"
ROLLOUT=$(curl -sf -H "Authorization: Bearer $OPS_KEY" "$API_URL/ops/rollout" 2>/dev/null || echo '{"error":"unreachable"}')
echo "$ROLLOUT" | python3 -m json.tool 2>/dev/null || echo "$ROLLOUT"
echo ""

# ── 3. Rollout log ──
echo "═══ 3. ROLLOUT LOG ═══"
if [ -f /tmp/rollout_log.txt ]; then
  cat /tmp/rollout_log.txt
else
  echo "(no log file found — run rollout-monitor.sh first)"
fi
echo ""

# ── 4. Incidents ──
echo "═══ 4. INCIDENTS ═══"
if grep -q "ROLLBACK" /tmp/rollout_log.txt 2>/dev/null; then
  echo "⚠ ROLLBACK EVENTS FOUND:"
  grep "ROLLBACK" /tmp/rollout_log.txt
else
  echo "✅ No rollback events in log."
fi
echo ""

# ── 5. Decision ──
echo "═══ 5. GO/NO-GO DECISION ═══"
if [ "$HEALTH" = "GREEN" ]; then
  echo "╔══════════════════════════════════════════╗"
  echo "║  ✅  RECOMMENDATION: GO                  ║"
  echo "║                                          ║"
  echo "║  All thresholds within SLO.              ║"
  echo "║  No rollback events in 24h window.       ║"
  echo "║  Ready for pilot traffic expansion.      ║"
  echo "╚══════════════════════════════════════════╝"
else
  echo "╔══════════════════════════════════════════╗"
  echo "║  ⚠  RECOMMENDATION: NO-GO               ║"
  echo "║                                          ║"
  echo "║  Health: $HEALTH"
  echo "║  Review alerts and fix before expanding. ║"
  echo "╚══════════════════════════════════════════╝"
fi
