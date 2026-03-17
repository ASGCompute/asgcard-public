import { describe, it, expect, beforeAll, vi, beforeEach } from "vitest";
import request from "supertest";
import type { Express } from "express";

// ── Mock issuer balance check ──────────────────────────────
// Must be declared before importing the app so the module is intercepted.
const mockCheckIssuerBalance = vi.fn();

vi.mock("../src/services/fourPaymentsClient", () => ({
  checkIssuerBalance: (...args: unknown[]) => mockCheckIssuerBalance(...args),
  // provide stubs so other imports don't break
  getFourPaymentsClient: () => {
    throw new Error("getFourPaymentsClient not available in test");
  },
}));

import { createApp } from "../src/app";

let app: Express;
beforeAll(async () => {
  app = await createApp();
});

// ────────────────────────────────────────────────────────────
// Issuer Funds Failsafe — Acceptance Criteria
// ────────────────────────────────────────────────────────────

describe("Issuer Failsafe — Create Route", () => {
  beforeEach(() => {
    mockCheckIssuerBalance.mockReset();
  });

  it("issuer balance sufficient → standard 402 challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: true,
      availableBalance: 10000,
    });

    const res = await request(app)
      .post("/cards/create/tier/500")
      .expect(402);

    expect(res.body).toHaveProperty("x402Version", 2);
    expect(res.body.accepts).toHaveLength(1);
    expect(res.body.accepts[0].amount).toBe("5220000000");
  });

  it("issuer balance insufficient → 503, no challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: false,
      availableBalance: 100,
    });

    const res = await request(app)
      .post("/cards/create/tier/500")
      .expect(503);

    expect(res.body.error).toBe("Service temporarily unavailable");
    expect(res.body.reason).toBe("provider_capacity");
    expect(res.body.retryAfter).toBe(60);
    // Must NOT contain x402 challenge fields
    expect(res.body).not.toHaveProperty("x402Version");
    expect(res.body).not.toHaveProperty("accepts");
  });

  it("issuer balance check failure (timeout) → 503, no challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: false,
      error: "Issuer balance check timed out",
    });

    const res = await request(app)
      .post("/cards/create/tier/500")
      .expect(503);

    expect(res.body.error).toBe("Service temporarily unavailable");
    expect(res.body.reason).toBe("provider_capacity");
    expect(res.body).not.toHaveProperty("x402Version");
  });

  it("issuer balance check failure (network error) → 503, no challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: false,
      error: "fetch failed",
    });

    const res = await request(app)
      .post("/cards/create/tier/500")
      .expect(503);

    expect(res.body.error).toBe("Service temporarily unavailable");
    expect(res.body).not.toHaveProperty("x402Version");
  });
});

describe("Issuer Failsafe — Fund Route", () => {
  beforeEach(() => {
    mockCheckIssuerBalance.mockReset();
  });

  it("issuer balance sufficient → standard 402 challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: true,
      availableBalance: 10000,
    });

    const res = await request(app)
      .post("/cards/fund/tier/500")
      .expect(402);

    expect(res.body).toHaveProperty("x402Version", 2);
    expect(res.body.accepts[0].amount).toBe("5190000000");
  });

  it("issuer balance insufficient → 503, no challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: false,
      availableBalance: 200,
    });

    const res = await request(app)
      .post("/cards/fund/tier/500")
      .expect(503);

    expect(res.body.error).toBe("Service temporarily unavailable");
    expect(res.body.reason).toBe("provider_capacity");
    expect(res.body).not.toHaveProperty("x402Version");
  });

  it("issuer balance check failure → 503, no challenge", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: false,
      error: "4payments API error: 500",
    });

    const res = await request(app)
      .post("/cards/fund/tier/500")
      .expect(503);

    expect(res.body.error).toBe("Service temporarily unavailable");
    expect(res.body).not.toHaveProperty("x402Version");
  });
});

describe("Issuer Failsafe — Lower tiers", () => {
  beforeEach(() => {
    mockCheckIssuerBalance.mockReset();
  });

  it("$10 create with sufficient balance → 402", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: true,
      availableBalance: 5000,
    });

    const res = await request(app)
      .post("/cards/create/tier/10")
      .expect(402);

    expect(res.body).toHaveProperty("x402Version", 2);
  });

  it("$10 create with insufficient balance → 503", async () => {
    mockCheckIssuerBalance.mockResolvedValue({
      sufficient: false,
      availableBalance: 5,
    });

    const res = await request(app)
      .post("/cards/create/tier/10")
      .expect(503);

    expect(res.body.error).toBe("Service temporarily unavailable");
  });

  it("unsupported tier still returns 400 (before issuer check)", async () => {
    // checkIssuerBalance should NOT be called for invalid tiers
    const res = await request(app)
      .post("/cards/create/tier/999")
      .expect(400);

    expect(res.body.error).toBe("Unsupported tier amount");
    expect(mockCheckIssuerBalance).not.toHaveBeenCalled();
  });
});
