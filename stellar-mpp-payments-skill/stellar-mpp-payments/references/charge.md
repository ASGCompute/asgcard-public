# Charge Mode - Stellar MPP

Use **charge mode** when each paid action can settle with its own on-chain transfer.

## When To Choose Charge

- low or moderate request volume
- simple seller implementation
- clear payment receipt per request
- easiest demo path for community examples

## Server Pattern

```ts
import express from "express";
import { Mppx, stellar } from "stellar-mpp-sdk/server";
import { USDC_SAC_TESTNET } from "stellar-mpp-sdk";

const app = express();
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

app.get("/premium", async (req, res) => {
  const webReq = new Request(`http://${req.get("host")}${req.originalUrl}`, {
    method: req.method,
    headers: new Headers(req.headers as Record<string, string>),
  });

  const result = await mppx.charge({
    amount: "0.01",
    description: "Premium API access",
  })(webReq);

  if (result.status === 402) {
    const challenge = result.challenge;
    res.status(challenge.status);
    challenge.headers.forEach((value, key) => res.setHeader(key, value));
    res.send(await challenge.text());
    return;
  }

  const paid = result.withReceipt(Response.json({ ok: true }));
  res.status(paid.status);
  paid.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(await paid.text());
});
```

## Client Pattern

```ts
import { Keypair } from "@stellar/stellar-sdk";
import { Mppx, stellar } from "stellar-mpp-sdk/client";

Mppx.create({
  methods: [
    stellar.charge({
      keypair: Keypair.fromSecret(process.env.STELLAR_SECRET!),
      mode: "pull",
    }),
  ],
});

const response = await fetch("http://localhost:3000/premium");
console.log(await response.json());
```

## Notes

- `pull` means the server broadcasts the signed transaction
- `push` means the client broadcasts and then proves the tx hash
- keep a replay-protection store on the server when you move from demo to production
- if the server performs a business side effect, consume the payment proof exactly once
