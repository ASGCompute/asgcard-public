# ASG Card — LLM-Friendly Documentation

> USD MasterCard virtual cards for AI agents — pay via Stellar x402 (USDC) or Stripe Machine Payments

## Quick Links

- Site: [asgcard.dev](https://asgcard.dev)
- Stripe Edition: [stripe.asgcard.dev](https://stripe.asgcard.dev)
- API: [api.asgcard.dev](https://api.asgcard.dev)
- npm SDK: `@asgcard/sdk`
- npm CLI: `@asgcard/cli`
- npm MCP: `@asgcard/mcp-server`
- Agent config: [asgcard.dev/agent.txt](https://asgcard.dev/agent.txt)

## Payment Rails

ASG Card supports two payment rails. The card product is identical.

### Stellar Edition (x402)

Agent-autonomous. No human in the loop.

1. Agent requests card → API returns 402 + USDC amount
2. Agent signs Stellar USDC transfer via SDK
3. x402 facilitator verifies and settles on-chain
4. Card details returned in the response

Uses: SDK, CLI, MCP server.

### Stripe Edition (MPP)

Owner-in-the-loop. Agent creates request, human approves and pays.

1. Agent creates payment request → API returns `approval_required` + `approvalUrl`
2. Owner opens approval page at `stripe.asgcard.dev/approve`
3. Owner reviews, approves, pays via Stripe
4. Card created → agent polls until `completed`

Uses: session-based auth (`X-STRIPE-SESSION`).

## Quickstart — First Card in < 3 Minutes

### 1. Install CLI and create wallet

```bash
npx @asgcard/cli onboard -y
```

Then install for your client:

```bash
asgcard install --client codex      # OpenAI Codex
asgcard install --client claude     # Claude Code
asgcard install --client cursor     # Cursor
```

### 2. Fund your wallet

Send USDC on Stellar to the public key shown by `onboard`.
Minimum: ~$15.53 USDC (for $5 card + $10 issuance + 3.5%).

### 3. Create your first card

```bash
npx @asgcard/cli card:create -a 10 -n "AI Agent" -e you@email.com
```

## CLI Commands

| Command | Auth Required | Description |
| ------- | :-----------: | ----------- |
| `wallet create` | No | Generate new Stellar keypair |
| `wallet import [key]` | No | Import existing Stellar secret key |
| `wallet info` | Yes | Show address, USDC balance, deposit info |
| `install --client <c>` | No | Configure MCP for codex/claude/cursor |
| `onboard [-y]` | No | Full onboarding: wallet + MCP + skill |
| `doctor` | No | Diagnose setup (key, API, RPC, balance) |
| `cards` | Yes | List all cards |
| `card <id>` | Yes | Get card summary |
| `card:details <id>` | Yes | Get sensitive card info (PAN, CVV) |
| `card:create` | Yes | Create virtual card (x402 payment) |
| `card:fund <id>` | Yes | Fund existing card (x402 payment) |
| `card:freeze <id>` | Yes | Freeze a card |
| `card:unfreeze <id>` | Yes | Unfreeze a card |
| `pricing` | No | View pricing (card $10, top-up 3.5%) |
| `health` | No | API health check |

## MCP Server Tools (11)

The MCP server reads your key from `~/.asgcard/wallet.json` automatically.

| Tool | Description |
| ---- | ----------- |
| `get_wallet_status` | Check wallet address, USDC balance (use FIRST) |
| `create_card` | Create virtual MasterCard ($5–$5,000, pays USDC via x402) |
| `fund_card` | Top up existing card |
| `list_cards` | List all wallet cards |
| `get_card` | Get card summary by ID |
| `get_card_details` | Get PAN, CVV, expiry (rate-limited 5/hour) |
| `freeze_card` | Temporarily freeze card |
| `unfreeze_card` | Re-enable frozen card |
| `get_pricing` | View pricing (card $10, top-up 3.5%) |
| `get_transactions` | Card transaction history |
| `get_balance` | Live card balance |

## API Endpoints

Base URL: `https://api.asgcard.dev`

### Public

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/health` | Health check |
| GET | `/pricing` | Full pricing breakdown |
| GET | `/cards/tiers` | Alias for `/pricing` |
| GET | `/supported` | x402 capabilities |

### Stellar x402 (Payment Required)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/cards/create/tier/:amount` | Create card ($5–$5,000) |
| POST | `/cards/fund/tier/:amount` | Fund card ($5–$5,000) |

### Wallet Signed

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/cards` | List cards |
| GET | `/cards/:cardId` | Get card |
| GET | `/cards/:cardId/details` | Get PAN, CVV (nonce required) |
| GET | `/cards/:cardId/transactions` | Transaction history |
| GET | `/cards/:cardId/balance` | Live balance |
| POST | `/cards/:cardId/freeze` | Freeze card |
| POST | `/cards/:cardId/unfreeze` | Unfreeze card |

### Stripe MPP (Beta)

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/stripe-beta/session` | Create managed session |
| POST | `/stripe-beta/payment-requests` | Create payment request |
| GET | `/stripe-beta/payment-requests/:id` | Poll request status |
| GET | `/stripe-beta/approve/:id` | Get approval page data |
| POST | `/stripe-beta/approve/:id` | Approve or reject |
| POST | `/stripe-beta/approve/:id/complete` | Complete payment (MPP credential) |
| GET | `/stripe-beta/cards` | List session's cards |
| GET | `/stripe-beta/cards/:id/details` | Card details (nonce required) |

## Pricing

**Simple, transparent, no hidden fees.**

- **$10** one-time card issuance
- **3.5%** on every top-up

Load any amount from $5 to $5,000. Same pricing on both Stellar and Stripe rails.

> Example: load $100 onto a new card → **$113.50** total.
> Top up $200 later → just **$207**.

Live pricing: `GET https://api.asgcard.dev/pricing`

## Authentication

- **Stellar edition**: Wallet signature (Ed25519) + x402 payments
- **Stripe edition**: Session-based (`X-STRIPE-SESSION` header)
- **No API keys**: Authentication is wallet-based or session-based

## Error Handling

| Code | When |
| ---- | ---- |
| `400` | Invalid amount or body |
| `401` | Invalid wallet auth or X-Payment proof |
| `402` | x402 challenge |
| `403` | Details access revoked |
| `404` | Card not found |
| `409` | Nonce replay detected |
| `429` | Rate limit exceeded |
| `503` | Provider capacity unavailable |

## Support

- Discord: [discord.gg/asgcompute](https://discord.gg/asgcompute)
- GitHub: [github.com/ASGCompute/asgcard-public](https://github.com/ASGCompute/asgcard-public)
- Email: support@asgcompute.dev
