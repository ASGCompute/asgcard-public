/**
 * Stripe MPP Beta — Production Path Tests (beta OFF)
 *
 * Tests with STRIPE_MPP_BETA_ENABLED=false (default).
 * Verifies: feature gate, Stellar no-regression, pricing unification.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Mock env with beta DISABLED for feature-gate test
vi.mock("../src/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/config/env")>();
  return {
    env: {
      ...mod.env,
      STRIPE_MPP_BETA_ENABLED: "false",
    },
  };
});

// Mock issuer balance check
vi.mock("../src/services/fourPaymentsClient", () => ({
  checkIssuerBalance: vi.fn().mockResolvedValue({
    sufficient: true,
    availableBalance: 999999,
  }),
  getFourPaymentsClient: () => {
    throw new Error("not available in test");
  },
}));

import { createApp } from "../src/app";

let app: Express;
beforeAll(async () => { app = await createApp(); });

describe("Stripe Beta — Feature Flag Gate (OFF)", () => {
  it("POST /stripe-beta/create → 404 when beta is OFF", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "t@t.com", amount: 25 });

    expect(res.status).toBe(404);
  });
});

describe("Stellar Routes — No Regression", () => {
  it("POST /cards/create/tier/25 → 402 (Stellar challenge)", async () => {
    const res = await request(app).post("/cards/create/tier/25").expect(402);
    expect(res.body).toHaveProperty("x402Version", 2);
    expect(res.body.accepts).toHaveLength(1);
    expect(res.body.accepts[0].network).toBe("stellar:pubnet");
    expect(res.body.accepts[0].scheme).toBe("exact");
  });

  it("POST /cards/fund/tier/50 → 402 (Stellar fund challenge)", async () => {
    const res = await request(app).post("/cards/fund/tier/50").expect(402);
    expect(res.body).toHaveProperty("x402Version", 2);
    expect(res.body.accepts[0].network).toBe("stellar:pubnet");
  });

  it("GET /cards without auth → 401", async () => {
    const res = await request(app).get("/cards").expect(401);
    expect(res.body.error).toBe("Missing wallet authentication headers");
  });
});

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
  });
});

describe("Health", () => {
  it("GET /health → 200", async () => {
    const res = await request(app).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBeDefined();
  });
});
