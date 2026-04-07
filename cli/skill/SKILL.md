---
name: asgcard
description: ASG Card — virtual MasterCard cards for AI agents, powered by x402 on Stellar
---

# ASG Card Agent Skill

> **CRITICAL: Always use `npx -y @asgcard/cli@latest`** (with `@latest` tag!) to ensure you are running the newest published version with all bug fixes.

## ⚠️ MANDATORY DATA RULES

> **NEVER use placeholder, test, or example data for email, phone, or name.**
> You **MUST** ask the user for their **real** email address, phone number, and name before running any card creation or payment request command.
> If the user has previously provided their email/phone in the current conversation, you may reuse it. Otherwise, **always ask first**.
>
> ❌ WRONG: `-e "test@example.com" -p "+12345678900" -n "Test User"`
> ✅ RIGHT: Ask the user: "What email, phone number, and name should I use for the card?"

## Onboarding (First Time)

Run the full 9-step onboarding wizard:

```bash
npx -y @asgcard/cli@latest onboard -y
```

Steps: Agent Skill → MCP Config → Wallet → API Registration → Telegram Identity → Wallet Activation → Fund Link → Balance Check → Summary

## Canonical Flow (x402 / On-Chain USDC)

1. **Onboard**: Run `asgcard onboard -y` to set up wallet, MCP, and skill
2. **Check wallet status**: Use `get_wallet_status` MCP tool to verify wallet address and USDC balance
3. **Fund wallet**: Use `asgcard fund-link` or MCP `get_fund_link` to generate a deposit URL
4. **Check pricing**: Use `get_pricing` to see card and top-up pricing
5. **Create a card**: Use `create_card` with amount, name, email, and phone — **all provided by the user**
6. **Manage cards**: Use `list_cards`, `get_card`, `get_card_details`, `freeze_card`, `unfreeze_card`
7. **Top up cards**: Use `fund_card` to add funds to an existing card
8. **Monitor**: Use `get_transactions` and `get_balance` to track activity

## Stripe MPP Flow (Fiat Payments via Stripe)

Use this flow when the user wants to pay with a regular credit/debit card instead of USDC.

### Step 1 — Create a Stripe Session (one-time setup)

```bash
npx -y @asgcard/cli@latest stripe:session <USER_EMAIL>
```

The user's **real email** is required. This creates a session saved to `~/.asgcard/stripe-session.json`.

### Step 2 — Create a Payment Request

```bash
npx -y @asgcard/cli@latest stripe:request \
  -a <AMOUNT> \
  -n "<USER_NAME>" \
  -e "<USER_EMAIL>" \
  -p "<USER_PHONE>" \
  -d "<DESCRIPTION>"
```

**All parameters are mandatory.** You MUST collect the user's real name, email, and phone BEFORE running this command.

This returns:

- A **Request ID** (e.g. `pr_xxxxx`)
- An **Approval URL** — send this link to the card owner to complete payment

### Step 3 — Wait for Payment Completion

```bash
npx -y @asgcard/cli@latest stripe:wait <REQUEST_ID>
```

This polls until the owner completes Stripe payment and the card is issued.

## Zero Balance Handling

If wallet has insufficient USDC:

- Tell the user their current balance and the minimum required ($20.35 for a $10 card)
- Provide their Stellar public key for deposits
- Generate a fund link: `asgcard fund-link` or MCP `get_fund_link`

## CLI Commands

| Command | Description |
| ------- | ----------- |
| `asgcard onboard -y` | Full 9-step onboarding |
| `asgcard status` | Onboarding lifecycle status |
| `asgcard fund-link` | Generate deposit URL |
| `asgcard wallet-balance` | Show wallet USDC balance |
| `asgcard doctor` | Diagnose setup issues (11 checks) |
| `asgcard wallet info` | Show wallet address & balance |
| `asgcard cards` | List all virtual cards |
| `asgcard card:create` | Create a new virtual card |
| `asgcard card:fund <id>` | Top up existing card |
| `asgcard card:details <id>` | Get PAN, CVV, expiry |
| `asgcard card:freeze <id>` | Freeze card |
| `asgcard card:unfreeze <id>` | Unfreeze card |
| `asgcard transactions <id>` | Card transaction history |
| `asgcard balance <id>` | Live card balance |
| `asgcard history` | All cards + balances |
| `asgcard pricing` | Current pricing |
| `asgcard telegram:link` | Generate TG deep-link |
| `asgcard telegram:status` | Check TG connection |
| `asgcard telegram:revoke` | Disconnect TG |
| `asgcard stripe:session` | Create Stripe MPP session |
| `asgcard stripe:request` | Create payment request |
| `asgcard stripe:wait <id>` | Wait for payment completion |

## MCP Tools (18 tools)

### Card Operations

| Tool | Description |
| ---- | ----------- |
| `get_wallet_status` | Check wallet address, USDC + XLM balances, and readiness |
| `get_pricing` | View pricing (card $10, top-up 3.5%) |
| `create_card` | Create virtual MasterCard (pays USDC on-chain via x402) |
| `fund_card` | Top up existing card with USDC |
| `list_cards` | List all wallet cards |
| `get_card` | Get card summary |
| `get_card_details` | Get PAN, CVV, expiry (sensitive, rate-limited 5/hr) |
| `freeze_card` | Temporarily freeze card |
| `unfreeze_card` | Re-enable frozen card |
| `get_transactions` | Card transaction history |
| `get_balance` | Live card balance |

### Onboarding & Identity

| Tool | Description |
| ---- | ----------- |
| `get_onboard_status` | Onboarding lifecycle status |
| `connect_telegram` | Register wallet and get TG deep-link for identity binding |
| `get_fund_link` | Generate fund.asgcard.dev URL |
| `get_wallet_balance` | Wallet USDC + XLM balances (Horizon-cached) |

### Telegram Notifications

| Tool | Description |
| ---- | ----------- |
| `telegram_link` | Generate one-time TG deep-link (10min expiry) |
| `telegram_status` | Check if TG notifications are connected |
| `telegram_revoke` | Disconnect TG notifications |

## Multi-Chain Payment SDK (`@asgcard/pay`)

> For advanced agent-to-agent or multi-chain payment scenarios, the `@asgcard/pay` SDK provides a unified payment layer.

### Supported Networks (15+)

| Network | Protocol |
| ------- | -------- |
| **Stellar** | x402 (native) |
| **Ethereum** | EVM adapter |
| **Base** | EVM adapter |
| **Arbitrum** | EVM adapter |
| **Optimism** | EVM adapter |
| **Polygon** | EVM adapter |
| **Solana** | Solana adapter |
| **Stripe** | MPP / Fiat adapter |
| **Any OWS wallet** | Open Wallet Standard adapter |

### Key Capabilities

- **OWS (Open Wallet Standard)**: Universal wallet integration via `@open-wallet-standard/core`
- **x402 Protocol**: HTTP 402 Payment Required for autonomous machine payments
- **MPP (Machine Payment Protocol)**: Stripe-backed fiat payments
- **Agent Identity**: DID resolver, agent cards, reputation system
- **Facilitator Service**: Fee calculation and settlement
- **Multi-Chain Monitor**: Real-time EVM, Solana, and Stellar transaction watchers
- **Policy Engine**: Per-transaction spending rules and limits

### SDK Installation

```bash
npm install @asgcard/pay
```

```typescript
import { PayClient, StellarAdapter, EvmAdapter, OWSAdapter } from '@asgcard/pay';

const client = new PayClient({
  adapters: [new StellarAdapter(), new EvmAdapter(), new OWSAdapter()],
});
```

## Pricing

- **Card issuance:** $10
- **Top-up fee:** 3.5%
- Any amount from $5 to $5,000

Example: create a $50 card → you pay $50 + $10 + 3.5% = $62.10 USDC.

## Telegram Owner Linking

When the user wants to receive transaction notifications (charges, declines, refunds, top-ups) via Telegram:

### Step 1 — Generate a deep-link

```bash
npx -y @asgcard/cli@latest telegram:link
```

Or use MCP tool `telegram_link`. Link expires in 10 minutes.

### Step 2 — Send the link to the owner

Show the deep-link to the user and tell them: **"Click this link in Telegram to connect notifications for your wallet."**

### Step 3 — Verify (optional)

```bash
npx -y @asgcard/cli@latest telegram:status
```

Or use MCP tool `telegram_status`.

### Disconnect

```bash
npx -y @asgcard/cli@latest telegram:revoke
```

Or use MCP tool `telegram_revoke`.

### Key Notes

- All on-chain payments are in USDC on Stellar via x402 protocol
- Stripe MPP flow allows fiat card payments as an alternative
- Multi-chain payments available via `@asgcard/pay` SDK (EVM, Solana, OWS)
- Minimum card cost is ~$15.18 USDC (for a $5 card: $5 + $10 + 3.5%)
- Card details are returned immediately on creation (agent-first model)
- Wallet uses Stellar Ed25519 keypair — private key stays in `~/.asgcard/wallet.json`
- MCP server auto-resolves key from wallet.json at startup (no env var needed)
- **ALWAYS use `@latest` tag with npx to avoid stale cached versions**
