# @asgcard/cli

Command-line interface for [ASG Card](https://asgcard.dev) — virtual MasterCard cards for AI agents, powered by x402 on Stellar.

## Quick Start

```bash
# Full onboarding (wallet + MCP + skill)
npx @asgcard/cli@latest onboard -y --client codex

# Or step by step:
npx @asgcard/cli@latest wallet create          # Generate Stellar keypair
npx @asgcard/cli@latest wallet info            # Check balance
npx @asgcard/cli@latest install --client codex # Configure MCP
npx @asgcard/cli@latest card:create -a 10 -n "AI Agent" -e you@email.com -p "+1234567890"
```

## Commands

### Onboarding

| Command | Description |
|---------|-------------|
| `asgcard wallet create` | Generate a new Stellar keypair, save to `~/.asgcard/` |
| `asgcard wallet import [key]` | Import an existing Stellar secret key |
| `asgcard wallet info` | Show public key, USDC balance, deposit instructions |
| `asgcard install --client <c>` | Configure MCP for codex, claude, or cursor |
| `asgcard onboard [-y] [-c client]` | Full onboarding: wallet + MCP + skill + next step |
| `asgcard doctor` | Diagnose setup (key, API, RPC, balance, MCP configs) |

### Card Management

| Command | Description |
|---------|-------------|
| `asgcard cards` | List all your virtual cards |
| `asgcard card <id>` | Get card summary |
| `asgcard card:details <id>` | Get sensitive card info (PAN, CVV, expiry) |
| `asgcard card:create -a <amt> -n <name> -e <email> -p <phone>` | Create a new card (x402 payment) |
| `asgcard card:fund <id> -a <amt>` | Fund an existing card |
| `asgcard card:freeze <id>` | Freeze a card |
| `asgcard card:unfreeze <id>` | Unfreeze a card |

### Stripe MPP (Fiat Payments)

| Command | Description |
|---------|-------------|
| `asgcard stripe:session <email>` | Create a Stripe beta session |
| `asgcard stripe:request -a <amt> -n <name> -e <email> -p <phone>` | Create a payment request |
| `asgcard stripe:wait <requestId>` | Poll until card is issued |

### Info

| Command | Description |
|---------|-------------|
| `asgcard pricing` | View pricing (no auth required) |
| `asgcard health` | API health check (no auth required) |
| `asgcard whoami` | Show your wallet address |
| `asgcard login [key]` | Save Stellar key (legacy, use `wallet import`) |

### Transaction History & Analytics

| Command | Description |
|---------|-------------|
| `asgcard transactions <id>` | View card transaction history (real 4payments data) |
| `asgcard balance <id>` | Get live card balance from 4payments |
| `asgcard history` | Show all cards with live balances for your wallet |

## Authentication

The CLI uses Stellar wallet signature authentication — no API keys needed. Your Stellar secret key is stored in `~/.asgcard/wallet.json` (mode 0600).

Key resolution priority (same as MCP server):
1. `STELLAR_PRIVATE_KEY` environment variable
2. `~/.asgcard/wallet.json` (from `asgcard wallet create/import`)
3. `~/.asgcard/config.json` (from `asgcard login` — legacy)

## Card Creation

Card creation and funding use the **x402 protocol** — payments happen on-chain in USDC on Stellar. The transaction is built and signed locally, then sent via the x402 facilitator.

Card issuance: **$10**. Top-up fee: **3.5%**. Any amount from $5 to $5,000.

## Configuration

Config is stored in `~/.asgcard/`:
- `config.json` — API URL, RPC URL, private key
- `wallet.json` — Stellar keypair (from `wallet create/import`)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_PRIVATE_KEY` | — | Stellar secret key (overrides config) |
| `ASGCARD_API_URL` | `https://api.asgcard.dev` | API base URL |
| `STELLAR_RPC_URL` | `https://mainnet.sorobanrpc.com` | Soroban RPC URL |

## Error Handling

All errors show remediation guidance:

```
❌ No Stellar private key configured.

To fix this, do one of:

  asgcard wallet create    — generate a new Stellar keypair
  asgcard wallet import    — import an existing key
  asgcard login <key>      — save a key directly
```
