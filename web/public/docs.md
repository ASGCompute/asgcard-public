# ASG Card Docs (LLM-Friendly)

ASG Card is an API for issuing and managing virtual Visa cards for AI agents.

- Payments use **USDC on Stellar**
- Paid endpoints use **x402 v2**
- Card management endpoints use **wallet signature authentication**
- **Agent-first model**: the creating agent receives full PAN/CVV immediately at creation time
- **Owner controls**: card owner can revoke/restore agent access to card details via Telegram portal

## Links

- Website: <https://asgcard.dev/>
- HTML docs: <https://asgcard.dev/docs>
- OpenAPI: <https://asgcard.dev/openapi.json>

## Base URL

`https://api.asgcard.dev`

**API version**: `0.3.1`

## Overview

ASG Card exposes five endpoint classes:

1. **Public** (no auth): health, pricing, tiers
2. **Paid (x402)**: create/fund cards after USDC payment on Stellar
3. **Wallet-signed**: card listing, details access, freeze/unfreeze
4. **Portal** (owner actions): revoke/restore agent access to card details
5. **Ops** (admin): metrics, rollout, nonce cleanup — secured by OPS_API_KEY

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
  "timestamp": "2026-03-04T14:00:00.000Z",
  "version": "0.3.1"
}
```

### `GET /pricing`

Returns pricing breakdown for card creation and funding tiers.

### `GET /cards/tiers`

Returns available tier amounts and fee breakdowns.

## Paid Endpoints (x402)

### `POST /cards/create/tier/:amount`

Create a new virtual card preloaded with a supported tier amount.

Supported tiers: `10`, `25`, `50`, `100`, `200`, `500`

Request body:

```json
{
  "nameOnCard": "AGENT ALPHA",
  "email": "agent@example.com"
}
```

Returns (201):

- `card` — card summary (`cardId`, status, balance)
- `payment` — payment info (`amountCharged`, `txHash`, `network`)
- `details` — **agent-first**: full PAN, CVV, expiry, billing address (only when `AGENT_DETAILS_ENABLED=true`)

> **Security note**: PAN/CVV are returned only in the HTTP response to the creating agent.
> They are **never** logged, stored in metrics, or shown in Telegram bot messages.

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

Get sensitive card details (PAN, CVV, expiry).

**Required headers:**

| Header | Description |
|--------|-------------|
| `X-WALLET-ADDRESS` | Stellar public key |
| `X-WALLET-SIGNATURE` | Ed25519 signature |
| `X-WALLET-TIMESTAMP` | Unix timestamp |
| `X-AGENT-NONCE` | UUID v4, unique per request (anti-replay) |

**Response codes:**

| Code | Meaning |
|------|---------|
| `200` | Success — returns `{ details: { cardNumber, cvv, expiryMonth, expiryYear, billingAddress } }` |
| `403` | Card details access revoked by owner |
| `409` | Nonce already used (replay detected) — `{ error, code: "REPLAY_REJECTED" }` |
| `429` | Rate limit exceeded (max 3 unique nonces per card per hour) |

### `POST /cards/:cardId/freeze`

Freeze a card.

### `POST /cards/:cardId/unfreeze`

Unfreeze a card.

## Portal Endpoints (Owner Actions)

### `POST /portal/cards/:cardId/revoke-details`

Owner revokes agent access to card details. After revoking, `GET /cards/:cardId/details` returns `403`.

### `POST /portal/cards/:cardId/restore-details`

Owner restores agent access to card details. After restoring, `GET /cards/:cardId/details` returns `200` again.

## Errors

Non-2xx responses return:

```json
{ "error": "Human-readable error message" }
```

Common statuses:

- `400` invalid body / unsupported tier
- `401` invalid wallet auth or payment proof
- `402` x402 payment challenge
- `403` details access revoked by owner
- `404` card not found
- `409` nonce replay detected
- `429` rate limit exceeded
- `500` internal error

## Rate Limits

- `GET /cards/:cardId/details`: **3 unique nonces per card per hour**

## Notes for Agents / Integrators

- Prefer `GET /pricing` or `GET /cards/tiers` before selecting tier amounts.
- Treat `402` as an expected step for paid endpoints (x402 flow), not a terminal error.
- Generate a new UUID v4 for each `GET /details` request and pass it as `X-AGENT-NONCE`.
- If you receive `409`, you accidentally reused a nonce — generate a new one and retry.
- The Telegram bot does **not** display PAN/CVV. Only the API response contains them.
- Sensitive card details should be requested only when strictly required.

## Canonical Source

For the latest UI docs and examples, use:
<https://asgcard.dev/docs>

Last updated: 2026-03-04 | Version: 0.3.1
