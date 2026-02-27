#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-}"

if [[ -z "$REPO" ]]; then
  echo "Usage: $0 <owner/repo>"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: gh CLI is not installed."
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh is not authenticated. Run: gh auth login"
  exit 1
fi

ensure_label() {
  local name="$1"
  local color="$2"
  local description="$3"

  if gh label list --repo "$REPO" --search "$name" --json name --jq '.[].name' | grep -Fxq "$name"; then
    gh label edit "$name" --repo "$REPO" --color "$color" --description "$description" >/dev/null
  else
    gh label create "$name" --repo "$REPO" --color "$color" --description "$description" >/dev/null
  fi
}

ensure_milestone() {
  local title="$1"
  local due="$2"
  local description="$3"

  if gh api "repos/$REPO/milestones" --paginate --jq '.[].title' | grep -Fxq "$title"; then
    return 0
  fi

  gh api "repos/$REPO/milestones" \
    -X POST \
    -f title="$title" \
    -f state="open" \
    -f due_on="$due" \
    -f description="$description" >/dev/null
}

create_issue_if_missing() {
  local key="$1"
  local title="$2"
  local milestone="$3"
  local labels_csv="$4"
  local priority="$5"
  local depends_on="$6"
  local acceptance="$7"

  local search_token="[$key]"
  local exists
  exists="$(gh issue list --repo "$REPO" --state all --search "$search_token in:title" --json number --jq 'length')"

  if [[ "$exists" != "0" ]]; then
    echo "Skip existing: [$key] $title"
    return 0
  fi

  local body
  body=$(cat <<EOB
## Context
Stellar pilot execution backlog item.

## Scope
- $acceptance

## Dependencies
- $depends_on

## Priority
- $priority

## Acceptance Criteria
- Requirement above is implemented and verifiable in staging.
- Tests and observability for the change are added.
- PR passes required checks and is approved.

## Definition of Done
- Merged via PR into protected main.
- Documentation updated and linked in issue/PR.
- No open blocker remains for this scope.
EOB
)

  local -a label_args=()
  IFS=',' read -r -a labels <<<"$labels_csv"
  for lbl in "${labels[@]}"; do
    label_args+=(--label "$lbl")
  done

  gh issue create \
    --repo "$REPO" \
    --title "[$key] $title" \
    --body "$body" \
    --milestone "$milestone" \
    "${label_args[@]}" >/dev/null

  echo "Created: [$key] $title"
}

echo "Ensuring labels..."
ensure_label "type:feature" "0E8A16" "Feature work"
ensure_label "type:ops" "1D76DB" "Operational work"
ensure_label "type:security" "D93F0B" "Security work"
ensure_label "type:bug" "B60205" "Bug fix"
ensure_label "area:api" "5319E7" "API area"
ensure_label "area:payments" "5319E7" "Payments area"
ensure_label "area:issuer" "5319E7" "Issuer integration"
ensure_label "area:webhooks" "5319E7" "Webhook processing"
ensure_label "area:ledger" "5319E7" "Ledger and reconciliation"
ensure_label "area:infra" "5319E7" "Infrastructure"
ensure_label "area:observability" "5319E7" "Observability"
ensure_label "area:pilot" "5319E7" "Pilot operations"
ensure_label "area:github" "5319E7" "GitHub process"
ensure_label "priority:p0" "B60205" "Highest priority"
ensure_label "priority:p1" "D93F0B" "High priority"
ensure_label "priority:p2" "FBCA04" "Normal priority"

echo "Ensuring milestones..."
ensure_milestone "M1 Foundation" "2026-03-13T23:59:59Z" "Repository and architecture foundation"
ensure_milestone "M2 Payments+Issuer" "2026-04-03T23:59:59Z" "x402 and issuer integration"
ensure_milestone "M3 Security+Ops" "2026-04-24T23:59:59Z" "Security hardening and ops readiness"
ensure_milestone "M4 Pilot Launch" "2026-05-15T23:59:59Z" "Closed pilot launch"
ensure_milestone "M5 Stabilization" "2026-05-29T23:59:59Z" "Stabilization and scale decision"

echo "Creating issues..."
issues=(
"GH-001|Bootstrap repositories and baseline docs|M1 Foundation|type:ops,area:github,priority:p0|p0|-|repos/README/CONTRIBUTING/CODEOWNERS exist"
"GH-002|Enable branch protection and required checks|M1 Foundation|type:ops,area:github,priority:p0|p0|GH-001|direct pushes blocked and checks required"
"GH-003|Create GitHub Project workflow|M1 Foundation|type:ops,area:github,priority:p1|p1|GH-001|project fields and states configured"
"GH-004|Add issue templates|M1 Foundation|type:ops,area:github,priority:p1|p1|GH-001|feature/bug/security/incident templates live"
"GH-005|Add PR template with DoD checklist|M1 Foundation|type:ops,area:github,priority:p1|p1|GH-001|PR template enforced in repo"
"PLAT-001|API module skeleton and route map|M1 Foundation|type:feature,area:api,priority:p0|p0|GH-002|routes compile and run in staging"
"PLAT-002|Environment schema and config validation|M1 Foundation|type:feature,area:infra,priority:p0|p0|PLAT-001|startup fails on invalid env"
"PLAT-003|DB migrations for core entities|M1 Foundation|type:feature,area:ledger,priority:p0|p0|PLAT-001|migrations apply and rollback cleanly"
"PLAT-004|Request tracing and idempotency middleware|M1 Foundation|type:feature,area:api,priority:p1|p1|PLAT-001|request_id and idempotency key logged"
"PAY-001|Implement x402 challenge for paid endpoints|M1 Foundation|type:feature,area:payments,priority:p0|p0|PLAT-001|create and fund return valid 402 challenge"
"PAY-002|Integrate facilitator verify settle supported|M2 Payments+Issuer|type:feature,area:payments,priority:p0|p0|PAY-001|verify and settle integration-tested"
"PAY-003|Payment ledger persistence model|M2 Payments+Issuer|type:feature,area:ledger,priority:p0|p0|PLAT-003|proof and settlement stored atomically"
"PAY-004|Retry and timeout policy for settlement|M2 Payments+Issuer|type:feature,area:payments,priority:p1|p1|PAY-002|retries bounded and observable"
"ISS-001|Implement 4payments auth client|M2 Payments+Issuer|type:feature,area:issuer,priority:p0|p0|PLAT-002|bearer auth and typed errors"
"ISS-002|Implement card issue adapter call|M2 Payments+Issuer|type:feature,area:issuer,priority:p0|p0|ISS-001|issue call mapped and tested"
"ISS-003|Implement card topup adapter call|M2 Payments+Issuer|type:feature,area:issuer,priority:p0|p0|ISS-001|topup call mapped and tested"
"ISS-004|Implement freeze and unfreeze adapter calls|M2 Payments+Issuer|type:feature,area:issuer,priority:p1|p1|ISS-001|state transitions reflected in API"
"ISS-005|Implement list details sensitive adapters|M2 Payments+Issuer|type:feature,area:issuer,priority:p1|p1|ISS-001|details endpoints functional with masking"
"ISS-006|Enforce 1 rps queue for issue and topup|M2 Payments+Issuer|type:feature,area:issuer,priority:p0|p0|ISS-002,ISS-003|rate limit contract respected"
"WH-001|Webhook endpoint with HMAC verification|M3 Security+Ops|type:security,area:webhooks,priority:p0|p0|ISS-001|invalid signatures rejected"
"WH-002|Idempotent webhook event processing|M3 Security+Ops|type:feature,area:webhooks,priority:p0|p0|WH-001|duplicate events ignored safely"
"WH-003|Webhook retries and dead-letter queue|M3 Security+Ops|type:feature,area:webhooks,priority:p1|p1|WH-002|failed events retried and quarantined"
"LED-001|Implement operation ledger linking|M3 Security+Ops|type:feature,area:ledger,priority:p0|p0|PAY-003,ISS-002|payment issuer operation linkage complete"
"REC-001|Reconciliation worker for mismatch detection|M3 Security+Ops|type:feature,area:ledger,priority:p0|p0|LED-001|daily mismatch report produced"
"SEC-001|Secrets management and key rotation plan|M3 Security+Ops|type:security,area:infra,priority:p0|p0|PLAT-002|secrets loaded from secure store"
"SEC-002|Sensitive data access audit logs|M3 Security+Ops|type:security,area:api,priority:p0|p0|ISS-005|every PAN CVV access audited"
"SEC-003|Wallet auth anti replay hardening|M3 Security+Ops|type:security,area:payments,priority:p1|p1|PLAT-004|timestamp and nonce replay blocked"
"OBS-001|Define metrics and SLO dashboards|M3 Security+Ops|type:feature,area:observability,priority:p1|p1|PAY-002,ISS-003|core KPI dashboards available"
"OBS-002|Alert policies for payment issuer webhook failures|M3 Security+Ops|type:feature,area:observability,priority:p1|p1|OBS-001|alert rules tested in staging"
"PILOT-001|Pilot tenant onboarding checklist|M4 Pilot Launch|type:feature,area:pilot,priority:p0|p0|M1-M3 done|10 pilot tenants onboarded"
"PILOT-002|KPI board and go no go report|M4 Pilot Launch|type:feature,area:pilot,priority:p0|p0|OBS-001|weekly KPI report generated"
"PILOT-003|Release playbook and rollback runbook|M4 Pilot Launch|type:ops,area:pilot,priority:p0|p0|OBS-002|release and rollback dry run completed"
"PILOT-004|Stabilization plan and scale decision memo|M5 Stabilization|type:ops,area:pilot,priority:p0|p0|PILOT-001,PILOT-002,PILOT-003|scale decision documented"
)

for row in "${issues[@]}"; do
  IFS='|' read -r key title milestone labels priority depends acceptance <<<"$row"
  create_issue_if_missing "$key" "$title" "$milestone" "$labels" "$priority" "$depends" "$acceptance"
done

echo "Done. Backlog synced to GitHub: $REPO"
