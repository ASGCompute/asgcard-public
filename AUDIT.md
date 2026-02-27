# ASG Card Audit (OpenCard parity + Solana adaptation)

Date: 2026-02-19
Sources:
- https://opencard.dev
- https://opencard.dev/docs
- /Users/innocode/Desktop/Test/ASGcard/PLAN.md

## 1. Executive Summary

`PLAN.md` captures the core OpenCard model correctly (x402, tier endpoints, payment-as-auth, SDK shape), but there are several parity gaps that should be resolved before full 1:1 implementation under `ASG Card` on Solana.

## 2. What already matches OpenCard well

- Product model: instant virtual cards for AI agents.
- Auth split: public, paid x402, wallet-signed free endpoints.
- Core endpoint families and response shapes.
- SDK concept and method surface.
- Architecture direction (API + chain verification + card provider).

## 3. Gaps Found (High Priority)

1. Endpoint count inconsistency in `PLAN.md`.
- Declared: 11 endpoints.
- Listed in table: 10 endpoints.
- OpenCard docs expose 10 endpoints.

2. Pricing mismatch with OpenCard docs.
- `PLAN.md` currently hardcodes fees that diverge from OpenCard for multiple tiers.
- OpenCard docs list full tier matrices for creation and funding (10/25/50/100/200/500).
- `PLAN.md` funding table currently includes only 10 and 25.

3. x402 proof serialization detail.
- OpenCard docs specify `X-Payment` as base64-encoded JSON payload.
- `PLAN.md` shows raw JSON object example.
- Recommendation: support both in API parser for compatibility, emit base64 in SDK.

4. Wallet auth adaptation clarity.
- OpenCard wallet auth: EIP-712 typed data (`opencard-auth`, chainId 8453).
- `PLAN.md` proposes Solana Ed25519 detached signature string (`asgcard-auth:<timestamp>`), which is valid as adaptation, but needs strict canonical message spec and replay window policy documented as protocol contract.

5. Path naming parity.
- OpenCard docs use `:amount` in routes (`/cards/create/tier/:amount`, `/cards/fund/tier/:amount`).
- `PLAN.md` uses `:N`.
- Recommendation: standardize to `:amount`.

6. Sensitive endpoint policy.
- OpenCard applies specific limit for card details (`3 requests / hour per card`).
- `PLAN.md` mentions rate limits generally, but not this operational guardrail in implementation details.

## 4. Solana-Specific Adaptation Decisions

1. x402 network identifier:
- Use `solana:mainnet` (as in plan) for challenge/proof payload.

2. Asset identifier:
- Use USDC mint on Solana mainnet: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

3. Payment proof payload contract:
- Keep OpenCard-like structure (`scheme`, `network`, `payload.authorization`, `txHash`) to maximize compatibility.

4. Wallet auth:
- Required headers: `X-WALLET-ADDRESS`, `X-WALLET-SIGNATURE`, `X-WALLET-TIMESTAMP`.
- Signature message canonical form: `asgcard-auth:<unixTimestamp>`.
- Replay window: +/- 5 minutes.

## 5. Build Start Status

Implementation was started with a foundation scaffold for:
- monorepo structure (`api`, `sdk`)
- Solana x402 challenge middleware
- Ed25519 wallet auth middleware
- endpoint skeletons with OpenCard-parity route map
- SDK skeleton with `ASGCardClient`, config, error classes, and low-level x402 utility surface

## 6. Immediate Next Execution Items

1. Replace in-memory card service with Supabase persistence.
2. Add real Solana transaction verification against RPC on API side.
3. Integrate real card issuer provider adapter.
4. Add contract tests for 402 handshake + wallet auth signature validation.
