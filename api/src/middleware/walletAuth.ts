import type { RequestHandler } from "express";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

const MAX_CLOCK_DRIFT_SECONDS = 300;

export const requireWalletAuth: RequestHandler = (req, res, next) => {
  const address = req.header("X-WALLET-ADDRESS");
  const signatureBase58 = req.header("X-WALLET-SIGNATURE");
  const timestampHeader = req.header("X-WALLET-TIMESTAMP");

  if (!address || !signatureBase58 || !timestampHeader) {
    res.status(401).json({ error: "Missing wallet authentication headers" });
    return;
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    res.status(401).json({ error: "Invalid wallet timestamp" });
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > MAX_CLOCK_DRIFT_SECONDS) {
    res.status(401).json({ error: "Wallet timestamp outside accepted window" });
    return;
  }

  try {
    const signature = bs58.decode(signatureBase58);
    const pubkeyBytes = new PublicKey(address).toBytes();
    const message = new TextEncoder().encode(`asgcard-auth:${timestamp}`);
    const verified = nacl.sign.detached.verify(message, signature, pubkeyBytes);

    if (!verified) {
      res.status(401).json({ error: "Invalid wallet signature" });
      return;
    }

    req.walletContext = {
      address,
      timestamp
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid wallet authentication payload" });
  }
};
