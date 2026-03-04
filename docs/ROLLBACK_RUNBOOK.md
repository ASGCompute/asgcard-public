# Rollback Runbook — ASG Card Mainnet

**Target:** ≤ 10 minutes from decision to safe state  
**Owner:** CTO / On-call engineer  
**Last updated:** 2026-03-03

---

## Decision Triggers (when to rollback)

Initiate rollback **immediately** if any of:

- `replay_duplicates > 0`
- `verify_error_rate > 10%` (sustained > 5 min)
- `settle_failed_rate > 5%` (sustained > 5 min)
- `trusted_webhook_sig_failure_rate > 1%` (from `4payments` source)
- p95 create or fund latency > 30s (sustained)
- Any on-call page indicates customer funds loss

---

## Rollback Steps

### Step 1 — Kill-switch (T+0 → T+1 min)

```bash
# Set kill-switch via Vercel CLI (no deploy needed — env pull on next request)
vercel env add ROLLOUT_ENABLED production --force
# When prompted, enter: false

# Verify immediately:
curl -s https://api.asgcard.dev/cards/create/tier/10 \
  -X POST -H "Content-Type: application/json" \
  -d '{"nameOnCard":"test","email":"t@t.co"}' | jq .
# Expected: {"error":"Service temporarily unavailable","retryAfter":300}
```

### Step 2 — Redeploy with frozen config (T+1 → T+3 min)

```bash
cd /Users/innocode/Desktop/Test/ASGcard/api
vercel --prod
# Wait for: ✅ Production: https://api.asgcard.dev
```

### Step 3 — Confirm kill-switch active (T+3 → T+4 min)

```bash
# Health must still return ok
curl -sf https://api.asgcard.dev/health

# Paid path must return 503
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://api.asgcard.dev/cards/create/tier/10 \
  -H "Content-Type: application/json" \
  -d '{"nameOnCard":"t","email":"t@t.co"}')
echo "Paid path status: $STATUS"   # Expected: 503
```

### Step 4 — Preserve incident evidence (T+4 → T+6 min)

```bash
# Pull Vercel function logs
npx vercel logs api.asgcard.dev --output raw > /tmp/incident-$(date +%s).log

# Query DB for any failed payments in last 60 min (if Postgres accessible)
# psql $DATABASE_URL -c "
#   SELECT id, status, error_reason, created_at
#   FROM payments
#   WHERE created_at > NOW() - INTERVAL '1 hour'
#   AND status != 'settled'
#   ORDER BY created_at DESC LIMIT 50;
# "
```

### Step 5 — Revert facilitator config if needed (T+6 → T+8 min)

Only if the facilitator itself is the root cause:

```bash
# Roll back to testnet facilitator (emergency only)
printf "https://channels.openzeppelin.com/x402-testnet" | \
  vercel env add FACILITATOR_URL production --force

printf "stellar:testnet" | \
  vercel env add STELLAR_NETWORK production --force

vercel --prod
```

### Step 6 — Notify & document (T+8 → T+10 min)

1. Post to `#incidents` Slack channel:

   ```
   [ROLLBACK] ASG Card mainnet rollout paused at T+__h
   Reason: <metric/alert that triggered>
   Kill-switch: ACTIVE (ROLLOUT_ENABLED=false)
   Evidence: <vercel log URL or DB query result>
   Next: Root cause analysis before re-enable
   ```

2. Open incident ticket with: timestamp, trigger, rollback steps taken, evidence links
3. Tag CTO for sign-off before re-enabling rollout

---

## Re-enable Rollout (after fix)

```bash
# Set pct back to 10% for re-validation
printf "10" | vercel env add ROLLOUT_PCT production --force
printf "true" | vercel env add ROLLOUT_ENABLED production --force
vercel --prod

# Confirm
curl -X POST https://api.asgcard.dev/cards/create/tier/10 \
  -H "Content-Type: application/json" \
  -d '{"nameOnCard":"test","email":"t@t.co"}' | jq .x402Version
# Expected: 2
```

---

## Contact Escalation

| Role | Action |
|---|---|
| Engineer on-call | Steps 1-4, then notify CTO |
| CTO | Steps 5-6, sign-off for re-enable |
| Stellar / OZ support | If facilitator is root cause |
