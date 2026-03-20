/**
 * Stripe Managed Identity — Hardening Tests
 *
 * Tests:
 *   1. Beta OFF + valid session → 503 (route blocked)
 *   2. GET /stripe-beta/cards/:cardId/details without nonce → 400
 *   3. X-STRIPE-SESSION header is in logger redaction config
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// ── Test 1: Beta OFF blocks session routes ────────────────────

describe("Stripe Beta OFF — session routes blocked", () => {
  let appBetaOff: Express;

  beforeAll(async () => {
    // Reset all modules for clean env
    vi.resetModules();

    // Mock env with beta DISABLED
    vi.doMock("../src/config/env", async (importOriginal) => {
      const mod = await importOriginal<typeof import("../src/config/env")>();
      return {
        env: {
          ...mod.env,
          STRIPE_MPP_BETA_ENABLED: "true", // needed for route registration in createApp
          STRIPE_SESSIONS_KEY: Buffer.from(
            require("crypto").randomBytes(32)
          ).toString("base64"),
          STRIPE_BETA_EMAIL_ALLOWLIST: "",
        },
      };
    });

    // Mock sessionService to return a valid session
    vi.doMock("../src/services/sessionService", () => ({
      createSession: vi.fn().mockResolvedValue({
        sessionId: "sess_test123",
        ownerId: "owner_test123",
        sessionKey: "sk_sess_test_key_abc123",
        managedWalletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
      }),
      validateSession: vi.fn().mockResolvedValue({
        sessionId: "sess_test123",
        ownerId: "owner_test123",
        email: "test@beta.com",
        managedWalletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
      }),
    }));

    // Mock cardService
    vi.doMock("../src/services/cardService", () => ({
      HttpError: class extends Error {
        status: number;
        constructor(status: number, message: string) {
          super(message);
          this.status = status;
        }
      },
      cardService: {
        listCards: vi.fn().mockResolvedValue([]),
        getCardDetails: vi.fn().mockResolvedValue({ details: {} }),
      },
    }));

    vi.doMock("../src/services/fourPaymentsClient", () => ({
      checkIssuerBalance: vi.fn().mockResolvedValue({
        sufficient: true,
        availableBalance: 999999,
      }),
      getFourPaymentsClient: () => {
        throw new Error("not available in test");
      },
    }));

    const { createApp } = await import("../src/app");
    appBetaOff = await createApp();

    // Now flip the beta flag OFF after routes are registered
    const { env } = await import("../src/config/env");
    (env as any).STRIPE_MPP_BETA_ENABLED = "false";
  });

  it("POST /stripe-beta/create with valid session but beta OFF → 503", async () => {
    const res = await request(appBetaOff)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", "sk_sess_test_key_abc123")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "t@t.com", amount: 25 });

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("not currently available");
  });

  it("GET /stripe-beta/cards with valid session but beta OFF → 503", async () => {
    const res = await request(appBetaOff)
      .get("/stripe-beta/cards")
      .set("X-STRIPE-SESSION", "sk_sess_test_key_abc123");

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("not currently available");
  });

  it("GET /stripe-beta/cards/:id/details with valid session but beta OFF → 503", async () => {
    const res = await request(appBetaOff)
      .get("/stripe-beta/cards/card_test123/details")
      .set("X-STRIPE-SESSION", "sk_sess_test_key_abc123")
      .set("X-AGENT-NONCE", "f47ac10b-58cc-4372-a567-0e02b2c3d479");

    expect(res.status).toBe(503);
    expect(res.body.error).toContain("not currently available");
  });
});

// ── Test 2: Details route requires nonce ──────────────────────

describe("Stripe Beta — details route requires nonce", () => {
  let appBetaOn: Express;

  beforeAll(async () => {
    vi.resetModules();

    vi.doMock("../src/config/env", async (importOriginal) => {
      const mod = await importOriginal<typeof import("../src/config/env")>();
      return {
        env: {
          ...mod.env,
          STRIPE_MPP_BETA_ENABLED: "true",
          STRIPE_SESSIONS_KEY: Buffer.from(
            require("crypto").randomBytes(32)
          ).toString("base64"),
          STRIPE_BETA_EMAIL_ALLOWLIST: "",
          DETAILS_READ_LIMIT_PER_HOUR: 5,
        },
      };
    });

    vi.doMock("../src/services/sessionService", () => ({
      createSession: vi.fn(),
      validateSession: vi.fn().mockResolvedValue({
        sessionId: "sess_nonce_test",
        ownerId: "owner_nonce_test",
        email: "nonce@beta.com",
        managedWalletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV",
      }),
    }));

    vi.doMock("../src/services/cardService", () => ({
      HttpError: class extends Error {
        status: number;
        constructor(status: number, message: string) {
          super(message);
          this.status = status;
        }
      },
      cardService: {
        getCardDetails: vi.fn().mockResolvedValue({
          details: { cardNumber: "5200000000001234", cvv: "321" },
        }),
      },
    }));

    vi.doMock("../src/services/fourPaymentsClient", () => ({
      checkIssuerBalance: vi.fn().mockResolvedValue({
        sufficient: true,
        availableBalance: 999999,
      }),
      getFourPaymentsClient: () => {
        throw new Error("not available in test");
      },
    }));

    const { createApp } = await import("../src/app");
    appBetaOn = await createApp();
  });

  it("GET /stripe-beta/cards/:id/details without X-AGENT-NONCE → 400", async () => {
    const res = await request(appBetaOn)
      .get("/stripe-beta/cards/card_test123/details")
      .set("X-STRIPE-SESSION", "sk_sess_test_key_abc123");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Missing X-AGENT-NONCE");
  });

  it("GET /stripe-beta/cards/:id/details with invalid nonce format → 400", async () => {
    const res = await request(appBetaOn)
      .get("/stripe-beta/cards/card_test123/details")
      .set("X-STRIPE-SESSION", "sk_sess_test_key_abc123")
      .set("X-AGENT-NONCE", "not-a-uuid");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("UUID v4");
  });
});

// ── Test 3: Logger redaction config ──────────────────────────

describe("Logger redaction — session fields", () => {
  it("X-STRIPE-SESSION header is in redaction paths", async () => {
    vi.resetModules();
    // Import the actual logger (no mock)
    const { appLogger } = await import("../src/utils/logger");

    // Access pino redact config — pino stores normalized paths
    // We check the raw redactPaths array via source inspection,
    // but we can also verify by checking that logging doesn't leak.
    // The most reliable test: the source array.
    const loggerModule = await import("../src/utils/logger");
    const source = await import("fs/promises");
    const loggerSource = await source.readFile(
      require("path").join(__dirname, "../src/utils/logger.ts"),
      "utf-8"
    );

    expect(loggerSource).toContain('req.headers["x-stripe-session"]');
    expect(loggerSource).toContain("sessionKey");
    expect(loggerSource).toContain("managedSecret");
  });
});
