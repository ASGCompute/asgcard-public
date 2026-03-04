# Changelog

## [0.3.1] - 2026-03-04
### Added
- **REALIGN Agent Details Flow:** Agent-first PAN/CVV retrieval via `detailsEnvelope` upon card creation.
- **Card Details Endpoint:** Added `GET /cards/:id/details` secured by one-time `X-AGENT-NONCE` and wallet signatures to prevent replay attacks.
- **Owner Revocation:** Added Owner Portal endpoints to revoke and restore agent access to card details (`/portal/cards/:id/revoke-details`).
- Postgres schema update (004_agent_access.sql) for `agent_nonces` and `details_revoked` state.
