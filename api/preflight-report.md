# Preflight Report — 2026-03-04T00:02:26.708Z

| Check | Status | Detail |
|---|---|---|
| API health | ✅ PASS | v0.3.0 |
| /supported → stellar:pubnet x402v2 | ✅ PASS | fees_sponsored=true |
| x402 challenge returns HTTP 402 | ✅ PASS | network=stellar:pubnet version=2 |
| Account exists on mainnet | ❌ FAIL | Horizon 404 — account not found/funded |
| USDC trustline exists | ❌ FAIL | Cannot check — account missing |
| USDC balance >= $200 | ❌ FAIL | Cannot check — account missing |

## Decision: CONDITIONAL_GO

Technical gates pass. **Fund treasury** then re-run: `npm run preflight`