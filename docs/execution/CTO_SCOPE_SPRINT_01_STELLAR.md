# CTO Scope — Sprint 01 (Stellar Pilot)

Sprint window: 2026-03-02 to 2026-03-13
Sprint owner: CTO
Product owner: Founder + AI cofounder

## 1. Sprint Goal
Deliver the production foundation for Stellar pilot execution:
- GitHub operating system in place
- service skeleton implemented and deployable
- x402 and issuer integration contracts fixed
- storage model and async processing prepared

## 2. Mandatory Outcomes
1. GitHub workflow and quality gates are enforced.
2. API foundation runs in staging with health/pricing/tiers.
3. x402 service contract is implemented for paid endpoints.
4. 4payments adapter skeleton works with typed request/response mapping.
5. Webhook endpoint exists with signature verification contract.
6. Ledger schema + reconciliation job skeleton is in place.

## 3. Out of Scope (Sprint 01)
- Full production launch.
- High-scale optimization.
- Arbitrum/Solana rails.
- Advanced analytics and BI.

## 4. Service Slice for Sprint 01
- `api-gateway`
- `x402-payment-service`
- `issuer-adapter-4payments`
- `webhook-ingestor`
- `ledger-service`
- `reconciliation-worker` (skeleton)

## 5. Sprint Backlog (committed)

### Epic A: GitHub Operating Foundation
- GH-001 Repository bootstrap and standards files.
- GH-002 Branch protection and required checks.
- GH-003 Project board with status flow.
- GH-004 Issue templates (feature/bug/security/incident).
- GH-005 PR template with Definition of Done.

### Epic B: API and Data Foundation
- PLAT-001 Bootstrap API modules and route map.
- PLAT-002 Add env schema + secrets contract.
- PLAT-003 Add database migrations for wallets/cards/transactions/webhook_events.
- PLAT-004 Add idempotency keys and request tracing middleware.

### Epic C: Payment and Issuer Contracts
- PAY-001 Implement x402 challenge flow for create/fund endpoints.
- PAY-002 Integrate facilitator client (`/verify`, `/settle`, `/supported`).
- ISS-001 Implement 4payments auth client + error mapping.
- ISS-002 Implement issue/topup adapter functions (without full orchestration).

### Epic D: Webhooks and Reliability
- WH-001 Implement webhook endpoint with raw-body HMAC verification.
- WH-002 Add idempotent event store and replay protection.
- REC-001 Add reconciliation worker skeleton + mismatch report stub.

## 6. Acceptance Criteria for Sprint 01
1. Staging API is reachable and passes smoke checks:
- `GET /health`
- `GET /pricing`
- `GET /cards/tiers`
2. Paid endpoint returns valid 402 challenge when payment proof is absent.
3. x402 verification path can be integration-tested via mocked facilitator.
4. 4payments adapter has typed contracts and retry policy for transient errors.
5. Webhook request with invalid signature is rejected (401/403).
6. Webhook duplicate event is ignored idempotently.
7. DB migrations are versioned and reversible.
8. CI pipeline blocks merges on failing tests/lint/security checks.

## 7. Risks and Mitigations
- Risk: unknown issuer edge cases.
  Mitigation: contract tests and sandbox replay fixtures.
- Risk: x402 flow latency and settle failures.
  Mitigation: async settle tracking and retry backoff.
- Risk: replay/sensitive data exposure.
  Mitigation: strict anti-replay window, masked logs, audit events.

## 8. Sprint Exit Deliverables
- merged PRs for all committed issues
- architecture README update
- staging deploy URL and smoke test evidence
- updated backlog for Sprint 02 with risks and carry-over

