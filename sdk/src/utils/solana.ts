import bs58 from "bs58";
import { Keypair } from "@solana/web3.js";

export const decodeSolanaSecretKey = (key: string): Uint8Array => {
  const decoded = bs58.decode(key);

  if (decoded.length === 64) {
    return decoded;
  }

  if (decoded.length === 32) {
    const pair = Keypair.fromSeed(decoded);
    return pair.secretKey;
  }

  throw new Error("Unsupported Solana private key format. Expected 32-byte seed or 64-byte secret key.");
};
