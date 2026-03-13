---
title: "x402 Protocol: How AI Agents Pay On-Chain"
slug: x402-protocol-how-ai-agents-pay
date: 2026-03-13
author: ASG Card Team
tags: [x402, stellar, usdc, protocol, payments, blockchain]
description: "The x402 protocol turns HTTP 402 Payment Required into a real payment flow. Here's how AI agents use it to pay in USDC without human intervention."
---

# x402 Protocol: How AI Agents Pay On-Chain

The HTTP spec reserved status code `402 Payment Required` over 25 years ago. It was meant for future machine-to-machine payments. The future is here.

## What is x402?

x402 is a protocol that gives `HTTP 402` real meaning:

1. Client sends a request
2. Server responds `402 Payment Required` with payment details
3. Client signs a stablecoin payment
4. Client resends with `X-PAYMENT` header (signed transaction)
5. Server verifies, settles, and delivers the response

No API keys. No credit cards. No humans. Just cryptographic ownership proving you can pay.

## Why Stablecoins?

Traditional payments are designed for humans:
- Credit cards need KYC, billing addresses, and 3D Secure
- Bank transfers take days and need human initiation
- PayPal/Stripe require OAuth flows and dashboard management

Stablecoins like USDC on Stellar settle in **5 seconds**, cost **fractions of a cent** in fees, and can be signed by software without human intervention.

## The ASG Card x402 Flow

```
┌─────────────┐      ┌──────────────────┐      ┌──────────────┐
│   AI Agent   │      │  ASG Card API    │      │   Stellar    │
│  (SDK/MCP)   │      │ api.asgcard.dev  │      │   Network    │
└──────┬───────┘      └────────┬─────────┘      └──────┬───────┘
       │                       │                        │
       │  POST /cards/create   │                        │
       │──────────────────────>│                        │
       │                       │                        │
       │  402 Payment Required │                        │
       │  {amount, payTo,      │                        │
       │   network, scheme}    │                        │
       │<──────────────────────│                        │
       │                       │                        │
       │  Agent builds Soroban │                        │
       │  USDC transfer TX     │                        │
       │  Signs with Keypair   │                        │
       │───────────────────────────────────────────────>│
       │                       │                        │
       │  POST /cards/create   │                        │
       │  X-PAYMENT: base64()  │                        │
       │──────────────────────>│                        │
       │                       │  verify + settle       │
       │                       │───────────────────────>│
       │                       │  TX confirmed          │
       │                       │<───────────────────────│
       │                       │                        │
       │  201 Created          │                        │
       │  {card, details}      │                        │
       │<──────────────────────│                        │
```

### Key Technical Details

- **Network:** Stellar Pubnet
- **Asset:** USDC (Stellar SAC contract)
- **Version:** x402 v2
- **Scheme:** `exact` — pay the exact amount, no overpayment
- **Fees:** Sponsored by the facilitator — agents pay zero blockchain fees
- **Timeout:** 300 seconds for the agent to sign and return

## Why x402 Beats API Keys

| Feature | API Keys | x402 Protocol |
|---------|----------|---------------|
| Auth | Static secret strings | Cryptographic signatures |
| Rotation | Manual, risky | N/A — each TX is unique |
| Leakage risk | High (env vars, logs) | None — keys never sent |
| Spending limits | Manual config | Per-transaction on-chain |
| Revocation | Requires dashboard | Wallet-level control |
| Audit trail | Application logs | On-chain, permanent |

## Code Example

```typescript
import { ASGCardClient } from "@asgcard/sdk";

const client = new ASGCardClient({
  privateKey: "S...",  // Stellar secret
  rpcUrl: "https://mainnet.sorobanrpc.com"
});

// The SDK handles the entire 402 → sign → submit flow
const { card, detailsEnvelope, payment } = await client.createCard({
  amount: 50,
  nameOnCard: "Research Agent",
  email: "research@agent.ai"
});

console.log(card.cardId);  // card_abc123
console.log(payment.txHash);  // on-chain proof
```

## MCP Server for Claude

For Claude Code or Cursor users, the x402 flow is hidden completely:

```bash
# Add the ASG Card MCP server
claude mcp add asgcard -- npx -y @asgcard/mcp-server

# Then just ask Claude:
# "Create a $50 virtual card for my shopping agent"
```

Claude handles the USDC payment, the signing, and returns the card details automatically.

## The Future of Machine Payments

x402 isn't just for virtual cards. Any resource behind a paywall can use this protocol:

- API access (per-call pricing without subscriptions)
- Cloud storage (pay per GB, per request)
- AI model access (pay per inference)
- Content delivery (pay per download)

The HTTP standard gave us 402 for this exact purpose. We're finally using it.

---

*[ASG Card](https://asgcard.dev) — The first platform to bring x402 to virtual card issuance.*
