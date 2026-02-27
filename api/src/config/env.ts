import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default("0.1.0"),
  SOLANA_NETWORK: z.string().default("solana:mainnet"),
  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),
  USDC_MINT: z
    .string()
    .default("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
  TREASURY_PUBKEY: z.string().default("11111111111111111111111111111111")
});

export const env = envSchema.parse(process.env);
