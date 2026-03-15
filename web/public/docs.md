# ASG Card — LLM-Friendly Documentation

> Virtual MasterCard cards for AI agents, powered by x402 on Stellar

## Quick Links

- Site: [asgcard.dev](https://asgcard.dev)
- API: [api.asgcard.dev](https://api.asgcard.dev)
- npm SDK: `@asgcard/sdk`
- npm CLI: `@asgcard/cli`
- npm MCP: `@asgcard/mcp-server`
- Agent config: [asgcard.dev/agent.txt](https://asgcard.dev/agent.txt)

## Quickstart — First Card in < 3 Minutes

### 1. Install CLI and create wallet

```bash
npx @asgcard/cli onboard -y
```

This creates a wallet (`~/.asgcard/wallet.json`), configures MCP, installs the agent skill, and prints the next step.

Then install for your client:

```bash
asgcard install --client codex      # OpenAI Codex
asgcard install --client claude     # Claude Code
asgcard install --client cursor     # Cursor
```

### 2. Fund your wallet

Send USDC on Stellar to the public key shown by `onboard`.
Minimum: $17.20 USDC (for $10 card tier).

### 3. Check wallet status

```bash
npx @asgcard/cli wallet info
```

### 4. Create your first card

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
| `login [key]` | No | Save Stellar private key (legacy) |
| `whoami` | Yes | Show configured wallet address |
| `cards` | Yes | List all cards |
| `card <id>` | Yes | Get card summary |
| `card:details <id>` | Yes | Get sensitive card info (PAN, CVV) |
| `card:create` | Yes | Create virtual card (x402 payment) |
| `card:fund <id>` | Yes | Fund existing card (x402 payment) |
| `card:freeze <id>` | Yes | Freeze a card |
| `card:unfreeze <id>` | Yes | Unfreeze a card |
| `pricing` | No | View pricing tiers |
| `health` | No | API health check |

## MCP Server Tools (9)

The MCP server (`@asgcard/mcp-server`) reads your key from `~/.asgcard/wallet.json` automatically — no env vars needed in client configs.

| Tool | Description |
| ---- | ----------- |
| `get_wallet_status` | Check wallet address, USDC balance, and readiness (use FIRST) |
| `create_card` | Create virtual MasterCard (pays USDC via x402) |
| `fund_card` | Top up existing card |
| `list_cards` | List all wallet cards |
| `get_card` | Get card summary by ID |
| `get_card_details` | Get PAN, CVV, expiry (rate-limited 5/hour) |
| `freeze_card` | Temporarily freeze a card |
| `unfreeze_card` | Re-enable frozen card |
| `get_pricing` | View tier pricing |

### Recommended Agent Flow

1. `get_wallet_status` → verify wallet is funded
2. `get_pricing` → see available tiers and costs
3. `create_card` → issue virtual card (USDC payment happens on-chain)
4. `list_cards` / `get_card` / `get_card_details` → manage cards
5. `fund_card` → top up when needed
6. `freeze_card` / `unfreeze_card` → control

### MCP Setup

**First-class clients** (one-click installer):

```bash
asgcard install --client codex      # OpenAI Codex
asgcard install --client claude     # Claude Code
asgcard install --client cursor     # Cursor
```

**Compatible runtimes** (OpenClaw, Manus, Perplexity Computer, custom agents): Use manual MCP config or `@asgcard/sdk` directly.

No `STELLAR_PRIVATE_KEY` env var needed — MCP server reads from `~/.asgcard/wallet.json`.

## Authentication

- **Wallet signature**: All card management uses Stellar Ed25519 signature auth
- **x402 payments**: Card creation and funding pay USDC on Stellar via the x402 protocol
- **No API keys**: Authentication is wallet-based, no separate API keys needed

## API Endpoints

Base URL: `https://api.asgcard.dev`

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/health` | None | Health check |
| GET | `/pricing` | None | Full pricing breakdown |
| GET | `/cards/tiers` | None | Tier details with endpoints |
| GET | `/supported` | None | x402 capabilities |
| POST | `/cards/create/tier/:amount` | x402 | Create card (10/25/50/100/200/500) |
| POST | `/cards/fund/tier/:amount` | x402 | Fund card |
| GET | `/cards` | Wallet sig | List cards |
| GET | `/cards/:cardId` | Wallet sig | Get card |
| GET | `/cards/:cardId/details` | Wallet sig | Get card details (PAN, CVV) |
| POST | `/cards/:cardId/freeze` | Wallet sig | Freeze card |
| POST | `/cards/:cardId/unfreeze` | Wallet sig | Unfreeze card |

## Pricing (from api/src/config/pricing.ts)

### Card Creation

| Load | Total Cost (USDC) | Endpoint |
| ---- | :---------------: | -------- |
| $10 | $17.20 | `/cards/create/tier/10` |
| $25 | $32.50 | `/cards/create/tier/25` |
| $50 | $58.00 | `/cards/create/tier/50` |
| $100 | $110.00 | `/cards/create/tier/100` |
| $200 | $214.00 | `/cards/create/tier/200` |
| $500 | $522.00 | `/cards/create/tier/500` |

### Card Funding

| Fund | Total Cost (USDC) | Endpoint |
| ---- | :---------------: | -------- |
| $10 | $14.20 | `/cards/fund/tier/10` |
| $25 | $29.50 | `/cards/fund/tier/25` |
| $50 | $55.00 | `/cards/fund/tier/50` |
| $100 | $107.00 | `/cards/fund/tier/100` |
| $200 | $211.00 | `/cards/fund/tier/200` |
| $500 | $519.00 | `/cards/fund/tier/500` |

Live pricing: `GET https://api.asgcard.dev/pricing`

## Error Handling

All CLI and MCP errors follow a remediation-first pattern:

```
❌ [What happened]
   Why: [Reason]
   Fix: [Exact command to run]
```

## Payment Protocol

- **Protocol**: x402 (HTTP 402-based machine payment)
- **Network**: Stellar (mainnet)
- **Currency**: USDC (Circle)
- **Mechanism**: Soroban SAC transfer, signed auth entries
- **Fees**: Sponsored by x402 facilitator (zero gas cost for user)

## Support

- Discord: [discord.gg/asgcompute](https://discord.gg/asgcompute)
- GitHub: [github.com/asgcompute/asgcard](https://github.com/asgcompute/asgcard)
- Email: support@asgcompute.dev
