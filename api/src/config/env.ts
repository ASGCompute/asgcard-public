import { z } from "zod";

// ── Stellar G-address format ──────────────────────────────
const stellarAddress = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, "Must be a valid Stellar public key (G...)");

// ── Environment modes ─────────────────────────────────────
const nodeEnv = z.enum(["development", "staging", "production", "test"]).default("development");
const logLevel = z.enum(["debug", "info", "warn", "error"]).default("info");

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default("0.3.0"),
  NODE_ENV: nodeEnv,
  LOG_LEVEL: logLevel,

  // ── Stellar-native config (primary) ──────────────────────
  STELLAR_NETWORK: z.string().default("stellar:pubnet"),
  STELLAR_HORIZON_URL: z
    .string()
    .url()
    .default("https://horizon.stellar.org"),
  STELLAR_USDC_ASSET: z
    .string()
    .default("USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),

  // ── MANDATORY in all environments (no unsafe defaults) ───
  STELLAR_TREASURY_ADDRESS: stellarAddress,
  FACILITATOR_URL: z.string().url(),
  FACILITATOR_API_KEY: z.string().min(1),
  WEBHOOK_SECRET: z.string().min(1),
  WEBHOOK_SECRET_PREVIOUS: z.string().optional(),

  // ── Facilitator tuning ───────────────────────────────────
  FACILITATOR_TIMEOUT_MS: z.coerce.number().default(8000),
  FACILITATOR_MAX_RETRIES: z.coerce.number().default(2),

  // ── Legacy Solana fallback (backward compat, removed in M2) ──
  SOLANA_NETWORK: z.string().optional(),
  SOLANA_RPC_URL: z.string().optional(),
  USDC_MINT: z.string().optional(),
  TREASURY_PUBKEY: z.string().optional()
});

// ── Fail-fast startup validation ──────────────────────────
let env: z.infer<typeof envSchema>;

try {
  env = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    const missing = error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    const message =
      `\n❌ ASG Card API — environment validation failed:\n${missing}\n\n` +
      `Hint: copy api/.env.example to api/.env and fill in required values.\n`;
    // In production, log and exit; in test, throw for assertions
    if (typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
      console.error(message);
      process.exit(1);
    }
    throw new Error(message);
  }
  throw error;
}

export { env };
