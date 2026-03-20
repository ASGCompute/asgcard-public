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

import { createApp } from "../src/app";

/**
 * Stripe MPP Beta Route Tests
 *
 * These tests verify:
 * 1. Beta route returns 503 when STRIPE_MPP_BETA_ENABLED=false (default)
 * 2. Existing Stellar routes still work correctly (no regression)
 * 3. Health endpoint returns updated version
 */

let app: Express;
beforeAll(async () => { app = await createApp(); });

describe("Stripe Beta — Feature Flag Gate", () => {
  it("POST /stripe-beta/create → 404 when STRIPE_MPP_BETA_ENABLED is false (default)", async () => {
    // Beta is off by default, so the route is not even mounted → 404
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("Content-Type", "application/json")
      .send({
        nameOnCard: "Test Agent",
        email: "test@example.com",
        amount: 25,
        stripePaymentIntentId: "pi_test_123",
      });

    // Route not mounted when flag is off → 404
    expect(res.status).toBe(404);
  });
});

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

describe("Health & Version", () => {
  it("GET /health → 200 with updated version", async () => {
    const res = await request(app)
      .get("/health")
      .expect(200);

    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBe("0.4.0-beta.1");
  });
});
