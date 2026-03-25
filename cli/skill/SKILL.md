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

## Canonical Flow (x402 / On-Chain USDC)

1. **Check wallet status**: Use `get_wallet_status` MCP tool to verify wallet address and USDC balance
2. **Check pricing**: Use `get_pricing` to see card and top-up pricing
3. **Create a card**: Use `create_card` with amount, name, email, and phone — **all provided by the user**
4. **Manage cards**: Use `list_cards`, `get_card`, `get_card_details`, `freeze_card`, `unfreeze_card`

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
- Explain: "Send USDC on Stellar to your wallet address, then retry"

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `get_wallet_status` | Check wallet address, USDC balance, and readiness |
| `get_pricing` | View pricing (card $10, top-up 3.5%) |
| `create_card` | Create virtual MasterCard (pays USDC on-chain via x402) |
| `fund_card` | Top up existing card |
| `list_cards` | List all wallet cards |
| `get_card` | Get card summary |
| `get_card_details` | Get PAN, CVV, expiry (sensitive, rate-limited 5/hr) |
| `freeze_card` | Temporarily freeze card |
| `unfreeze_card` | Re-enable frozen card |

## Pricing

- **Card issuance:** $10
- **Top-up fee:** 3.5%
- Any amount from $5 to $5,000

Example: create a $50 card → you pay $50 + $10 + 3.5% = $62.10 USDC.

### Key Notes

- All on-chain payments are in USDC on Stellar via x402 protocol
- Stripe MPP flow allows fiat card payments as an alternative
- Minimum card cost is ~$15.18 USDC (for a $5 card: $5 + $10 + 3.5%)
- Card details are returned immediately on creation (agent-first model)
- Wallet uses Stellar Ed25519 keypair — private key stays in `~/.asgcard/wallet.json`
- MCP server auto-resolves key from wallet.json at startup (no env var needed)
- **ALWAYS use `@latest` tag with npx to avoid stale cached versions**
