# ASG Card Stellar Pilot — Founder/CTO Operating Context

Last updated: 2026-02-27
Owner: Founder + Product Owner (AI cofounder)
Purpose: persistent operating context. If chat context resets, restore work from this file first.

## 1. Mission
Build and launch the first production pilot of ASG Card on Stellar:
- user-facing value: instant virtual cards for AI agents
- commercial model: pay-per-request via x402 (USDC on Stellar)
- issuer backend: 4payments card issuing APIs

## 2. Role Model
- Founder (you): business priorities, partner decisions, budget/risk approval, go/no-go.
- Product Owner / AI cofounder (me): scope, sequencing, quality gates, audit, task issuance, acceptance criteria.
- CTO: architecture and implementation owner, delivery execution, reliability and security.

## 3. GitHub-Only Execution Rules
1. All work is tracked in GitHub Issues only.
2. Prioritization and status live in GitHub Project only.
3. All code changes go through PR into protected `main`.
4. CI/CD and security gates run in GitHub Actions.
5. Environments and secrets are managed via GitHub Environments.
6. Incidents, RCA, and CAPA are tracked in GitHub Issues.
7. Architecture decisions are captured as ADR files linked from Issues.

## 4. Services to Use in Stellar Pilot
- `api-gateway`: public API surface, middleware orchestration.
- `x402-payment-service`: challenge generation, verify/settle flow.
- `card-orchestrator`: create/fund/freeze/unfreeze business logic.
- `issuer-adapter-4payments`: typed API adapter to 4payments.
- `webhook-ingestor`: raw-body HMAC validation + idempotent event ingest.
- `ledger-service`: payment proof, issuer operation and final state linking.
- `reconciliation-worker`: async consistency checks and recovery.
- `risk-limits`: anti-replay, rate limiting, sensitive endpoint quotas.
- `observability-stack`: logs/metrics/traces/alerts and SLO dashboards.

## 5. External Integrations
- ASG Card product/docs: https://asgcard.dev and https://asgcard.dev/docs
- Card issuer: https://docs.4payments.io/
- x402 on Stellar: https://developers.stellar.org/docs/build/apps/x402
- OpenZeppelin relayer (x402 facilitator): https://developers.stellar.org/docs/tools/openzeppelin-relayer
- OpenZeppelin MCP: https://mcp.openzeppelin.com/
- OZ Stellar accounts package: https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts
- OZ smart account docs: https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account

## 6. Delivery Milestones
- M1 Foundation (due: 2026-03-13)
- M2 Payments + Issuer Integration (due: 2026-04-03)
- M3 Security + Operations (due: 2026-04-24)
- M4 Pilot Launch (due: 2026-05-15)
- M5 Stabilization + Scale Decision (due: 2026-05-29)

## 7. Pilot KPIs and Go/No-Go Gates
- Card issue success >= 97%
- Top-up success >= 99%
- p95 create-card latency < 12 sec
- Unresolved reconciliation mismatches < 0.5%
- Security incidents on sensitive endpoints = 0

## 8. Decision Log (initial)
- First chain for pilot is Stellar.
- Payment rail for API monetization is x402.
- Card issuing provider for pilot is 4payments.
- Product operations must be GitHub-centered.
- Arbitrum and Solana are phase-2 rails after Stellar pilot KPIs are met.

## 9. Weekly Cadence
- Monday: backlog prioritization and scope lock.
- Wednesday: risk/security/reliability review.
- Friday: acceptance review, release gate, KPI checkpoint.

## 10. Restore-Context Procedure
If context is lost:
1. Read this file.
2. Read Sprint scope: `docs/execution/CTO_SCOPE_SPRINT_01_STELLAR.md`.
3. Read issue backlog: `docs/execution/github/ISSUE_BACKLOG_STELLAR_PILOT.md`.
4. Use creation script: `scripts/github/create_stellar_pilot_issues.sh`.

