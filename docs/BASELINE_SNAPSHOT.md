# MNET-115: Monitoring & Alerts — Baseline Snapshot

**Captured:** 2026-03-03T23:58:00Z  
**State:** Pre-funding (treasury not yet funded on mainnet)

---

## Alert Definitions (Confirmed Active)

All alerts are emitted via `emitMetric()` in `/api/src/services/metrics.ts` → async insert to `api_metrics` table. The following events are instrumented:

| Event | Source | Trigger | Rollback threshold |
|---|---|---|---|
| `request_create` | x402 middleware | Every create attempt | — |
| `request_fund` | x402 middleware | Every fund attempt | — |
| `verify_error` | paymentService | Facilitator verify fails | rate > 5% over 5m |
| `settle_failed` | paymentService | Facilitator settle fails | rate > 2% over 5m |
| `replay_counter` | x402 middleware | Duplicate payment nonce | **ANY 1 = immediate rollback** |
| `webhook_sig_failure` | webhook route | HMAC mismatch from 4payments | trusted rate > 0.5% |
| `webhook_duplicate` | webhook route | Idempotency collision (normal) | monitor only |
| `webhook_accepted` | webhook route | Successful webhook | — |
| `rollout_kill_switch` | x402 middleware | ROLLOUT_ENABLED=false triggered | — |
| `rollout_gated` | x402 middleware | Payer outside rollout % | — |

---

## Baseline Snapshot (Pre-Funding)

Captured via production API polling at 2026-03-03T23:58:00Z:

```json
{
  "timestamp": "2026-03-03T23:58:00Z",
  "state": "pre-funding",
  "api": {
    "status": "ok",
    "version": "0.3.0",
    "url": "https://api.asgcard.dev"
  },
  "facilitator": {
    "network": "stellar:pubnet",
    "x402Version": 2,
    "scheme": "exact",
    "areFeesSponsored": true,
    "signer": "GANP6MZHBQXQGPYM37FR43SRYAQBFCTV3B7G3BTL4IQKCKQQ7BUNWRDM"
  },
  "treasury": {
    "address": "GBQL4G3MUIQTNSSC7X3FR534RUOKPV4NBZOBPP43SLWU7BXYD6VAW5BZ",
    "horizon_status": 404,
    "exists": false,
    "usdc_balance": 0
  },
  "rollout": {
    "enabled": true,
    "pct": 100
  },
  "tests": {
    "unit_tests": "48/48",
    "webhook_idempotency": "3/3"
  },
  "metrics_baseline": {
    "verify_error_rate_pct": 0,
    "settle_failed_rate_pct": 0,
    "trusted_webhook_sig_failure_rate_pct": 0,
    "replay_duplicates": 0,
    "p95_create_ms": null,
    "p95_fund_ms": null,
    "note": "No live payments yet — treasury not funded"
  }
}
```

---

## Alert Monitoring Commands

```bash
# Check ops metrics (requires OPS_API_KEY in env)
curl -sf https://api.asgcard.dev/ops/metrics?window=1h \
  -H "Authorization: Bearer $OPS_API_KEY" | jq .

# Check rollout status
curl -sf https://api.asgcard.dev/ops/rollout \
  -H "Authorization: Bearer $OPS_API_KEY" | jq .

# Query DB directly for last 10 failures
# psql $DATABASE_URL -c "
#   SELECT event_type, COUNT(*) as cnt, MAX(created_at) as last_seen
#   FROM api_metrics
#   WHERE created_at > NOW() - INTERVAL '1 hour'
#   GROUP BY event_type ORDER BY cnt DESC;
# "
```

---

## Go-Live Alert Thresholds (enforced)

```
verify_error_rate_pct    <= 5%   (rollback if breach sustained 5m)
settle_failed_rate_pct   <= 2%   (rollback if breach sustained 5m)
webhook_sig_failure_rate <= 0.5% (trusted source only)
replay_duplicates        == 0    (HARD STOP — any 1 = immediate kill-switch)
p95_create_ms            <= 15000ms
p95_fund_ms              <= 15000ms
```
