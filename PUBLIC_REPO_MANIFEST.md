# Public Repository Manifest

This repository (`ASGCompute/asgcard-public`) is a **read-only public mirror** of the private operational repository. It is intended for external review, community reference, and transparency.

## What Is Included

| Directory | Contents |
|---|---|
| `api/src/` | API source code (Express, x402 middleware, routes) |
| `api/__tests__/` | Unit and integration tests |
| `api/scripts/` | Automation scripts (preflight, E2E) |
| `sdk/src/` | Official SDK source code |
| `web/src/` | Frontend source (landing, docs page) |
| `web/public/` | Static assets (openapi.json, docs.md, icons) |
| `docs/adr/` | Architecture Decision Records |
| `docs/` | Public-facing technical docs |
| `.github/workflows/` | CI configuration (gitleaks, secret scan) |
| Root | README, LICENSE (MIT), CONTRIBUTING, AUDIT |

## What Is Excluded

| Category | Reason |
|---|---|
| `.env`, `.env.production`, `.env.pulled` | Contains secrets |
| `e2e_*.js`, `test_webhook_prod*.js` | Production debug scripts |
| `*-report.json`, `*-report.md` | Ops reports with environment data |
| `.vercel/` | Deploy tokens and project links |
| `.playwright-cli/` | Local test artifacts |
| `docs/execution/`, `docs/grants/` | Internal planning documents |
| `docs/BASELINE_SNAPSHOT.md`, `docs/COMMS_PACK.md` | Operational communications |
| `web-stellar-mg/` | Legacy internal copy |
| `scripts/checkpoint-*.sh`, `scripts/financial_model.py` | Internal ops scripts |
| `output/`, `*.xlsx` | Generated artifacts and financial data |
| `dist/`, `node_modules/` | Build output and dependencies |

## Synchronization

This mirror is updated periodically from the private repository. To sync:

```bash
# From the private repo root:
./scripts/sync-public-mirror.sh
```

### Sync Script Logic

1. Copy allowlisted paths to staging directory
2. Run secret pattern scan (must pass with 0 findings)
3. Commit and push to `ASGCompute/asgcard-public`

> **Note:** Never push directly to this repo. All changes flow through the private repo first.

## Security

- Gitleaks runs on every push and PR
- Custom secret pattern check validates no `.env` files or hardcoded keys
- Report vulnerabilities to `security@asgcard.dev` (see SECURITY.md)
