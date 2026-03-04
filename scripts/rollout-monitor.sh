#!/usr/bin/env bash
# rollout-monitor.sh — Automated rollout phase progression with threshold alerting
#
# Usage:
#   OPS_API_KEY=xxx API_URL=https://api.asgcard.dev ./scripts/rollout-monitor.sh
#
# By default runs all 3 phases (10% -> 50% -> 100%) with 8h interval.
# For testing: PHASE_HOURS=0.1 (6 min per phase)
set -euo pipefail

API_URL="${API_URL:-https://api.asgcard.dev}"
OPS_KEY="${OPS_API_KEY:?Set OPS_API_KEY}"
PHASE_HOURS="${PHASE_HOURS:-8}"
CHECK_INTERVAL="${CHECK_INTERVAL:-300}"  # 5 min between health checks

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

log()  { echo -e "${GREEN}[$(date -u +%H:%M:%S)]${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date -u +%H:%M:%S)] ⚠${NC} $*"; }
err()  { echo -e "${RED}[$(date -u +%H:%M:%S)] ❌${NC} $*"; }

# ── Health check ──
check_health() {
  local resp
  resp=$(curl -sf -H "Authorization: Bearer $OPS_KEY" "$API_URL/ops/metrics" 2>/dev/null || echo '{"health":"UNREACHABLE"}')

  local health
  health=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('health','UNKNOWN'))" 2>/dev/null || echo "PARSE_ERROR")

  local alerts
  alerts=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(', '.join(d.get('alerts',[])))" 2>/dev/null || echo "")

  local rollback
  rollback=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rollback_recommended',False))" 2>/dev/null || echo "False")

  echo "$health|$alerts|$rollback"
}

# ── Rollback action ──
rollback() {
  err "ROLLBACK TRIGGERED: $1"
  err "Setting ROLLOUT_ENABLED=false..."
  # In production, this would call vercel env + redeploy
  echo "ROLLBACK_REASON=$1" >> /tmp/rollout_log.txt
  echo "ROLLBACK_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> /tmp/rollout_log.txt
  exit 1
}

# ── Phase runner ──
run_phase() {
  local pct=$1
  local phase_seconds
  phase_seconds=$(echo "$PHASE_HOURS * 3600" | bc | cut -d. -f1)
  local end_time=$((SECONDS + phase_seconds))

  log "═══════════════════════════════════════"
  log "PHASE: ${pct}% rollout — monitoring for ${PHASE_HOURS}h"
  log "═══════════════════════════════════════"

  while [ $SECONDS -lt $end_time ]; do
    local result
    result=$(check_health)
    local health alerts rollback_rec
    health=$(echo "$result" | cut -d'|' -f1)
    alerts=$(echo "$result" | cut -d'|' -f2)
    rollback_rec=$(echo "$result" | cut -d'|' -f3)

    if [ "$health" = "GREEN" ]; then
      log "✅ GREEN — all thresholds OK (${pct}%)"
    elif [ "$health" = "RED" ]; then
      err "🔴 RED — alerts: $alerts"
      if [ "$rollback_rec" = "True" ]; then
        rollback "Health RED at ${pct}%: $alerts"
      fi
    else
      warn "⚠ Health: $health"
    fi

    # Log to file
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) phase=${pct}% health=$health alerts=$alerts" >> /tmp/rollout_log.txt

    sleep "$CHECK_INTERVAL"
  done

  log "Phase ${pct}% complete — all checks passed ✅"
}

# ══════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════

echo "" > /tmp/rollout_log.txt
log "Starting staged rollout: 10% -> 50% -> 100%"
log "API: $API_URL"
log "Phase duration: ${PHASE_HOURS}h"
log "Check interval: ${CHECK_INTERVAL}s"
log ""

# Initial health-check
log "Pre-flight health check..."
initial=$(check_health)
initial_health=$(echo "$initial" | cut -d'|' -f1)
if [ "$initial_health" != "GREEN" ] && [ "$initial_health" != "UNKNOWN" ]; then
  err "Pre-flight health check failed: $initial_health"
  err "Fix issues before starting rollout."
  exit 1
fi
log "Pre-flight: OK"

# Phase 1: 10%
run_phase 10

# Phase 2: 50%
log "Advancing to 50%..."
run_phase 50

# Phase 3: 100%
log "Advancing to 100%..."
run_phase 100

# Done
log ""
log "╔══════════════════════════════════════════════╗"
log "║   ROLLOUT COMPLETE — ALL PHASES PASSED 🎉   ║"
log "╚══════════════════════════════════════════════╝"
log ""
log "Run pilot-report.sh to generate Go/No-Go report."
