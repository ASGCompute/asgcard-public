---
title: "ASG Card MCP Server: Give Your AI Full Financial Autonomy"
slug: asgcard-mcp-server-ai-financial-autonomy
date: 2026-03-13
author: ASG Card Team
tags: [mcp, claude, cursor, ai-agent, virtual-card, tutorial]
description: "Set up the ASG Card MCP server in 60 seconds. Your Claude or Cursor agent can create, fund, and manage virtual cards autonomously."
---

# ASG Card MCP Server: Give Your AI Full Financial Autonomy

Your AI agent can write code, debug applications, and deploy to production. Now it can also **create and manage payment cards**.

The `@asgcard/mcp-server` exposes 8 tools that let Claude Code, Claude Desktop, and Cursor handle virtual card operations — from creation to freeze/unfreeze — without ever leaving your terminal.

## Setup (60 seconds)

### Claude Code

```bash
claude mcp add asgcard -- npx -y @asgcard/mcp-server -e STELLAR_PRIVATE_KEY=S...
```

That's it. Claude now has access to all 8 card tools.

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "asgcard": {
      "command": "npx",
      "args": ["-y", "@asgcard/mcp-server"],
      "env": {
        "STELLAR_PRIVATE_KEY": "YOUR_STELLAR_SECRET_KEY"
      }
    }
  }
}
```

### Cursor

Same config in your Cursor MCP settings.

## 8 Tools at Your Agent's Fingertips

| Tool | What it does |
|------|-------------|
| `create_card` | Issue a new MasterCard (pays USDC on-chain) |
| `fund_card` | Top up an existing card (pays USDC) |
| `list_cards` | See all cards in your wallet |
| `get_card` | Get card summary (balance, status) |
| `get_card_details` | Get PAN, CVV, expiry for purchases |
| `freeze_card` | Temporarily disable a card |
| `unfreeze_card` | Re-enable a frozen card |
| `get_pricing` | View pricing ($10 card, 3.5% top-up) |

## Real-World Use Cases

### 🛒 E-commerce Agent
> "Create a $50 card, then buy this API subscription at stripe.com"

Claude creates the card, retrieves the card number, and completes the checkout.

### 🔬 Research Agent
> "Set up a $25 card and subscribe to this data provider"

The agent handles everything: card creation, detail retrieval, and signup.

### 🤖 Multi-Agent Workflow
> "Create separate $10 cards for my web scraping and email agents"

Each agent gets its own card with independent balance and controls.

### 🛡️ Risk Management
> "Freeze the card on my shopping agent until I review its purchases"

Instant freeze/unfreeze without touching a dashboard.

## Security Model

Your Stellar private key **never leaves your machine**:

- MCP server runs locally as a stdio process
- Key is used to sign transactions and auth requests
- Ed25519 signatures with 5-minute timestamp windows
- Card details encrypted at rest (AES-256-GCM)
- Anti-replay protection (agent nonces, 5 reads/hour)

No API keys stored on remote servers. No OAuth tokens to rotate. Just cryptographic wallet ownership.

## Comparison with Alternatives

| Feature | ASG Card MCP | Traditional Agent Cards |
|---------|-------------|------------------------|
| Tools | **8** | Varies (typically fewer) |
| Card creation | ✅ Autonomous (x402) | ❌ Requires manual checkout |
| Card funding | ✅ Autonomous (x402) | ❌ Requires human |
| Freeze/Unfreeze | ✅ Yes | ❌ Often missing |
| Auth | Stellar wallet (ed25519) | API key |
| Payment | USDC on-chain | USD via traditional rails |

The key difference: **ASG Card is truly autonomous**. No human needs to fund the wallet or approve a checkout. The agent pays directly from its Stellar wallet.

## CLI Alternative

Prefer the terminal over MCP? Use the CLI:

```bash
npm install -g @asgcard/cli

asgcard login
asgcard pricing
asgcard card:create -a 50 -n "Dev Agent" -e dev@agent.ai
asgcard cards
asgcard card:freeze card_abc123
```

Same 11 commands, same wallet authentication, same autonomous operations.

## Get Started

```bash
# Option 1: MCP Server (for Claude/Cursor)
npx @asgcard/mcp-server

# Option 2: CLI (for terminal)
npm install -g @asgcard/cli

# Option 3: SDK (for custom integrations)
npm install @asgcard/sdk
```

Your agents are ready to work. Now they're ready to pay.

---

*[ASG Card](https://asgcard.dev) — npm: [@asgcard/mcp-server](https://npmjs.com/package/@asgcard/mcp-server) | [@asgcard/cli](https://npmjs.com/package/@asgcard/cli) | [@asgcard/sdk](https://npmjs.com/package/@asgcard/sdk)*
