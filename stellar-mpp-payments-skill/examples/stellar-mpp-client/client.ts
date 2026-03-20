import { Keypair } from "@stellar/stellar-sdk";
import { Mppx, stellar } from "stellar-mpp-sdk/client";

const secretKey = process.env.STELLAR_SECRET;
if (!secretKey) {
  console.error("Usage: STELLAR_SECRET=S... npm start");
  process.exit(1);
}

const keypair = Keypair.fromSecret(secretKey);
const serverUrl = process.env.SERVER_URL ?? "http://localhost:3000/premium/weather";

console.log(`Using Stellar account: ${keypair.publicKey()}`);

Mppx.create({
  methods: [
    stellar.charge({
      keypair,
      mode: "pull",
      onProgress(event) {
        const ts = new Date().toISOString().slice(11, 23);

        switch (event.type) {
          case "challenge":
            console.log(`[${ts}] challenge: ${event.amount} to ${event.recipient}`);
            break;
          case "signing":
            console.log(`[${ts}] signing transaction`);
            break;
          case "signed":
            console.log(`[${ts}] signed XDR (${event.xdr.length} bytes)`);
            break;
          case "paying":
            console.log(`[${ts}] sending payment`);
            break;
          case "confirming":
            console.log(`[${ts}] confirming ${event.hash.slice(0, 12)}...`);
            break;
          case "paid":
            console.log(`[${ts}] paid ${event.hash}`);
            break;
        }
      },
    }),
  ],
});

const response = await fetch(serverUrl);
const data = await response.json().catch(() => null);

console.log(`Response status: ${response.status}`);
console.log(JSON.stringify(data, null, 2));
