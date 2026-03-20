# Stellar MPP Payments Skill

Production-oriented MPP skill for AI agents on Stellar.

This package mirrors the shape that worked well for the Stellar x402 community push: a reusable skill, lightweight installer, focused references, and two ready-to-run examples. The difference is the protocol surface: this one teaches **MPP** on **Stellar** instead of x402.

## What It Covers

One install. Your AI agent learns how to:

- build payment-gated APIs with `WWW-Authenticate: Payment`
- build agent clients that answer `402 Payment Required` automatically
- use **Soroban SAC transfers** for one-time MPP charges
- reason about **one-way channels** for higher-frequency payments
- map an existing **Stripe MPP** flow onto a **Stellar MPP** settlement rail

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/ASGCompute/asgcard-public/main/stellar-mpp-payments-skill/install.sh | bash
```

The installer copies the `stellar-mpp-payments` skill into Claude Code, Codex, Cursor/Windsurf, or Gemini locations.

## Live Examples

### Seller: Stellar MPP Server

A small Express API that charges `0.01` USDC per request on Stellar testnet.

```bash
cd examples/stellar-mpp-server
npm install
npm run dev
```

### Buyer: Stellar MPP Client

A Node client that catches a `402` challenge, signs the Stellar payment, and retries automatically.

```bash
cd examples/stellar-mpp-client
npm install
npm start
```

## Skill Layout

```text
stellar-mpp-payments-skill/
├── .cursorrules
├── install.sh
├── examples/
│   ├── stellar-mpp-server/
│   └── stellar-mpp-client/
└── stellar-mpp-payments/
    ├── SKILL.md
    └── references/
        ├── charge.md
        ├── channel.md
        ├── packages.md
        └── stripe-interop.md
```

## Positioning

This is intended as the MPP companion to the earlier Stellar x402 community asset:

- x402 repo: `ASGCompute/x402-payments-skill`
- this repo scaffold: `stellar-mpp-payments-skill/`

The protocol ergonomics are similar: a protected resource returns `402`, the client prepares a payment credential, and the server verifies the payment before releasing the result. The main difference is that MPP standardizes the `Payment` auth scheme and method abstraction directly.

## Publish Note

Right now this lives inside the ASG Card monorepo so it can be iterated quickly next to the existing Stripe MPP work. If you want to split it into a standalone GitHub repo later, the folder is already structured for that.
