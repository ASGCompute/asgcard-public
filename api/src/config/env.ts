import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default("0.2.0"),

  // ── Stellar-native config (primary) ──────────────────────────
  STELLAR_NETWORK: z.string().default("stellar:pubnet"),
  STELLAR_HORIZON_URL: z
    .string()
    .url()
    .default("https://horizon.stellar.org"),
  STELLAR_USDC_ASSET: z
    .string()
    .default("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),
  STELLAR_TREASURY_ADDRESS: z
    .string()
    .default("GABC1234567890PLACEHOLDER000000000000000000000000000000"),
  FACILITATOR_URL: z
    .string()
    .url()
    .default("https://facilitator.asgcard.dev"),

  // ── Legacy Solana fallback (backward compat, will be removed in M2) ──
  SOLANA_NETWORK: z.string().optional(),
  SOLANA_RPC_URL: z.string().optional(),
  USDC_MINT: z.string().optional(),
  TREASURY_PUBKEY: z.string().optional()
});

export const env = envSchema.parse(process.env);

