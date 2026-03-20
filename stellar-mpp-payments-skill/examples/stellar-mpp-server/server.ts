import express from "express";
import { Mppx, stellar } from "stellar-mpp-sdk/server";
import { USDC_SAC_TESTNET } from "stellar-mpp-sdk";

const port = Number(process.env.PORT ?? 3000);
const recipient = process.env.STELLAR_RECIPIENT;
const secretKey = process.env.MPP_SECRET_KEY ?? "stellar-mpp-demo-secret";

if (!recipient || !recipient.startsWith("G") || recipient.length !== 56) {
  console.error("Set STELLAR_RECIPIENT to a valid Stellar public key (G..., 56 chars).");
  process.exit(1);
}

const app = express();
const mppx = Mppx.create({
  secretKey,
  methods: [
    stellar.charge({
      recipient,
      currency: USDC_SAC_TESTNET,
      network: "testnet",
    }),
  ],
});

function toWebRequest(req: express.Request): Request {
  const url = `http://${req.get("host")}${req.originalUrl}`;
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }

  return new Request(url, {
    method: req.method,
    headers,
  });
}

async function sendWebResponse(webResponse: Response, res: express.Response): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "WWW-Authenticate");
  res.send(await webResponse.text());
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, rail: "stellar-mpp", mode: "charge" });
});

app.get("/premium/weather", async (req, res) => {
  const result = await mppx.charge({
    amount: "0.01",
    description: "Premium weather API access",
  })(toWebRequest(req));

  if (result.status === 402) {
    await sendWebResponse(result.challenge, res);
    return;
  }

  const paid = result.withReceipt(
    Response.json({
      city: "London",
      temperature: 22,
      conditions: "Partly cloudy",
      paid: true,
      timestamp: new Date().toISOString(),
    }),
  );

  await sendWebResponse(paid, res);
});

app.listen(port, () => {
  console.log(`Stellar MPP server running on http://localhost:${port}`);
  console.log(`Recipient: ${recipient}`);
});
