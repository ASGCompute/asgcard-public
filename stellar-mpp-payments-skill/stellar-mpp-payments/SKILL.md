---
name: MPP Payments - Stellar Edition
description: Build Machine Payments Protocol integrations on Stellar using Soroban SAC transfers and optional payment channels. Use when the user asks about MPP, mppx, paid APIs on Stellar, machine-to-machine payments, or adapting a Stripe MPP flow to Stellar.
---

# MPP Payments - Stellar Edition

Build paid APIs and agent payment clients on **Stellar** using the **Machine Payments Protocol (MPP)**. Use this skill when the user wants a seller flow, a buyer flow, or a Stripe-to-Stellar MPP adaptation.

## Decide Three Things First

### 1. Role

- **Seller**: they want to protect an API or action behind payment
- **Buyer**: they want an agent or app to pay for a resource automatically
- **Both**: they need the full round trip

### 2. Payment Mode

- **Charge**: one on-chain Soroban SAC transfer per paid request
- **Channel**: many off-chain commitments, occasional on-chain close

Default to **charge** unless the user clearly needs high request volume or lower marginal latency.

### 3. Network

- **Testnet** for demos, tutorials, and prototype flows
- **Public** for production settlement

## Core MPP Flow

```text
Client -> GET /resource
Server -> 402 Payment Required + WWW-Authenticate: Payment ...
Client -> Authorization: Payment ...
Server -> verifies payment on Stellar
Server -> 200 OK + protected result
```

On Stellar, the payment method is usually:

- a **Soroban SAC transfer** for charge mode
- a **one-way payment channel commitment** for channel mode

## Quick Start: Seller

Install:

```bash
npm install mppx @stellar/stellar-sdk github:stellar-experimental/stellar-mpp-sdk
```

Minimal server shape:

```ts
import { Mppx, stellar } from "stellar-mpp-sdk/server";
import { USDC_SAC_TESTNET } from "stellar-mpp-sdk";

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [
    stellar.charge({
      recipient: process.env.STELLAR_RECIPIENT!,
      currency: USDC_SAC_TESTNET,
      network: "testnet",
    }),
  ],
});
```

Then wrap the protected route so:

- unpaid requests return `402` plus a `Payment` challenge
- paid requests are verified before the protected result is returned

See [references/charge.md](references/charge.md) for a working server pattern.

## Quick Start: Buyer

Install:

```bash
npm install mppx @stellar/stellar-sdk github:stellar-experimental/stellar-mpp-sdk
```

Minimal client shape:

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { Mppx, stellar } from "stellar-mpp-sdk/client";

Mppx.create({
  methods: [
    stellar.charge({
      keypair: Keypair.fromSecret(process.env.STELLAR_SECRET!),
    }),
  ],
});

const response = await fetch("https://api.example.com/paid-resource");
```

The client patches global `fetch`, catches the `402`, signs the Stellar payment credential, and retries automatically.

## Stripe MPP to Stellar MPP

When the user already has a Stripe MPP flow, preserve the protocol shape and change the settlement rail:

- keep `402 -> Payment challenge -> Payment credential -> verify -> side effect`
- replace Stripe `PaymentIntent` verification with Stellar transfer or channel verification
- keep replay protection and one-time consumption on the server side
- bind payment authorization to the exact business action being unlocked

See [references/stripe-interop.md](references/stripe-interop.md) before proposing a migration.

## Read Next

- For default one-time payments: [references/charge.md](references/charge.md)
- For repeated low-friction payments: [references/channel.md](references/channel.md)
- For package choices: [references/packages.md](references/packages.md)
- For adapting Stripe concepts: [references/stripe-interop.md](references/stripe-interop.md)
