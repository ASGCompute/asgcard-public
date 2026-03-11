# SCF #42 Application Pack — ASG Card

Last updated: 2026-03-11  
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

## 9) Revised Milestone Copy (Technical-Only, SCF-Safe)

This version is stronger than the first draft for three reasons:

1. It removes weak wording like `setup costs` and `bootstrapping`.
2. It frames each tranche as a verifiable development milestone, which matches current SCF guidance.
3. It avoids over-promising a full Soroban smart-wallet system before core payment and issuer flows are production-ready.

### Deliverable 1: x402 Payment Flow + Sandbox Issuer Integration

Brief description:  
This milestone delivers the first working product loop for ASG Card on Stellar testnet. We will implement the x402 challenge-response server flow, connect the API to Stellar testnet USDC payment verification, and integrate our card issuer's sandbox environment for card provisioning. The result is a staging system where an agent can request a card, receive an HTTP 402 challenge, pay testnet USDC, and automatically receive a provisioned sandbox card through the issuer integration.

How to measure completion:  
A staging API is live and publicly testable. A request to the paid card-creation endpoint returns a valid 402 challenge. After a successful Stellar testnet USDC payment, the system verifies the payment, completes the issuer sandbox call, and returns a mock or sandbox virtual card response end-to-end.

Budget allocation:  
`$24,000` allocated to Milestone 1 development work.

### Deliverable 2: Wallet Authentication Layer + Agent Spend Controls

Brief description:  
This milestone adds the authenticated control plane for ASG Card. We will implement wallet-based request authentication for card management actions, add reusable agent wallet/signing support for Stellar-compatible clients, and connect policy controls such as freeze/unfreeze, spending limits, and merchant restrictions to the issuer sandbox. Where possible, this milestone should explicitly reference the chosen SCF Integration Track building block, for example `Stellar Wallets Kit` or `Freighter Connect`, if those are part of the submitted scope.

How to measure completion:  
Agents or wallet-enabled clients can sign management requests using Stellar-compatible credentials and successfully authenticate against the ASG Card API. The authenticated routes reach the issuer sandbox and enforce configured card-management controls, including at minimum card state changes and spend-policy configuration.

Budget allocation:  
`$36,000` allocated to Milestone 2 development work.

### Deliverable 3: Mainnet Deployment + Production Integration Release

Brief description:  
This milestone delivers the production release of ASG Card on Stellar mainnet. We will deploy the paid API to production, enable live USDC payment handling on Stellar mainnet, transition the issuer integration from sandbox to production, and publish the final developer package for integrating Stellar-based agent payments and card provisioning. This includes production documentation, operational monitoring, and a reusable integration module or SDK for developers.

How to measure completion:  
ASG Card is live on Stellar mainnet. A production client can trigger a valid 402 payment flow, complete a real USDC payment on Stellar mainnet, and receive a live provisioned card through the production issuer path. Production API documentation and integration documentation are published, and monitoring is in place for payment, issuer, and webhook flows.

Budget allocation:  
`$48,000` allocated to Milestone 3 development work.

## 10) Important Budget Note (SCF Tranche Math)

SCF Build currently pays awards in 4 payments:

- `Tranche 0`: 10% on award acceptance
- `Tranche 1`: 20%
- `Tranche 2`: 30%
- `Tranche 3`: 40%

That means:

1. If you keep milestone allocations of `$24k + $36k + $48k`, you should present the total award ask as `$120k`, because those numbers match the `20/30/40` structure and imply a `Tranche 0` payment of `$12k`.
2. If your true total ask is `$108k`, then the SCF payout equivalents would be:
- `Tranche 0`: `$10.8k`
- `Tranche 1`: `$21.6k`
- `Tranche 2`: `$32.4k`
- `Tranche 3`: `$43.2k`

Reviewer note:
Do not describe the milestone budgets as the literal tranche payout schedule unless they match the SCF payment percentages.

## 11) Integration Track Positioning Note

Current risk in the draft:

1. `Issuer partner` is important to the product, but it is not by itself a Stellar ecosystem building block.
2. For Integration Track, SCF requires you to choose at least one approved ecosystem integration from the current list, and most of the requested budget should go toward that integration work.

To reduce reviewer pushback:

1. Explicitly name the Stellar-side integration in the form.
2. Good candidates, if they are truly in scope, are `Stellar Wallets Kit`, `Freighter Connect`, or `MoneyGram`, depending on the exact product path you want to claim.
3. If you do not want to commit to one of those ecosystem building blocks, your project may read more like `Open Track` than `Integration Track`.
