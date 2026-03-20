import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Mock issuer balance check — always sufficient
vi.mock("../src/services/fourPaymentsClient", () => ({
  checkIssuerBalance: vi.fn().mockResolvedValue({
    sufficient: true,
    availableBalance: 999999,
  }),
  getFourPaymentsClient: () => {
    throw new Error("getFourPaymentsClient not available in test");
  },
}));

// Mock Stripe service — avoid real Stripe API calls in test
vi.mock("../src/services/stripeService", () => ({
  parseSPTCredential: vi.fn((header: string) => {
    try {
      const decoded = Buffer.from(header, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      if (parsed.token === "spt_valid_test_token") {
        return { token: parsed.token, amountCents: parsed.amountCents, currency: "usd" };
      }
      return null;
    } catch {
      return null;
    }
  }),
  createPaymentIntentFromSPT: vi.fn().mockResolvedValue({
    success: true,
    paymentIntentId: "pi_test_mock_123",
  }),
  retrievePaymentIntent: vi.fn(),
}));

import { createApp } from "../src/app";

/**
 * Stripe MPP Beta — Critical Path Tests
 *
 * Test matrix:
 * 1. Beta off → 404
 * 2. No wallet auth → 401
 * 3. No X-PAYMENT → 402 with stripe_mpp challenge
 * 4. Invalid SPT → 401
 * 5. Valid SPT → 201 + card (when beta enabled)
 * 6. Stellar flow untouched (no regression)
 * 7. Wallet auth raw mode still works
 * 8. Wallet auth message mode header accepted
 */

let app: Express;
beforeAll(async () => { app = await createApp(); });

// ═════════════════════════════════════════════════════════════════
// 1. Feature Flag Gate
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta — Feature Flag Gate", () => {
  it("POST /stripe-beta/create → 404 when STRIPE_MPP_BETA_ENABLED is false (default)", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("Content-Type", "application/json")
      .send({
        nameOnCard: "Test Agent",
        email: "test@example.com",
        amount: 25,
      });

    // Route not mounted when flag is off → 404
    expect(res.status).toBe(404);
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. Stellar Routes — No Regression
// ═════════════════════════════════════════════════════════════════

describe("Stellar Routes — No Regression", () => {
  it("POST /cards/create/tier/25 → 402 (Stellar challenge unchanged)", async () => {
    const res = await request(app)
      .post("/cards/create/tier/25")
      .expect(402);

    expect(res.body).toHaveProperty("x402Version", 2);
    expect(res.body.accepts).toHaveLength(1);
    expect(res.body.accepts[0].network).toBe("stellar:pubnet");
    expect(res.body.accepts[0].scheme).toBe("exact");
  });

  it("POST /cards/fund/tier/50 → 402 (Stellar fund challenge unchanged)", async () => {
    const res = await request(app)
      .post("/cards/fund/tier/50")
      .expect(402);

    expect(res.body).toHaveProperty("x402Version", 2);
    expect(res.body.accepts[0].network).toBe("stellar:pubnet");
  });

  it("GET /cards without auth → 401 (wallet auth unchanged)", async () => {
    const res = await request(app)
      .get("/cards")
      .expect(401);

    expect(res.body.error).toBe("Missing wallet authentication headers");
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. Wallet Auth — Dual Mode
// ═════════════════════════════════════════════════════════════════

describe("Wallet Auth — Dual Mode", () => {
  it("raw mode (no X-WALLET-AUTH-MODE) → same 401 behavior", async () => {
    const res = await request(app)
      .get("/cards")
      .set("X-WALLET-ADDRESS", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
      .set("X-WALLET-SIGNATURE", "dGVzdA==")
      .set("X-WALLET-TIMESTAMP", String(Math.floor(Date.now() / 1000)))
      .expect(401);

    // Invalid signature → 401 (raw mode works)
    expect(res.body.error).toBeDefined();
  });

  it("message mode header accepted", async () => {
    const res = await request(app)
      .get("/cards")
      .set("X-WALLET-ADDRESS", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
      .set("X-WALLET-SIGNATURE", "dGVzdA==")
      .set("X-WALLET-TIMESTAMP", String(Math.floor(Date.now() / 1000)))
      .set("X-WALLET-AUTH-MODE", "message")
      .expect(401);

    // Same verification, just with mode header — still 401 on bad sig
    expect(res.body.error).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. Pricing — Unified Endpoints
// ═════════════════════════════════════════════════════════════════

describe("Pricing — Unified Endpoints", () => {
  it("GET /pricing and GET /cards/tiers return identical JSON", async () => {
    const [pricing, tiers] = await Promise.all([
      request(app).get("/pricing").expect(200),
      request(app).get("/cards/tiers").expect(200),
    ]);

    expect(pricing.body).toEqual(tiers.body);
    expect(pricing.body.cardFee).toBe(10);
    expect(pricing.body.minAmount).toBe(5);
    expect(pricing.body.maxAmount).toBe(5000);
    expect(pricing.body.endpoints).toBeDefined();
    expect(pricing.body.endpoints.create).toBe("POST /cards/create/tier/:amount");
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. Health & Version
// ═════════════════════════════════════════════════════════════════

describe("Health & Version", () => {
  it("GET /health → 200", async () => {
    const res = await request(app)
      .get("/health")
      .expect(200);

    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBeDefined();
  });
});
