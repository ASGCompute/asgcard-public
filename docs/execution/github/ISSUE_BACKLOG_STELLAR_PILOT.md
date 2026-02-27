# Issue Backlog — Stellar Pilot (GitHub Ready)

Version: 2026-02-27
Purpose: canonical backlog for GitHub issue creation.

## Labels Convention
- Type: `type:feature`, `type:ops`, `type:security`, `type:bug`
- Area: `area:api`, `area:payments`, `area:issuer`, `area:webhooks`, `area:ledger`, `area:infra`, `area:observability`, `area:pilot`, `area:github`
- Priority: `priority:p0`, `priority:p1`, `priority:p2`

## Milestones
- `M1 Foundation` (due 2026-03-13)
- `M2 Payments+Issuer` (due 2026-04-03)
- `M3 Security+Ops` (due 2026-04-24)
- `M4 Pilot Launch` (due 2026-05-15)
- `M5 Stabilization` (due 2026-05-29)

## Backlog

| ID | Title | Milestone | Labels | Priority | Depends On | Acceptance (short) |
|---|---|---|---|---|---|---|
| GH-001 | Bootstrap repositories and baseline docs | M1 Foundation | type:ops,area:github | p0 | - | repos/README/CONTRIBUTING/CODEOWNERS exist |
| GH-002 | Enable branch protection and required checks | M1 Foundation | type:ops,area:github | p0 | GH-001 | direct pushes blocked, checks required |
| GH-003 | Create GitHub Project workflow | M1 Foundation | type:ops,area:github | p1 | GH-001 | project fields and states configured |
| GH-004 | Add issue templates | M1 Foundation | type:ops,area:github | p1 | GH-001 | feature/bug/security/incident templates live |
| GH-005 | Add PR template with DoD checklist | M1 Foundation | type:ops,area:github | p1 | GH-001 | PR template enforced in repo |
| PLAT-001 | API module skeleton and route map | M1 Foundation | type:feature,area:api | p0 | GH-002 | routes compile and run in staging |
| PLAT-002 | Environment schema and config validation | M1 Foundation | type:feature,area:infra | p0 | PLAT-001 | startup fails on invalid env |
| PLAT-003 | DB migrations for core entities | M1 Foundation | type:feature,area:ledger | p0 | PLAT-001 | migrations apply/rollback cleanly |
| PLAT-004 | Request tracing + idempotency middleware | M1 Foundation | type:feature,area:api | p1 | PLAT-001 | request_id and idempotency key logged |
| PAY-001 | Implement x402 challenge for paid endpoints | M1 Foundation | type:feature,area:payments | p0 | PLAT-001 | create/fund returns valid 402 challenge |
| PAY-002 | Integrate facilitator client verify/settle/supported | M2 Payments+Issuer | type:feature,area:payments | p0 | PAY-001 | verify+settle path integration-tested |
| PAY-003 | Payment ledger persistence model | M2 Payments+Issuer | type:feature,area:ledger | p0 | PLAT-003 | proof and settlement stored atomically |
| PAY-004 | Retry and timeout policy for payment settlement | M2 Payments+Issuer | type:feature,area:payments | p1 | PAY-002 | retries bounded and observable |
| ISS-001 | Implement 4payments auth client | M2 Payments+Issuer | type:feature,area:issuer | p0 | PLAT-002 | bearer auth + typed errors |
| ISS-002 | Implement card issue adapter call | M2 Payments+Issuer | type:feature,area:issuer | p0 | ISS-001 | issue call mapped and tested |
| ISS-003 | Implement card topup adapter call | M2 Payments+Issuer | type:feature,area:issuer | p0 | ISS-001 | topup call mapped and tested |
| ISS-004 | Implement freeze/unfreeze adapter calls | M2 Payments+Issuer | type:feature,area:issuer | p1 | ISS-001 | state transitions reflected in API |
| ISS-005 | Implement list/details/sensitive adapters | M2 Payments+Issuer | type:feature,area:issuer | p1 | ISS-001 | details endpoints functional with masking |
| ISS-006 | Enforce 1 rps queue for issue/topup operations | M2 Payments+Issuer | type:feature,area:issuer | p0 | ISS-002,ISS-003 | no rate-limit bursts above provider contract |
| WH-001 | Webhook endpoint with HMAC verification | M3 Security+Ops | type:security,area:webhooks | p0 | ISS-001 | invalid signatures rejected |
| WH-002 | Idempotent webhook event processing | M3 Security+Ops | type:feature,area:webhooks | p0 | WH-001 | duplicate events ignored safely |
| WH-003 | Webhook retry handling and dead-letter queue | M3 Security+Ops | type:feature,area:webhooks | p1 | WH-002 | failed events retried and quarantined |
| LED-001 | Implement operation ledger linking | M3 Security+Ops | type:feature,area:ledger | p0 | PAY-003,ISS-002 | payment<->issuer<->card operation linked |
| REC-001 | Reconciliation worker for mismatch detection | M3 Security+Ops | type:feature,area:ledger | p0 | LED-001 | daily mismatch report produced |
| SEC-001 | Secrets management and key rotation plan | M3 Security+Ops | type:security,area:infra | p0 | PLAT-002 | secrets loaded from secure store |
| SEC-002 | Sensitive data access audit logs | M3 Security+Ops | type:security,area:api | p0 | ISS-005 | every PAN/CVV access is audited |
| SEC-003 | Wallet auth anti-replay hardening | M3 Security+Ops | type:security,area:payments | p1 | PLAT-004 | timestamp/nonce replay blocked |
| OBS-001 | Define metrics and SLO dashboards | M3 Security+Ops | type:feature,area:observability | p1 | PAY-002,ISS-003 | core KPI dashboards available |
| OBS-002 | Alert policies for payment/issuer/webhook failures | M3 Security+Ops | type:feature,area:observability | p1 | OBS-001 | alert rules tested in staging |
| PILOT-001 | Pilot tenant onboarding checklist | M4 Pilot Launch | type:feature,area:pilot | p0 | M1-M3 core done | 10 pilot tenants onboarded |
| PILOT-002 | KPI board and go/no-go report | M4 Pilot Launch | type:feature,area:pilot | p0 | OBS-001 | weekly KPI report generated |
| PILOT-003 | Release playbook and rollback runbook | M4 Pilot Launch | type:ops,area:pilot | p0 | OBS-002 | release + rollback dry-run done |
| PILOT-004 | Stabilization plan and scale decision memo | M5 Stabilization | type:ops,area:pilot | p0 | PILOT-001,PILOT-002,PILOT-003 | documented decision for scale-up |

