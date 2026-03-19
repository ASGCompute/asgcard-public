# @asgcard/mcp-server

MCP (Model Context Protocol) server for [ASG Card](https://asgcard.dev) — gives AI agents the ability to create, fund, and manage virtual MasterCard cards.

## Quick Setup

```bash
# One-line setup (creates wallet, configures MCP, installs skill)
npx @asgcard/cli onboard -y --client codex

# Or manual setup for a specific client:
npx @asgcard/cli install --client codex    # Codex
npx @asgcard/cli install --client claude   # Claude Code
npx @asgcard/cli install --client cursor   # Cursor
```

## Tools (11)

| Tool | Description |
|------|-------------|
| `get_wallet_status` | **Use FIRST** — check wallet address, USDC balance, readiness |
| `create_card` | Create virtual MasterCard (pays USDC via x402 on Stellar) |
| `fund_card` | Top up an existing card |
| `list_cards` | List all cards for this wallet |
| `get_card` | Get card summary by ID |
| `get_card_details` | Get sensitive info: PAN, CVV, expiry (rate-limited 5/hr) |
| `freeze_card` | Temporarily freeze a card |
| `unfreeze_card` | Re-enable a frozen card |
| `get_pricing` | View pricing (card $10, top-up 3.5%) |
| `get_transactions` | Card transaction history (real 4payments data) |
| `get_balance` | Live card balance from 4payments |

## Recommended Agent Flow

```
get_wallet_status → get_pricing → create_card → list_cards → fund_card → manage
```

1. **Always start with `get_wallet_status`** to verify the wallet is funded
2. Use `get_pricing` to see card and top-up pricing
3. `create_card` to issue a virtual card (USDC payment via x402)
4. `list_cards` / `get_card` / `get_card_details` for management
5. `fund_card` to top up, `freeze_card` / `unfreeze_card` for control

## Manual MCP Configuration

If you prefer manual setup, the MCP server reads your key from `~/.asgcard/wallet.json` automatically — no env vars needed:

**Codex** (`~/.codex/config.toml`):
```toml
[mcp_servers.asgcard]
command = "npx"
args = ["-y", "@asgcard/mcp-server"]
```

**Claude Code**:
```bash
claude mcp add asgcard -- npx -y @asgcard/mcp-server
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "asgcard": {
      "command": "npx",
      "args": ["-y", "@asgcard/mcp-server"]
    }
  }
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|:---:|---------|-------------|
| `STELLAR_PRIVATE_KEY` | — | Auto from `~/.asgcard/wallet.json` | Override: explicit Stellar secret key |
| `ASGCARD_API_URL` | — | `https://api.asgcard.dev` | API base URL |
| `STELLAR_RPC_URL` | — | `https://mainnet.sorobanrpc.com` | Soroban RPC |

## Error Handling

All tool errors return structured remediation:

```
ERROR: Insufficient USDC balance for card creation
Why: Balance $5.00 is below minimum card cost. Send more USDC.
Fix: Use get_wallet_status to check your balance. Send USDC on Stellar to your wallet address, then retry.
```

## Security

- Private key stays in `~/.asgcard/wallet.json` — never sent to ASG Card API
- MCP server reads key at startup from local state (no env copy needed)
- Card management uses wallet signature authentication
- x402 payments are signed locally, settled by facilitator
- Card details encrypted at rest (AES-256-GCM)
