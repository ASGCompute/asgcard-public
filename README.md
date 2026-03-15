# ASG Card

ASG Card is an **agent-first** virtual card platform. AI agents programmatically issue and manage MasterCard virtual cards, paying in USDC via the **x402** protocol on **Stellar**.

## Architecture

```mermaid
graph TB
    subgraph Clients
        SDK["@asgcard/sdk<br>(npm, TypeScript)"]
        TG["Telegram Bot<br>@ASGCardbot"]
        WEB["asgcard.dev"]
    end

    subgraph ASG Infrastructure
        API["ASG Card API<br>api.asgcard.dev"]
        FAC["x402 Facilitator"]
        DB["PostgreSQL"]
    end

    subgraph External
        ISSUER["Card Issuer<br>(MasterCard)"]
        STELLAR["Stellar Pubnet<br>USDC"]
    end

    SDK -->|"x402 HTTP"| API
    TG -->|"Webhook"| API
    WEB -->|"Pricing"| API
    API -->|"verify/settle"| FAC
    API -->|"SQL"| DB
    API -->|"REST"| ISSUER
    FAC -->|"Soroban RPC"| STELLAR
    SDK -->|"Sign TX"| STELLAR
```

## How It Works

1. **Agent requests a card** → API returns a `402 Payment Required` with USDC amount
2. **Agent signs a Stellar USDC transfer** via the SDK
3. **x402 Facilitator verifies and settles** the payment on-chain
4. **API issues a real MasterCard** via the card issuer
5. **Card details returned immediately** in the response (agent-first)

## Workspace

| Directory | Description |
|-----------|-------------|
| `/api` | ASG Card API (Express + x402 + wallet auth) |
| `/sdk` | `@asgcard/sdk` TypeScript client |
| `/cli` | `@asgcard/cli` CLI with onboarding |
| `/mcp-server` | `@asgcard/mcp-server` MCP server (9 tools) |
| `/web` | Marketing website (asgcard.dev) |
| `/docs` | Internal documentation and ADRs |

## Quick Start — First Card

```bash
# One-step onboarding (creates wallet, configures MCP, installs skill)
npx @asgcard/cli onboard -y --client codex

# Fund your wallet with USDC on Stellar (address shown by onboard)
# Then:
npx @asgcard/cli card:create -a 10 -n "AI Agent" -e you@email.com
```

### Development

```bash
npm install
npm run dev:api   # API on localhost:3000
npm run dev       # Web on localhost:3001
```

## SDK Usage

```typescript
import { ASGCardClient } from "@asgcard/sdk";

const client = new ASGCardClient({
  privateKey: "S...",  // Stellar secret key
  rpcUrl: "https://mainnet.sorobanrpc.com"
});

// Automatically handles: 402 → USDC payment → card creation
const card = await client.createCard({
  amount: 10,        // $10 card load
  nameOnCard: "AI Agent",
  email: "agent@example.com"
});

// card.detailsEnvelope = { cardNumber, cvv, expiryMonth, expiryYear }
```

### SDK Methods

| Method | Description |
|--------|-------------|
| `createCard({amount, nameOnCard, email})` | Issue a virtual card with x402 payment |
| `fundCard({amount, cardId})` | Top up an existing card |
| `getTiers()` | Get current pricing tiers |
| `health()` | API health check |

## MCP Server (AI Agent Integration)

`@asgcard/mcp-server` exposes **9 tools** for Codex, Claude Code, and Cursor:

| Tool | Description |
|------|-------------|
| `get_wallet_status` | **Use FIRST** — wallet address, USDC balance, readiness |
| `create_card` | Create virtual card (x402 payment) |
| `fund_card` | Fund existing card (x402 payment) |
| `list_cards` | List all wallet cards |
| `get_card` | Get card summary |
| `get_card_details` | Get PAN, CVV, expiry |
| `freeze_card` | Freeze a card |
| `unfreeze_card` | Unfreeze a card |
| `get_pricing` | View tier pricing |

### MCP Setup

```bash
npx @asgcard/cli install --client codex    # or claude, cursor
```

## Agent Skill (x402 Payments)

The CLI bundles a product-owned `asgcard` skill that is installed automatically during `asgcard onboard` to `~/.agents/skills/asgcard/`.

For custom autonomous agents and raw LLM pipelines, the [x402-payments-skill](https://github.com/ASGCompute/x402-payments-skill) teaches agents how to pay via x402 natively on Stellar.

## Pricing

### Card Creation

| Card Load | Total Cost (USDC) |
|-----------|:-----------------:|
| $10 | **$17.20** |
| $25 | **$32.50** |
| $50 | **$58.00** |
| $100 | **$110.00** |
| $200 | **$214.00** |
| $500 | **$522.00** |

### Card Funding (Top-Up)

| Fund Amount | Total Cost (USDC) |
|-------------|:-----------------:|
| $10 | **$14.20** |
| $25 | **$29.50** |
| $50 | **$55.00** |
| $100 | **$107.00** |
| $200 | **$211.00** |
| $500 | **$519.00** |

Live pricing: `GET https://api.asgcard.dev/pricing`

## API Endpoints

### Public

| Route | Method | Description |
|-------|--------|-------------|
| `/health` | GET | Health check |
| `/pricing` | GET | Current pricing tiers |
| `/cards/tiers` | GET | Detailed tier breakdown |
| `/supported` | GET | x402 capabilities |

### Paid (x402 Payment Required)

| Route | Method | Description |
|-------|--------|-------------|
| `/cards/create/tier/:amount` | POST | Create a virtual card |
| `/cards/fund/tier/:amount` | POST | Fund an existing card |

### Wallet Authenticated

| Route | Method | Description |
|-------|--------|-------------|
| `/cards/` | GET | List wallet's cards |
| `/cards/:id` | GET | Card details |
| `/cards/:id/details` | GET | Sensitive data (nonce required) |
| `/cards/:id/freeze` | POST | Freeze card |
| `/cards/:id/unfreeze` | POST | Unfreeze card |

## Telegram Bot (@ASGCardbot)

Link your wallet to Telegram for card management:

| Command | Description |
|---------|-------------|
| `/start` | Welcome / Link account |
| `/mycards` | List your cards |
| `/faq` | FAQ |
| `/support` | Support |

### Linking Flow
1. Generate a deep-link token via the Owner Portal
2. Click `t.me/ASGCardbot?start=lnk_xxx`
3. Bot verifies and creates the wallet ↔ Telegram binding
4. Use `/mycards` to view and manage cards with inline buttons

## x402 Protocol

ASG Card implements the **x402 payment protocol v2** on **Stellar**:

- **Network:** Stellar Pubnet
- **Asset:** USDC (Stellar SAC contract)
- **Scheme:** `exact` (pay the exact amount required)
- **Fees sponsored:** Yes (Stellar transaction fees covered)

The flow follows the standard x402 challenge-response: `402 → sign → verify → settle → deliver`.

## Security

- Card details encrypted at rest with **AES-256-GCM**
- Agent nonce-based anti-replay protection (5 reads/hour)
- Wallet signature authentication
- Telegram webhook secret validation
- Ops endpoints protected by API key + IP allowlist

## License

MIT
