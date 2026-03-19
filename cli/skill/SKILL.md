---
name: asgcard
description: ASG Card — virtual MasterCard cards for AI agents, powered by x402 on Stellar
---

# ASG Card Agent Skill

## Canonical Flow

1. **Check wallet status**: Use `get_wallet_status` MCP tool to verify wallet address and USDC balance
2. **Check pricing**: Use `get_pricing` to see card and top-up pricing
3. **Create a card**: Use `create_card` with amount, name, and email
4. **Manage cards**: Use `list_cards`, `get_card`, `get_card_details`, `freeze_card`, `unfreeze_card`

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

Example: create a $50 card → you pay $50 + $10 + 3.5% = $61.75 USDC.

### Key Notes

- All payments are in USDC on Stellar via x402 protocol
- Minimum card cost is ~$15.18 USDC (for a $5 card: $5 + $10 + 3.5%)
- Card details are returned immediately on creation (agent-first model)
- Wallet uses Stellar Ed25519 keypair — private key stays in `~/.asgcard/wallet.json`
- MCP server auto-resolves key from wallet.json at startup (no env var needed)
