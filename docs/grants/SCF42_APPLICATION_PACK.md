# SCF #42 Application Pack — ASG Card

Last updated: 2026-02-27  
Prepared for: Stellar Community Fund (SCF #42, Build Award Round)

## 1) Round Snapshot (What matters right now)

- Open round: `SCF #42`
- Track to target: `Build Award -> Integration Track`
- Deadline shown on SCF page: `March 15, 2026, 11:59 PM PT`
- Process: submit `Interest Form` first; if pre-screened, you get invite to full Build submission.
- Referral: SCF explicitly asks whether you were referred by someone from the Stellar community.

Primary links:
- https://communityfund.stellar.org/awards/recweELi12M0ftBYZ
- https://stellar.gitbook.io/scf-handbook/scf-awards/build-awards/how-to-apply
- https://stellar.gitbook.io/scf-handbook/scf-awards/build-awards/build-award-submission-criteria/integration-track
- https://stellar.gitbook.io/scf-handbook/scf-awards/build-awards/build-award-submission-criteria/submission-requirements

## 2) Quick Fit Check (for Interest Form)

ASG Card fits SCF Integration Track because:

1. Product is already implementing Stellar-native x402 payment flows (`/cards/create`, `/cards/fund` with 402 challenge and Stellar settlement path).
2. It targets real usage on Stellar (USDC settlement for AI-agent card issuance and funding).
3. It includes technical architecture + ops plan for pilot execution and measurable adoption KPIs.

Evidence in repo:
- `api/src/middleware/x402.ts`
- `api/src/services/paymentService.ts`
- `api/src/services/facilitatorClient.ts`
- `api/src/middleware/walletAuth.ts`
- `api/src/routes/webhook.ts`
- `web/public/openapi.json`
- `docs/adr/ADR-002-x402-verify-settle-stellar.md`
- `docs/execution/CTO_FULL_CONTEXT_AND_SCOPE_STELLAR.md`

## 3) Interest Form Copy Draft (English)

Use this as copy/paste base and adjust names/numbers before submit.

### Project name
ASG Card

### One-liner
ASG Card enables AI agents to issue and fund virtual cards by paying per action via x402, settled in USDC on Stellar.

### What problem are you solving?
AI agents can execute workflows but still lack safe, programmable payment rails for real-world spend. Existing card and API monetization flows are fragmented, high-friction, and hard to control at the task level.

### What is your solution?
ASG Card provides x402-powered paid endpoints for card issuance and funding. Agent requests trigger a 402 challenge, payment settles on Stellar in USDC, and the agent receives virtual card access with wallet-authenticated management endpoints and policy controls.

### Why Stellar?
Stellar provides fast, low-cost settlement and a growing x402 ecosystem, making it suitable for high-frequency agent payments and micro-transaction API monetization.

### Current stage
Pilot build stage with working API modules, pricing/tier endpoints, x402 challenge flow, facilitator verify/settle integration path, webhook signature verification, and repository-backed persistence tests.

### What you will build in this round
Production-ready Integration Track pilot: hardened x402 settlement flow, issuer integration reliability, and closed pilot launch with measurable transaction and reliability KPIs.

### Referral field (important)
Referred by: `[Friend Full Name]`, `[Role]` at `[Stellar/SDF/Ecosystem org]`.

### Public links
- Website: https://asgcard.dev
- Docs: https://asgcard.dev/docs
- API summary: https://asgcard.dev/openapi.json
- Repo: https://github.com/ASGCompute/asgcard

## 4) Full Submission Requirements (if invited)

SCF Build submission requires:

1. Written responses in the submission form.
2. Pitch deck.
3. Short demo video (2-3 minutes).
4. Milestones and budget in SCF template format.

Not required at submission stage:
- Security audit report.
- End-user/customer interviews.
- Tokenomics.

Integration Track reviewers focus on:
1. Real integration value for Stellar ecosystem.
2. Adoption and measurable traction potential.
3. Technical quality and execution readiness.

## 5) Milestone Draft (Use in SCF template)

Use this structure as baseline:

### Milestone 1 — Payment Rail Hardening (Weeks 1-4)
- Deliverables:
  - Stable x402 v2 challenge/verify/settle flow on Stellar.
  - Replay protection and persistence for payment proofs.
  - Public status endpoints and integration test evidence.
- Success metrics:
  - 95%+ paid-flow success in controlled staging scenarios.
  - No duplicate payment acceptance on replay attempts.

### Milestone 2 — Integration Reliability (Weeks 5-8)
- Deliverables:
  - Hardened issuer + webhook idempotency pipeline.
  - Reconciliation worker + mismatch reporting.
  - Operational runbooks for failure and retry handling.
- Success metrics:
  - Webhook duplicate-safe processing.
  - Mismatch ratio below pilot threshold target.

### Milestone 3 — Closed Pilot Launch (Weeks 9-12)
- Deliverables:
  - Closed cohort onboarding (target 10-30 teams/users).
  - KPI dashboards for settlement and card lifecycle metrics.
  - Pilot report + go/no-go scale recommendation.
- Success metrics:
  - Pilot transaction volume and success rate targets achieved.
  - Launch-readiness checklist complete.

## 6) Budget Framing (for SCF request)

SCF Build supports up to 150,000 XLM.  
Suggested ask range for this scope: `80,000-120,000 XLM` (finalize after burn-rate check).

Suggested split:
- Engineering and integration: 65%
- QA, security, and reliability: 15%
- Infrastructure/observability: 10%
- Developer onboarding and ecosystem support: 10%

## 7) Gaps You Still Need to Fill Before Submit

Do not submit before these are finalized:

1. Referral contact details (exact name + role + org).
2. Legal entity and jurisdiction details for applicant profile.
3. Team section (founder + builders + previous shipped products).
4. Exact funding amount in XLM and milestone-level allocation.
5. Demo video (2-3 minutes).
6. Pitch deck file.
7. Real pilot demand evidence (LOIs, partner messages, or committed pilot users).

## 8) Reviewer-Risk Notes (prepare honest answers)

Potential reviewer questions and safe responses:

1. `Is this already live?`  
Answer: pilot-stage integration with production-oriented architecture and test coverage; closed pilot launch planned in milestone timeline.

2. `How is this different from a generic card API?`  
Answer: payment-is-auth flow via x402 on Stellar, agent-native pricing tiers, and wallet-authenticated control plane.

3. `Any migration risk?`  
Answer: some legacy Solana-era SDK utilities remain in repo; Stellar-first API and integration path are active, and SDK cleanup is included in milestone delivery.
