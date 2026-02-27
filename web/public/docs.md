# ASG Card Docs (LLM-Friendly)

ASG Card is an API for issuing and managing virtual Visa cards for AI agents.

- Payments use **USDC on Stellar**
- Paid endpoints use **x402**
- Card management endpoints use **wallet signature authentication**

## Links

- Website: https://asgcard.dev/
- HTML docs: https://asgcard.dev/docs
- OpenAPI: https://asgcard.dev/openapi.json

## Base URL

`https://api-stellar.asgcard.dev`

## Overview

ASG Card exposes three endpoint classes:

1. **Public** (no auth): health, pricing, tiers
2. **Paid (x402)**: create/fund cards after USDC payment on Stellar
3. **Wallet-signed**: card listing and management operations

## Install (SDK)

```bash
npm install @asgcard/sdk stellar-sdk
```

## Authentication

### x402 (Paid Endpoints)

Paid endpoints return an x402 challenge when payment proof is missing.
Client flow:

1. Call paid endpoint
2. Receive `402` challenge
3. Pay USDC on Stellar
4. Retry request with payment proof header

### Wallet Signature (Card Management)

Wallet-signed endpoints require a valid Stellar wallet signature (Ed25519).

## Public Endpoints

### `GET /health`

Health check endpoint.

Example response:

```json
{
  "status": "ok",
  "timestamp": "2026-02-11T14:00:00.000Z",
  "version": "1.0.0"
}
```

### `GET /pricing`

Returns pricing breakdown for card creation and funding tiers.

### `GET /cards/tiers`

Returns available tier amounts and fee breakdowns.

## Paid Endpoints (x402)

### `POST /cards/create/tier/:amount`

Create a new virtual card preloaded with a supported tier amount.

Supported examples in docs:
`10`, `25`, `50`, `100`, `200`, `500`

Request body:

```json
{
  "nameOnCard": "AGENT ALPHA",
  "email": "agent@example.com"
}
```

Returns:

- card summary (`cardId`, status, balance)
- payment info (`amountCharged`, txHash, network`)
- sensitive card details (`cardNumber`, `cvv`, `expiry`, billing address)

### `POST /cards/fund/tier/:amount`

Add funds to an existing card by supported funding tier.

Request body:

```json
{
  "cardId": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Wallet-Signed Endpoints

### `GET /cards`

List cards owned by the authenticated wallet.

### `GET /cards/:cardId`

Get card metadata and balances.

### `GET /cards/:cardId/details`

Get sensitive card details.

Notes:
- Rate limited to **3 requests per card per hour** (per docs)

### `POST /cards/:cardId/freeze`

Freeze a card.

### `POST /cards/:cardId/unfreeze`

Unfreeze a card.

## Errors

Non-2xx responses return:

```json
{ "error": "Human-readable error message" }
```

Common statuses:

- `400` invalid body / unsupported tier
- `401` invalid wallet auth or payment proof
- `402` x402 payment challenge
- `404` card not found
- `429` rate limit exceeded
- `500` internal error

## Rate Limits

Highlighted docs limit:
- `GET /cards/:cardId/details`: **3 requests per card per hour**

## Notes for Agents / Integrators

- Prefer `GET /pricing` or `GET /cards/tiers` before selecting tier amounts.
- Treat `402` as an expected step for paid endpoints (x402 flow), not a terminal error.
- Sensitive card details should be requested only when strictly required.

## Canonical Source

For the latest UI docs and examples, use:
https://asgcard.dev/docs

Last updated: 2026-02-23

