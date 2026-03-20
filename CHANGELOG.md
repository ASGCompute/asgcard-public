# Changelog

## [0.4.0-beta.1] - 2026-03-19
### Added
- **Stripe Machine Payments Beta:** New `stripe.asgcard.dev` beta surface for Stripe MPP integration.
- **Rail-Agnostic Payment Model:** `payment_rail`, `payment_reference`, `payment_status`, `issuer_provider` columns on `cards` table (migration `013_payment_rails.sql`).
- **Beta Create-Card Route:** `POST /stripe-beta/create` — wallet-auth + feature-flagged route for card creation via Stripe MPP rail.
- **Feature Flags:** `STRIPE_MPP_BETA_ENABLED` and `STRIPE_BETA_ALLOWLIST` env vars for beta kill switch and allowlist.
- **Beta Frontend Surface:** `web/stripe/` — premium landing page with 3-step flow, same/different comparison, analytics events.

### Changed
- `cardService.createCard` and `fundCard` now return `rail` and `reference` alongside legacy `txHash`/`network` fields for backward compat.
- `paid.ts` explicitly passes `paymentRail: "stellar_x402"` for Stellar flow.
- Vite multi-page config updated with `stripe` entry.

### Non-Breaking
- All existing Stellar x402 flows, wallet management, and SDK/CLI consumers remain unchanged.
- Legacy `txHash` and `network: "stellar"` fields preserved in API responses for backward compat.

## [0.3.1] - 2026-03-04
### Added
- **REALIGN Agent Details Flow:** Agent-first PAN/CVV retrieval via `detailsEnvelope` upon card creation.
- **Card Details Endpoint:** Added `GET /cards/:id/details` secured by one-time `X-AGENT-NONCE` and wallet signatures to prevent replay attacks.
- **Owner Revocation:** Added Owner Portal endpoints to revoke and restore agent access to card details (`/portal/cards/:id/revoke-details`).
- Postgres schema update (004_agent_access.sql) for `agent_nonces` and `details_revoked` state.
