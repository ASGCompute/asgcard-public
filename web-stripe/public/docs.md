# ASG Card — Stripe Edition Documentation

> USD MasterCard virtual cards for AI agents — powered by Stripe Machine Payments Protocol

## Quick Links

- Stripe Edition: [stripe.asgcard.dev](https://stripe.asgcard.dev)
- Stellar Edition: [asgcard.dev](https://asgcard.dev)
- API: [api.asgcard.dev](https://api.asgcard.dev)
- OpenAPI spec: [asgcard.dev/openapi.json](https://asgcard.dev/openapi.json)

## How It Works — Stripe MPP Flow

The Stripe edition uses an **owner-in-the-loop** model:

1. **Agent creates a session** → `POST /stripe-beta/session` with owner's email
2. **Agent creates a payment request** → `POST /stripe-beta/payment-requests` with amount and card details
3. **Agent receives `approval_required`** + `approvalUrl`
4. **Owner opens approval page** at `stripe.asgcard.dev/approve` → reviews, approves, pays via Stripe
5. **Agent polls status** → `GET /stripe-beta/payment-requests/:id` until `completed`
6. **Card created** → agent retrieves card details

No wallet, no USDC, no on-chain transactions. Payment is handled entirely via Stripe.

## Quickstart — First Card via Stripe

### 1. Create a session

```bash
curl -X POST https://api.asgcard.dev/stripe-beta/session \
  -H "Content-Type: application/json" \
  -d '{"email": "owner@company.com"}'
```

Response:
```json
{
  "sessionId": "sess_abc123",
  "expiresAt": "2026-03-21T..."
}
```

### 2. Create a payment request

```bash
curl -X POST https://api.asgcard.dev/stripe-beta/payment-requests \
  -H "Content-Type: application/json" \
  -H "X-STRIPE-SESSION: sess_abc123" \
  -d '{
    "amountUsd": 100,
    "cardholderName": "AI Agent",
    "email": "owner@company.com"
  }'
```

Response:
```json
{
  "id": "pr_xyz789",
  "status": "approval_required",
  "approvalUrl": "https://stripe.asgcard.dev/approve/pr_xyz789",
  "totalCharge": 113.50
}
```

### 3. Owner approves and pays

The owner opens the `approvalUrl` in their browser, reviews the request, and pays via Stripe checkout.

### 4. Agent polls for completion

```bash
curl https://api.asgcard.dev/stripe-beta/payment-requests/pr_xyz789 \
  -H "X-STRIPE-SESSION: sess_abc123"
```

When `status` is `completed`, the card is created and available.

### 5. Retrieve card details

```bash
curl https://api.asgcard.dev/stripe-beta/cards \
  -H "X-STRIPE-SESSION: sess_abc123"
```

## API Endpoints — Stripe MPP

Base URL: `https://api.asgcard.dev`

### Session Management

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/stripe-beta/session` | Create managed session (requires enrolled email) |

### Payment Requests

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/stripe-beta/payment-requests` | Create payment request (amount 0 = card-only $10, or $5–$5,000) |
| GET | `/stripe-beta/payment-requests/:id` | Poll request status |

### Approval Flow

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/stripe-beta/approve/:id` | Get approval page data |
| POST | `/stripe-beta/approve/:id` | Approve or reject request |
| POST | `/stripe-beta/approve/:id/complete` | Complete payment (MPP credential) |

### Card Management

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/stripe-beta/cards` | List session's cards |
| GET | `/stripe-beta/cards/:id/details` | Card details (PAN, CVV, expiry — nonce required) |

### Public Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Health check |
| GET | `/pricing` | Full pricing breakdown |

## Pricing

**Simple, transparent, no hidden fees.**

- **$10** one-time card creation (no initial load required)
- **3.5%** on every load/top-up

Load any amount from $5 to $5,000. Same pricing on both Stellar and Stripe rails.

> Example: create card with no load → **$10**. Then top up $100 → **$103.50**.
> Or: create card with $100 load → **$113.50** total.
> Top up $200 later → just **$207**.

Live pricing: `GET https://api.asgcard.dev/pricing`

## Authentication

- **Stripe edition**: Session-based (`X-STRIPE-SESSION` header)
- All endpoints under `/stripe-beta/*` require a valid session
- Sessions are created with an enrolled email address

## Error Handling

| Code | When |
| ---- | ---- |
| `400` | Invalid amount or body |
| `401` | Invalid or missing session |
| `402` | Payment required (Stellar x402 only) |
| `404` | Request or card not found |
| `409` | Nonce replay detected |
| `429` | Rate limit exceeded |
| `503` | Provider capacity unavailable |

## Also Available: Stellar Edition

For fully autonomous agent flows (no human approval needed), see the [Stellar edition](https://asgcard.dev/docs).
The Stellar edition uses x402 with USDC on Stellar — agents pay directly on-chain.

## Support

- Discord: [discord.gg/asgcompute](https://discord.gg/asgcompute)
- GitHub: [github.com/ASGCompute/asgcard-public](https://github.com/ASGCompute/asgcard-public)
- Email: support@asgcompute.dev
