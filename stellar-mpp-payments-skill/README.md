# Stellar MPP Payments Skill

<div align="center">

**A practical MPP skill for AI agents on Stellar.**

Build paid APIs, agent payment clients, and Stripe-to-Stellar machine payment flows with **MPP**, **Soroban SAC transfers**, and optional **one-way channels**.

[![License: Apache%202.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-blueviolet)](https://stellar.org)
[![MPP](https://img.shields.io/badge/MPP-Payment%20Auth-green)](https://mpp.dev)
[![Built by ASG Card](https://img.shields.io/badge/Built%20by-ASG%20Card-black)](https://asgcard.dev)

</div>

---

Built by **ASG Card** as a community-facing companion to our earlier Stellar x402 work.

This repo is for builders who want to understand or ship **Machine Payments Protocol (MPP)** flows on **Stellar** without starting from a blank page.

## What This Repo Gives You

One install. Your AI agent learns how to:

- build payment-gated APIs with `WWW-Authenticate: Payment`
- build agent clients that answer `402 Payment Required` automatically
- use **Soroban SAC transfers** for one-time MPP charges
- reason about **one-way channels** for higher-frequency payments
- adapt an existing **Stripe MPP** mental model to **Stellar MPP**

In practical terms, this repo gives the user:

- a reusable **AI skill** they can install into Codex, Claude Code, Cursor, Windsurf, or Gemini
- a **seller example** they can run locally
- a **buyer example** they can run locally
- focused references for **charge mode**, **channel mode**, and **package choices**
- guardrails for **replay protection**, **side-effect safety**, and **settlement design**

## Why A User Would Need This

MPP on Stellar is still early. Most builders have to piece the flow together from protocol docs, SDK internals, and scattered examples.

This repo compresses that work into something runnable.

Use it if you are:

- building a paid API and want a clean first implementation
- building an agent that should pay for resources automatically
- evaluating whether **charge** or **channel** mode is the right fit
- coming from **Stripe MPP** and need a credible path onto Stellar
- teaching an LLM-powered coding agent how to scaffold these flows correctly

## What Is In This Repo

```text
stellar-mpp-payments-skill/
├── .cursorrules                         # Cursor / Windsurf hook
├── install.sh                          # One-command installer
├── examples/
│   ├── stellar-mpp-server/             # Seller example: payment-gated API
│   └── stellar-mpp-client/             # Buyer example: automatic 402 payment client
└── stellar-mpp-payments/
    ├── SKILL.md                        # Main skill and decision tree
    └── references/
        ├── charge.md                   # One payment per request
        ├── channel.md                  # Off-chain commitment flow
        ├── packages.md                 # Package matrix and install guidance
        └── stripe-interop.md           # Stripe MPP -> Stellar MPP migration notes
```

## What A User Can Do In 10 Minutes

1. Install the skill.
2. Run the server example.
3. Run the client example.
4. Watch a real `402 -> Payment -> verified response` flow.
5. Decide whether to keep building with **charge mode** or move to **channel mode**.

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/ASGCompute/stellar-mpp-payments-skill/main/install.sh | bash
```

The installer copies the `stellar-mpp-payments` skill into Claude Code, Codex, Cursor/Windsurf, or Gemini locations.

## Manual Install

### Claude Code

```bash
git clone https://github.com/ASGCompute/stellar-mpp-payments-skill.git
mkdir -p ~/.claude/skills
cp -r stellar-mpp-payments-skill/stellar-mpp-payments ~/.claude/skills/
```

### Codex

```bash
git clone https://github.com/ASGCompute/stellar-mpp-payments-skill.git
mkdir -p ~/.codex/skills
cp -r stellar-mpp-payments-skill/stellar-mpp-payments ~/.codex/skills/
```

### Cursor / Windsurf

```bash
git clone https://github.com/ASGCompute/stellar-mpp-payments-skill.git
cp stellar-mpp-payments-skill/.cursorrules ./
cp -r stellar-mpp-payments-skill/stellar-mpp-payments ./
```

### Gemini

```bash
git clone https://github.com/ASGCompute/stellar-mpp-payments-skill.git
mkdir -p ~/.gemini/skills
cp -r stellar-mpp-payments-skill/stellar-mpp-payments ~/.gemini/skills/
```

## Live Examples

Two ready-to-run projects live in `examples/`.

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

## How The Repo Thinks

The skill teaches a simple decision tree:

```text
User asks about MPP / paid APIs / machine payments on Stellar
│
├─ Are you the SELLER or BUYER?
│  ├─ Seller -> protect an API or action behind payment
│  └─ Buyer  -> automatically pay for a resource
│
├─ Which PAYMENT MODE?
│  ├─ Charge  -> one on-chain SAC transfer per request
│  └─ Channel -> many off-chain commitments, occasional close
│
├─ Which NETWORK?
│  ├─ Testnet -> demos, pilots, first integrations
│  └─ Public  -> production settlement
│
└─ Are you MIGRATING FROM STRIPE MPP?
   ├─ No  -> use normal Stellar MPP setup
   └─ Yes -> preserve protocol shape, swap settlement rail
```

## Why This Is Useful Beyond Docs

It is a small packaging layer that helps both humans and AI coding agents do the right thing faster:

- the **skill** tells the model how to reason about the task
- the **references** keep protocol and implementation choices organized
- the **examples** give runnable code, not just theory
- the **installer** makes adoption low-friction

## Relation To `x402-payments-skill`

This repo is the MPP companion to the earlier Stellar x402 community asset.

- `x402-payments-skill` teaches **x402 on Stellar**
- `stellar-mpp-payments-skill` teaches **MPP on Stellar**

The protocol ergonomics overlap, but the implementation model differs:

- x402 centers on x402 challenge/accept flows and facilitator-style settlement
- MPP centers on the `Payment` auth scheme and method-specific credentials
- this repo adds explicit guidance for **charge vs channel** and **Stripe-to-Stellar** migration

## Why ASG Card Is Sharing This

After completing a pilot that combined **Stellar settlement**, **MPP flows**, and **Stripe-style machine payment concepts**, we packaged the useful parts into a public community asset.

This repo is meant to save other teams time:

- start with a working skill instead of blank docs
- see a clean seller/client split
- understand when to choose charge vs channel mode
- avoid obvious replay and side-effect mistakes

## License

Apache-2.0. It stays permissive, but is a better fit for a public developer integration asset because it includes an explicit patent grant.

## Project Links

[Repo](https://github.com/ASGCompute/stellar-mpp-payments-skill) · [x402 Companion](https://github.com/ASGCompute/x402-payments-skill) · [ASG Card](https://asgcard.dev) · [stellar-mpp-sdk](https://github.com/stellar-experimental/stellar-mpp-sdk)
