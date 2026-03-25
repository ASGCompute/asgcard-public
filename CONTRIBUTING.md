# Contributing to ASG Card

Thank you for your interest in contributing to ASG Card! This document provides guidelines and information to make the contribution process smooth for everyone.

## 🆕 Your First Contribution

New to the project? Here's how to get started:

1. **Browse [`good first issue`](https://github.com/ASGCompute/asgcard/labels/good%20first%20issue)** — these are beginner-friendly tasks curated by maintainers.
2. **Check [`help wanted`](https://github.com/ASGCompute/asgcard/labels/help%20wanted)** — these are tasks where we actively need community help.
3. **Fork the repo**, create a branch, make your changes, and open a Pull Request.

Not sure where to start? Open a [Discussion](https://github.com/ASGCompute/asgcard/discussions) and ask — we're happy to help!

## 📝 Non-Code Contributions

Code isn't the only way to help. We deeply value:

- **Documentation** — fix typos, improve explanations, add examples
- **Translations** — help us reach developers worldwide (see `README.zh-CN.md`)
- **Bug triage** — reproduce reported bugs, add details, suggest labels
- **Design** — UI/UX improvements, diagrams, visual assets
- **Testing** — write test cases, report edge cases

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

Scopes: `api`, `sdk`, `web`, `cli`, `mcp-server`, `gateway`, `payments`, `issuer`, `webhooks`, `ledger`, `infra`

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

## 🎓 Mentorship — The 3Cs Framework

We believe in growing contributors into long-term collaborators:

1. **Connect** — Introduce yourself in a Discussion or issue comment. We'll help you find the right task.
2. **Contribute** — Start with a `good first issue`, then graduate to `help wanted` tasks.
3. **Commit** — Consistent contributors are invited to become maintainers with write access and code review responsibilities.

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold these standards.
