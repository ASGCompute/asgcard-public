# ASG Card

ASG Card is an agent-focused virtual card platform with x402 payments, currently preparing a Stellar-first pilot.

## Workspace

- `/api` - ASG Card API (Express + x402 + wallet auth)
- `/sdk` - `@asgcard/sdk` TypeScript client
- `/web` - main ASG Card website
- `/web-stellar-mg` - isolated Stellar + MoneyGram landing/docs variant

## Quick Start

```bash
npm install
```

Run API and web app in separate terminals:

```bash
# Terminal 1: API
npm run dev:api

# Terminal 2: Web
npm run dev
```

- Stellar-only landing/docs variant (separate folder, does not modify main web):

```bash
npm run dev:stellar
```

- API defaults to `http://localhost:3000`.
- Web defaults to `http://localhost:3001`.
- Stellar variant defaults to Vite dev server auto-port (typically `http://localhost:3001` if free).
- Web pricing requests go directly to `http://localhost:3000/pricing` in local dev.
- In production, web fetches pricing via same-origin `/api/pricing` (Vercel rewrite to `api.asgcard.dev`).
- Optional override: set `VITE_API_BASE_URL` in web env to force a specific API origin.

## Founder/CTO Execution Context (Stellar Pilot)

- Persistent operating context: `docs/execution/FOUNDER_CTO_OPERATING_CONTEXT_STELLAR.md`
- Full CTO onboarding + scope: `docs/execution/CTO_FULL_CONTEXT_AND_SCOPE_STELLAR.md`
- First CTO scope: `docs/execution/CTO_SCOPE_SPRINT_01_STELLAR.md`
- CTO Day 1–2 execution packet: `docs/execution/CTO_DAY1_DAY2_EXECUTION_PACKET.md`
- GitHub backlog (canonical): `docs/execution/github/ISSUE_BACKLOG_STELLAR_PILOT.md`
- GitHub backlog (CSV): `docs/execution/github/stellar_pilot_issue_backlog.csv`
- Auto-create issues via `gh`: `scripts/github/create_stellar_pilot_issues.sh`
- Audit GitHub backlog consistency: `scripts/github/audit_stellar_pilot_backlog.sh`
