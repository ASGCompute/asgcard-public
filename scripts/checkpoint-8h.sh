#!/usr/bin/env bash
# checkpoint-8h.sh — T+8h Checkpoint Protocol
#
# Generates the exact checkpoint report for phase transition decision.
# Usage: OPS_API_KEY=xxx API_URL=https://api.asgcard.dev ./scripts/checkpoint-8h.sh
set -euo pipefail

API_URL="${API_URL:-https://api.asgcard.dev}"
OPS_KEY="${OPS_API_KEY:?Set OPS_API_KEY}"
PHASE_START="2026-02-27T21:55:00Z"

NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

echo "╔══════════════════════════════════════════════════════════╗"
echo "║   CHECKPOINT PROTOCOL — 10% → 50% Decision             ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Phase 1 start (UTC): $PHASE_START"
echo "Report time   (UTC): $NOW"
echo ""

# ── Fetch metrics ──
METRICS=$(curl -sf -H "Authorization: Bearer $OPS_KEY" "$API_URL/ops/metrics" 2>/dev/null)

if [ -z "$METRICS" ]; then
  echo "❌ Failed to fetch /ops/metrics"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "1. METRIC VALUES (last 15min window)"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Parse with python3
python3 <<PYEOF
import json, sys

d = json.loads('''$METRICS''')

rates = d.get('rates', {})
lat = d.get('latencies', {})
thresholds = d.get('thresholds', {})

metrics = [
    ("verify_error_rate",                rates.get('verify_error_rate_pct', 0),       f"<= {thresholds.get('verify_error_rate_pct', '?')}%"),
    ("settle_failed_rate",               rates.get('settle_failed_rate_pct', 0),      f"<= {thresholds.get('settle_failed_rate_pct', '?')}%"),
    ("trusted_webhook_sig_failure_rate",  rates.get('trusted_webhook_sig_failure_rate_pct', 0), f"<= {thresholds.get('webhook_sig_failure_rate_pct', '?')}%"),
    ("replay_duplicates",                rates.get('replay_duplicates', 0),           f"= {thresholds.get('replay_duplicates_max', '?')}"),
    ("p95_create_ms",                    (lat.get('create') or {}).get('p95', 0),     f"<= {thresholds.get('p95_create_ms', '?')}ms"),
    ("p95_fund_ms",                      (lat.get('fund') or {}).get('p95', 0),       f"<= {thresholds.get('p95_fund_ms', '?')}ms"),
]

print(f"{'Metric':<40} {'Value':>10} {'Threshold':>15} {'Status':>8}")
print("-" * 80)

all_pass = True
for name, val, threshold in metrics:
    status = "✅ PASS"
    if name == "replay_duplicates":
        if int(val) > 0:
            status = "❌ FAIL"
            all_pass = False
    elif name.endswith("_rate"):
        if float(val) > float(threshold.split()[1].rstrip('%')):
            status = "❌ FAIL"
            all_pass = False
    elif name.startswith("p95"):
        if val and float(val) > float(threshold.split()[1].rstrip('ms')):
            status = "❌ FAIL"
            all_pass = False

    print(f"{name:<40} {str(val):>10} {threshold:>15} {status:>8}")

print()
print("═" * 60)
print("2. TOP-5 ERROR REASONS")
print("═" * 60)
print()

reasons = d.get('top5_error_reasons', [])
if not reasons:
    print("  (none)")
else:
    for r in reasons:
        print(f"  [{r['count']}x] {r['reason']}")

print()
print("═" * 60)
print("3. DECISION")
print("═" * 60)
print()

health = d.get('health', 'UNKNOWN')
alerts = d.get('alerts', [])

if all_pass and health == "GREEN":
    print("╔══════════════════════════════════════╗")
    print("║   ✅  GO 50%                          ║")
    print("║                                      ║")
    print("║   All 6 metrics within SLO.          ║")
    print("║   No alerts, no incidents.           ║")
    print("║   Safe to advance ROLLOUT_PCT=50.    ║")
    print("╚══════════════════════════════════════╝")
else:
    print("╔══════════════════════════════════════╗")
    print("║   ❌  NO-GO                           ║")
    print("║                                      ║")
    for a in alerts:
        print(f"║   ⚠ {a[:36]:<36} ║")
    print("║                                      ║")
    print("║   ROLLBACK_ENABLED=false required.   ║")
    print("╚══════════════════════════════════════╝")
PYEOF
