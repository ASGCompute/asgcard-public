# Founder-Locked Execution Plan (v0.4.0)

Status: `LOCKED`
Date: `2026-03-04`
Owner: `PO/Co-founder`
Executor: `CTO`

This document is the frozen execution plan. No architecture pivots, scope expansion, or contract changes are allowed without explicit founder approval.

## 1) Non-Negotiable Product Invariants

1. Agent-first remains primary.
   - Agent must be able to obtain card details in the supported flow (`create` response + secure details endpoint).
   - Anti-replay and nonce protection remain mandatory.
2. Owner is secondary control plane.
   - Owner can revoke/restore agent details access.
   - Owner controls Telegram link and oversight, but does not replace agent-first flow.
3. Telegram bot must stay operational.
   - `/start`, `My Cards`, `FAQ`, `Support`, freeze/unfreeze, statement, alerts must keep working.
4. No regression in current x402/Stellar production path.
5. No direct production hotfixes outside Git flow.

## 2) Architecture Freeze Rules

1. Keep module-in-monorepo architecture for this phase.
2. Do not split into new deployable microservices in this sprint.
3. Do not introduce breaking API contract changes unless founder-approved.
4. Any new task outside this plan requires `founder sign-off` first.

## 3) Locked Scope (Execute In Order)

## A. P0 Corrections (must complete first)

1. Restore single `/health` JSON contract (status/timestamp/version).
2. Fix test/runtime module resolution (logger/module loading) and return tests to green.
3. Remove runtime `console.error/log` drift and keep unified structured logger.
4. Harden deploy guard to fail-closed (no bypass on ref ambiguity).
5. Version consistency to `0.3.1` across API/env/health/openapi/docs.

## B. P1 Observability Hardening

1. Structured JSON logs (stable schema).
2. Global `traceId` propagation across request path.
3. PAN/CVV redaction proofs including nested error payloads.
4. Nonce retention cleanup plan (TTL/cron) to prevent unbounded growth.

## C. P2 Public Contract/Docs Sync

1. OpenAPI synced to agent-first reality:
   - `detailsEnvelope`
   - `X-AGENT-NONCE`
   - `409 replay`
   - `403 revoked`
2. Public docs synced to same contracts and limits.
3. First-time agent quickstart made reproducible end-to-end.

## D. Final E2E + Release Evidence

1. Production E2E: `402 -> valid payment -> 201`.
2. Details endpoint E2E: valid nonce `200`, replay nonce `409`.
3. Owner revoke/restore E2E: revoke causes `403`, restore returns access.
4. Telegram bot E2E: commands and alerts validated with no regression.
5. First 10-agent onboarding dry-run report with zero P0 failures.

## 4) Acceptance Gate (Must Be True)

1. Agent-first works in production.
2. Telegram bot works in production.
3. Owner controls work in production.
4. Docs and OpenAPI match actual behavior.
5. Security checks pass (no PAN/CVV leakage in logs/ops/metrics).

## 5) Change-Control Protocol (Mandatory)

1. CTO executes only locked items above.
2. PO does not introduce new architecture changes without founder approval.
3. Any deviation must be written as a delta note and approved before implementation.

