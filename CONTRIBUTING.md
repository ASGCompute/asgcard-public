# Contributing to ASG Card

## Development Workflow

1. **All work is tracked in GitHub Issues.** Do not start work without an associated issue.
2. **Branch from `main`** using the naming convention: `<type>/<issue-key>-<short-description>`
   - Examples: `feat/PLAT-001-api-skeleton`, `fix/ISS-002-topup-mapping`, `docs/GH-004-issue-templates`
3. **Open a PR** against `main` when ready for review.
4. **PR must pass all required checks** (lint, typecheck, tests, security scan) before merge.
5. **Minimum 1 approval** required (2 for security-labeled issues).
6. **Squash merge** to keep `main` history clean.

## Commit Convention

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer: Closes #<issue-number>]
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`, `security`

Scopes: `api`, `sdk`, `web`, `gateway`, `payments`, `issuer`, `webhooks`, `ledger`, `infra`

## Code Standards

- TypeScript strict mode (`"strict": true`) everywhere.
- Zod for all runtime validation (env, request bodies, external API responses).
- No hardcoded secrets or PII in source code or logs.
- PAN/CVV must never appear in log output.

## Review Policy

- Every PR needs at least 1 reviewer approval.
- Security-labeled PRs need 2 approvals + security owner sign-off.
- Reviewers must verify:
  - Tests cover new/changed behavior.
  - Observability (logs/metrics) is added where applicable.
  - Documentation is updated if API surface changes.

## Local Development

```bash
npm install          # install all workspace dependencies
npm run dev:api      # start API on :3000
npm run dev          # start web on :3001
npm run typecheck    # type-check all workspaces
```
