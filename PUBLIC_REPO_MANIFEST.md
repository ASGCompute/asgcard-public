# Public Repository Manifest

This repository (`ASGCompute/asgcard-public`) is a **read-only public mirror** of the private operational repository.

## Included

| Directory | Contents |
|---|---|
| `api/src/` | API source (Express, x402 middleware, routes) |
| `api/__tests__/` | Unit and integration tests |
| `api/scripts/` | Automation scripts (preflight, E2E) |
| `sdk/src/` | SDK source (`@asgcard/sdk`) |
| `web/src/` | Frontend source (landing, docs page) |
| `web/public/` | Static assets (openapi.json, docs.md, icons) |
| `web/docs/` | Docs page entry |
| `docs/adr/` | Architecture Decision Records |
| `.github/workflows/` | CI (gitleaks, secret scan, content guardrail) |
| Root | README, LICENSE (MIT), CONTRIBUTING, AUDIT, SECURITY |

## Excluded (never published)

| Category | Examples |
|---|---|
| **Secrets / env** | `.env`, `.env.production`, `.env.pulled`, `.env.local` |
| **Debug scripts** | `e2e_*.js`, `test_webhook_prod*.js` |
| **Ops reports** | `*-report.json`, `*-report.md`, `BASELINE_SNAPSHOT.md` |
| **Deploy config** | `.vercel/` project tokens |
| **Internal ops docs** | `ROLLBACK_RUNBOOK.md`, `MCP_EVALUATION.md`, `SW_POC_SPEC.md` |
| **Internal planning** | `docs/execution/`, `docs/grants/`, `COMMS_PACK.md`, `CTO_TZ.md` |
| **Partner variants** | Internal partner-specific web variants |
| **Financial data** | `*.xlsx`, financial models |
| **Build artifacts** | `dist/`, `node_modules/`, `.playwright-cli/` |
| **Local tools** | `gh.zip`, `gh_extracted/`, `output/` |

## Synchronization

All changes flow through the private repo → staging → push to public. Never push directly.

## Security

- Gitleaks runs on every push and PR
- Content guardrail CI blocks internal terms (`Founder/CTO`, `docs/execution`, `OpenCard`, etc.)
- Report vulnerabilities to `security@asgcard.dev` (see SECURITY.md)
