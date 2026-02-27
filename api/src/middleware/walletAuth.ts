import type { RequestHandler } from "express";
import nacl from "tweetnacl";

const MAX_CLOCK_DRIFT_SECONDS = 300;

/**
 * Decode a Stellar public key (G...) to raw 32-byte ed25519 public key.
 * Stellar uses base32 (RFC 4648) with a version byte prefix and 2-byte CRC16.
 *
 *   G... key = version_byte(1) + payload(32) + crc16(2) = 35 bytes base32-encoded
 *
 * We decode manually to avoid pulling in the full @stellar/stellar-sdk just for
 * key validation. The SDK will be added in PAY-002 when we need Horizon calls.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Decode = (encoded: string): Uint8Array => {
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of encoded) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(output);
};

const stellarPubkeyToBytes = (address: string): Uint8Array => {
  if (!address.startsWith("G") || address.length !== 56) {
    throw new Error("Invalid Stellar public key format");
  }
  const decoded = base32Decode(address);
  // version_byte(1) + ed25519_key(32) + crc16(2) = 35 bytes
  if (decoded.length < 33) {
    throw new Error("Invalid Stellar public key length");
  }
  return decoded.slice(1, 33);
};

/**
 * Try base64 first (canonical), fall back to base58 for backward compat.
 * Per P0 decision: base64 is the canonical format going forward.
 */
const decodeSignature = (signatureStr: string): Uint8Array => {
  // Try base64 first (canonical)
  try {
    const buf = Buffer.from(signatureStr, "base64");
    if (buf.length === 64) return new Uint8Array(buf);
  } catch {
    // not base64
  }

  // Fallback: base58 (legacy Solana-era format)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bs58Default = require("bs58").default as { decode: (input: string) => Uint8Array };
    const decoded = bs58Default.decode(signatureStr);
    if (decoded.length === 64) return new Uint8Array(decoded);
  } catch {
    // not base58 either
  }

  throw new Error("Signature must be base64 (preferred) or base58 encoded");
};

export const requireWalletAuth: RequestHandler = (req, res, next) => {
  const address = req.header("X-WALLET-ADDRESS");
  const signatureEncoded = req.header("X-WALLET-SIGNATURE");
  const timestampHeader = req.header("X-WALLET-TIMESTAMP");

  if (!address || !signatureEncoded || !timestampHeader) {
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
    const signature = decodeSignature(signatureEncoded);
    const pubkeyBytes = stellarPubkeyToBytes(address);
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
