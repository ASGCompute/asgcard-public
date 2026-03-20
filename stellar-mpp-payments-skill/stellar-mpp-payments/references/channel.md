# Channel Mode - Stellar MPP

Use **channel mode** when the user wants many small payments with low marginal overhead.

## When To Choose Channel

- very frequent requests
- repeated usage between the same funder and recipient
- off-chain commitments are acceptable
- the team can operate channel lifecycle management

## Mental Model

1. The funder opens a one-way payment channel on Stellar.
2. The server returns a `402` challenge that asks for a channel payment.
3. The client signs a new **cumulative amount** off-chain.
4. The server verifies the commitment signature and serves the resource.
5. The server closes the channel on-chain when it wants to settle.

## Server Shape

```ts
import { Mppx, stellar, Store } from "stellar-mpp-sdk/channel/server";

const mppx = Mppx.create({
  secretKey: process.env.MPP_SECRET_KEY!,
  methods: [
    stellar.channel({
      channel: process.env.STELLAR_CHANNEL!,
      commitmentKey: process.env.STELLAR_COMMITMENT_KEY!,
      network: "testnet",
      store: Store.memory(),
    }),
  ],
});
```

`Store` is not optional in practice. It tracks cumulative amounts and prevents replay or rollback of commitments.

## Client Shape

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { Mppx, stellar } from "stellar-mpp-sdk/channel/client";

Mppx.create({
  methods: [
    stellar.channel({
      commitmentKey: Keypair.fromSecret(process.env.STELLAR_COMMITMENT_SECRET!),
    }),
  ],
});
```

## Operational Advice

- start with **charge mode** unless channel economics are clearly justified
- persist the latest accepted cumulative amount per channel
- define who owns channel close and refund timing before shipping
- treat the latest valid commitment as money-like state
