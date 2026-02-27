# ADR-002: x402 Verify/Settle Strategy and Failure Handling (Stellar)

**Status**: Accepted  
**Date**: 2026-02-27  
**Author**: CTO  
**Reviewers**: Founder, Product Owner

## Context

ASG Card monetizes API calls via x402 (HTTP 402 Payment Required). Agents pay USDC on Stellar before repeating their request. The payment flow requires:

1. **Challenge** — API returns 402 with payment instructions.
2. **Verify** — confirm the agent's payment is valid and sufficient.
3. **Settle** — finalize the payment and release funds to treasury.

This ADR defines the verify/settle strategy, sync vs async behavior, retry policy, and reconciliation hooks for the Stellar pilot.

## Decision

### Challenge Flow (Sync — in PLAT-001)

```
Agent → POST /cards/create/tier/25
  └─ No X-Payment header
  └─ API returns 402:
     {
       "x402Version": 1,
       "accepts": [{
         "scheme": "exact",
         "network": "stellar:pubnet",
         "asset": "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
         "maxAmountRequired": "32500000",
         "payTo": "G...TREASURY_ADDRESS",
         "maxTimeoutSeconds": 300,
         "resource": "/cards/create/tier/25",
         "description": "Create ASG Card with $25 load"
       }]
     }
```

### Verify Flow (Sync — in PAY-002)

After agent sends `X-Payment` header on retry:

1. Parse `X-Payment` header (JSON or base64-encoded JSON).
2. Extract `txHash` and payment proof fields.
3. Call OpenZeppelin facilitator: `POST {FACILITATOR_URL}/verify`
   - Input: `{ txHash, payTo, asset, amount, network }`
   - Expected: `{ valid: true, settleId: "..." }`
4. If facilitator is unreachable: **fail open with deferred verification**
   - Accept the request, mark payment as `pending_verify`
   - Reconciliation worker picks it up within 15 minutes

### Settle Flow (Async — in PAY-002)

Settlement is always async to avoid blocking the API response:

1. After successful verify, enqueue settle job.
2. Settle worker calls: `POST {FACILITATOR_URL}/settle`
   - Input: `{ settleId }`
   - Expected: `{ settled: true }`
3. On success: mark payment as `settled` in ledger.
4. On failure: retry with backoff, mark as `settle_failed` after max retries.

### Retry and Timeout Policy

| Operation | Timeout | Max Retries | Backoff | Failure Action |
|---|---|---|---|---|
| Verify (facilitator) | 8s | 2 | 1s, 3s | Accept with `pending_verify` |
| Settle (facilitator) | 10s | 5 | 2s, 4s, 8s, 16s, 30s | Mark `settle_failed`, alert |
| Horizon tx lookup (fallback) | 5s | 1 | — | Log warning, rely on facilitator |

### Replay Protection

1. **txHash uniqueness**: Each `txHash` may only be used once. Store in `used_payment_proofs` table with TTL of 24 hours.
2. **Nonce tracking**: `X-Payment` proof must include a nonce. Nonces are tracked per wallet address with a 5-minute sliding window.
3. **Amount validation**: Payment proof `value` must exactly match the tier's `totalCost` in atomic USDC (6 decimals).

### Reconciliation Hooks

The reconciliation worker runs every 15 minutes and handles:

1. **Pending verifications** (> 5 min old): Re-attempt verify via facilitator or direct Horizon lookup.
2. **Failed settlements** (max retries exhausted): Alert + manual intervention queue.
3. **Orphaned payments**: On-chain payments with no matching API request (detected via Horizon streaming) — log for analysis.

### State Machine

```
Payment States:
  challenge_issued → proof_received → verified → settled
                                    → settle_failed → (manual)
                   → verify_failed → (rejected)
                   → pending_verify → verified (async)
                                   → verify_failed (async)
```

## Consequences

- **Positive**: Async settlement avoids blocking API latency. Fail-open on verify prevents unnecessary rejections during facilitator downtime.
- **Negative**: Fail-open introduces a window where unverified requests are processed. Mitigated by fast reconciliation cycle (15 min) and amount-bound risk.
- **Risk**: Facilitator API contract may change. Mitigated by typed adapter with version pinning.

## Implementation Scope

- **PLAT-001**: Challenge generation only (402 response with Stellar network).
- **PAY-001**: Challenge flow integration with paid endpoints.
- **PAY-002**: Full verify/settle with facilitator client.
- **PAY-003**: Payment ledger persistence (state machine + proof storage).
- **PAY-004**: Retry/timeout policy implementation.

## References

- [x402 on Stellar](https://developers.stellar.org/docs/build/apps/x402)
- [OpenZeppelin Relayer](https://developers.stellar.org/docs/tools/openzeppelin-relayer)
- [Operating Context](file:///Users/innocode/Desktop/Test/ASGcard/docs/execution/FOUNDER_CTO_OPERATING_CONTEXT_STELLAR.md)
