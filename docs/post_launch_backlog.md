# ASG Card - Post-Launch Backlog (v0.3.1 LIVE)

## Strict Rules

- **No Hotfixes in Prod directly:** Any fix MUST go through standard Git-flow. No manual snowflake patches on the production environment.
- **Agent Details Access:** `AGENT_DETAILS_ENABLED` must remain `true`.

## Backlog Items

### SLA Hardening

- Implement redis-backed distributed rate limiters for agent nonces instead of in-memory maps to support multi-instance scaling.
- Alerting for Facilitator API latency p95 > 2s.

### Scale & Observability

- Export anonymized / masked card request metrics to Datadog / Prometheus.
- Auto-scaling rules for the Vercel API instances.
- Rotate `CARD_DETAILS_KEY` safely with zero downtime.

### Tech Debt

- Migrate remaining in-memory states (like read windows for rate limiting) to Postgres / Redis.
- Setup rigorous automated load testing.
