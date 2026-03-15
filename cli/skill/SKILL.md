---
name: asgcard
description: ASG Card — virtual MasterCard cards for AI agents, powered by x402 on Stellar
---

# ASG Card Agent Skill

## Canonical Flow

1. **Check wallet status**: Use `get_wallet_status` MCP tool to verify wallet address and USDC balance
2. **Check pricing**: Use `get_pricing` to see available card tiers and costs
3. **Create a card**: Use `create_card` with amount, name, and email
4. **Manage cards**: Use `list_cards`, `get_card`, `get_card_details`, `freeze_card`, `unfreeze_card`

## Zero Balance Handling

If wallet has insufficient USDC:
- Tell the user their current balance and the minimum required ($17.20 for $10 tier)
- Provide their Stellar public key for deposits
- Explain: "Send USDC on Stellar to your wallet address, then retry"

## MCP Tools Available

| Tool | Description |
|------|-------------|
| `get_wallet_status` | Check wallet address, USDC balance, and readiness |
| `get_pricing` | View tier pricing for card creation and funding |
| `create_card` | Create virtual MasterCard (pays USDC on-chain via x402) |
| `fund_card` | Top up existing card |
| `list_cards` | List all wallet cards |
| `get_card` | Get card summary |
| `get_card_details` | Get PAN, CVV, expiry (sensitive, rate-limited 5/hr) |
| `freeze_card` | Temporarily freeze card |
| `unfreeze_card` | Re-enable frozen card |

## Pricing (from API)

| Card Load | Total USDC | Endpoint |
|-----------|-----------|----------|
| $10 | $17.20 | `/cards/create/tier/10` |
| $25 | $32.50 | `/cards/create/tier/25` |
| $50 | $58.00 | `/cards/create/tier/50` |
| $100 | $110.00 | `/cards/create/tier/100` |
| $200 | $214.00 | `/cards/create/tier/200` |
| $500 | $522.00 | `/cards/create/tier/500` |

## Important Notes

- All payments are in USDC on Stellar via x402 protocol
- Card details are returned immediately on creation (agent-first model)
- Wallet uses Stellar Ed25519 keypair — private key stays in `~/.asgcard/wallet.json`
- MCP server auto-resolves key from wallet.json at startup (no env var needed)
- Minimum card tier is $10 (total cost $17.20 USDC including fees)
