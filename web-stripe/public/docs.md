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
3. **Agent receives `approval_required`** with `approvalUrl`
4. **Owner opens approval URL** → reviews, approves, pays via Stripe
5. **Agent polls status** → `GET /stripe-beta/payment-requests/:id` until `completed`
6. **Card created** → agent retrieves card details via `GET /stripe-beta/cards`

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
  "sessionId": "abc123...",
  "ownerId": "owner_xyz...",
  "sessionKey": "sk_sess_...",
  "managedWalletAddress": "G...",
  "note": "Store this sessionKey securely. It will not be shown again."
}
```

> **Important:** Store the `sessionKey` — it is your auth credential for all subsequent requests. Pass it in the `X-STRIPE-SESSION` header.

### 2. Create a payment request

```bash
curl -X POST https://api.asgcard.dev/stripe-beta/payment-requests \
  -H "Content-Type: application/json" \
  -H "X-STRIPE-SESSION: sk_sess_..." \
  -d '{
    "amountUsd": 100,
    "nameOnCard": "AI Agent",
    "description": "Virtual card for agent"
  }'
```

Response:

```json
{
  "status": "approval_required",
  "requestId": "pr_...",
  "approvalUrl": "https://stripe.asgcard.dev/approve?id=pr_...&token=...",
  "expiresAt": "2026-03-21T..."
}
```

> The `amountUsd` field is optional (default 0). Set to 0 for card-only creation ($10 flat). Set $5–$5,000 for creation with initial load ($10 + amount + 3.5%).

### 3. Owner approves and pays

The owner opens the `approvalUrl` in their browser, reviews the request details, and completes payment via Stripe checkout. The URL contains a one-time approval token — no login required.

### 4. Agent polls for completion

```bash
curl https://api.asgcard.dev/stripe-beta/payment-requests/pr_... \
  -H "X-STRIPE-SESSION: sk_sess_..."
```

Poll until `status` changes from `pending` to `completed` (or `rejected`/`expired`/`failed`).

### 5. Retrieve card details

```bash
curl https://api.asgcard.dev/stripe-beta/cards \
  -H "X-STRIPE-SESSION: sk_sess_..."
```

## API Endpoints — Stripe MPP

Base URL: `https://api.asgcard.dev`

### Session Management

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/stripe-beta/session` | Create session (returns `sessionKey`) |
| GET | `/stripe-beta/config` | Public config (beta status, Stripe publishable key) |

### Payment Requests

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| POST | `/stripe-beta/payment-requests` | `X-STRIPE-SESSION` | Create payment request |
| GET | `/stripe-beta/payment-requests/:id` | `X-STRIPE-SESSION` | Poll request status |

### Approval Flow (token-auth, no session needed)

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/stripe-beta/approve/:id?token=...` | Get approval page data |
| POST | `/stripe-beta/approve/:id` | Approve or reject (body: `{action, token}`) |
| POST | `/stripe-beta/approve/:id/complete` | Complete payment (MPP credential) |

### Card Management

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/stripe-beta/cards` | `X-STRIPE-SESSION` | List session's cards |
| GET | `/stripe-beta/cards/:id/details` | `X-STRIPE-SESSION` | PAN, CVV, expiry (nonce required) |

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

Live pricing: `GET https://api.asgcard.dev/pricing`

## Authentication

- **Header:** `X-STRIPE-SESSION: <sessionKey>`
- The `sessionKey` is returned once when you create a session — store it securely
- Session keys start with `sk_sess_`
- Approval URLs use token-based auth (no session needed)

## Payment Request Statuses

| Status | Meaning |
| ------ | ------- |
| `pending` | Waiting for owner approval |
| `approved` | Owner approved, payment processing |
| `completed` | Card created successfully |
| `rejected` | Owner rejected the request |
| `expired` | Request expired (1 hour TTL) |
| `failed` | Payment or card creation failed |

## Error Handling

| Code | When |
| ---- | ---- |
| `400` | Invalid amount or body |
| `401` | Invalid or missing session key |
| `403` | Email not enrolled in beta |
| `404` | Request or card not found |
| `409` | Nonce replay detected |
| `429` | Rate limit exceeded |
| `503` | Stripe beta not enabled / provider capacity |

## Also Available: Stellar Edition

For fully autonomous agent flows (no human approval needed), see the [Stellar edition](https://asgcard.dev/docs).
The Stellar edition uses x402 with USDC on Stellar — agents pay directly on-chain.

## Support

- Discord: [discord.gg/asgcompute](https://discord.gg/asgcompute)
- GitHub: [github.com/ASGCompute/asgcard-public](https://github.com/ASGCompute/asgcard-public)
- Email: support@asgcompute.dev
