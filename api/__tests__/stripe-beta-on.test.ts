/**
 * Stripe MPP Beta — Session-Auth MPP Contract Tests (beta ON)
 *
 * Tests the managed-identity flow:
 *   - Session creation via POST /stripe-beta/session
 *   - 402 with WWW-Authenticate: Payment <challenge>
 *   - Session auth via X-STRIPE-SESSION header
 *   - Retry with Authorization: Payment <credential> containing SPT
 *   - HMAC-bound challenge verification
 *   - Happy path: valid credential → 201 card created
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import crypto from "node:crypto";

// NOTE: vi.mock factories are hoisted — cannot reference top-level variables.
// Use hardcoded test values instead.

// ── Mock env with beta enabled + MPP key + session key ──────────
vi.mock("../src/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/config/env")>();
  return {
    env: {
      ...mod.env,
      STRIPE_MPP_BETA_ENABLED: "true",
      STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_for_tests",
      STRIPE_SECRET_KEY: "sk_test_dummy_for_tests",
      STRIPE_BETA_ALLOWLIST: "",  // empty = allow all wallets
      STRIPE_BETA_EMAIL_ALLOWLIST: "",  // empty = allow all emails
      MPP_SECRET_KEY: "test-mpp-secret-key-for-hmac-challenges-32chars!",
      // 32 random bytes base64 — hardcoded to avoid hoisting issues
      STRIPE_SESSIONS_KEY: "dGVzdC1zZXNzaW9uLWtleS1mb3ItdW5pdC10ZXN0cyE=",
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

// Mock Stripe SDK — intercept PaymentIntent.create for SPT verification
vi.mock("stripe", () => {
  return {
    default: class MockStripe {
      paymentIntents = {
        create: vi.fn(async (params: Record<string, unknown>) => {
          const spt = params.shared_payment_granted_token as string;
          if (spt?.startsWith("spt_valid")) {
            return {
              id: `pi_from_${spt}`,
              status: "succeeded",
            };
          }
          throw new Error(`Invalid SPT: ${spt}`);
        }),
      };
    },
  };
});

// Mock sessionService — deterministic session creation
// Deterministic session values for testing
const mockSessionKey = "sk_sess_test_mock_key_abc123def456";
const mockManagedWallet = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV";

vi.mock("../src/services/sessionService", () => ({
  createSession: vi.fn().mockResolvedValue({
    sessionId: "sess_test_" + Date.now(),
    ownerId: "owner_test_" + Date.now(),
    sessionKey: mockSessionKey,
    managedWalletAddress: mockManagedWallet,
  }),
  validateSession: vi.fn().mockImplementation(async (key: string) => {
    if (key === mockSessionKey) {
      return {
        sessionId: "sess_test_validated",
        ownerId: "owner_test_validated",
        email: "test@asgcard.dev",
        managedWalletAddress: mockManagedWallet,
      };
    }
    return null;
  }),
}));

// Mock cardService — return a mock card without calling the real issuer
vi.mock("../src/services/cardService", () => {
  const HttpError = class extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message); this.status = status; this.name = "HttpError";
    }
  };
  return {
    HttpError,
    cardService: {
      createCard: vi.fn(async (params: Record<string, unknown>) => ({
        success: true,
        card: {
          cardId: `card_test_${Date.now()}`,
          status: "active",
          balance: params.amount,
          externalId: "ext_test",
          walletAddress: params.walletAddress,
          paymentRail: params.paymentRail,
        },
        payment: {
          txHash: params.txHash,
          amount: params.amount,
          chargedUsd: params.chargedUsd,
          paymentRail: params.paymentRail,
        },
        details: {
          cardNumber: "5200000000001234",
          cvv: "321",
          expiryMonth: "12",
          expiryYear: "2028",
          billingAddress: { line1: "123 Test St", city: "Test", state: "CA", zip: "90001", country: "US" },
        },
      })),
    },
  };
});

import { createApp } from "../src/app";

// ── MPP credential builder (matches the protocol spec) ──────────

interface MppChallengeWire {
  id: string;
  realm: string;
  method: string;
  intent: string;
  request: string;
  description?: string;
  expires?: string;
}

function parseMppChallenge(wwwAuth: string): MppChallengeWire | null {
  const match = wwwAuth.match(/^Payment\s+(.+)$/i);
  if (!match?.[1]) return null;
  try {
    const json = Buffer.from(match[1], "base64url").toString("utf8");
    return JSON.parse(json) as MppChallengeWire;
  } catch {
    return null;
  }
}

function buildMppCredential(challenge: MppChallengeWire, sptId: string): string {
  const wire = {
    challenge,
    payload: { spt: sptId },
  };
  const json = JSON.stringify(wire);
  return `Payment ${Buffer.from(json).toString("base64url")}`;
}

// ═════════════════════════════════════════════════════════════════

let app: Express;
beforeAll(async () => { app = await createApp(); });

// ═════════════════════════════════════════════════════════════════
// 1. Session Auth Gate
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Session Auth", () => {
  it("POST /stripe-beta/create without X-STRIPE-SESSION → 401", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "t@t.com", amount: 25 });

    expect(res.status).toBe(401);
    expect(res.body.error).toContain("STRIPE-SESSION");
  });

  it("POST /stripe-beta/create with invalid session → 401", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", "sk_sess_invalid_bogus_key")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "t@t.com", amount: 25 });

    expect(res.status).toBe(401);
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. Session → 402 Official MPP Challenge
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — 402 Official MPP Challenge (Session Auth)", () => {
  it("POST with valid session + no credential → 402 with WWW-Authenticate: Payment", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", mockSessionKey)
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test Agent", email: "test@asgcard.dev", amount: 25 });

    expect(res.status).toBe(402);

    // Official MPP: WWW-Authenticate header must be present
    const wwwAuth = res.headers["www-authenticate"];
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth).toMatch(/^Payment\s+/i);

    // Parse the challenge
    const challenge = parseMppChallenge(wwwAuth);
    expect(challenge).not.toBeNull();
    expect(challenge!.id).toBeDefined();
    expect(challenge!.realm).toBe("asgcard.dev");
    expect(challenge!.method).toBe("stripe");
    expect(challenge!.intent).toBe("charge");

    // Body is RFC 9457 Problem Details
    expect(res.body.type).toBe("https://mpp.dev/errors/payment-required");
    expect(res.body.status).toBe(402);
    expect(res.body.challengeId).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. Malformed Credential → 402
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Malformed Credential", () => {
  it("POST with invalid Authorization: Payment → 402 malformed", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", mockSessionKey)
      .set("Authorization", "Payment invalid_base64_garbage!!!")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "test@test.com", amount: 25 });

    expect(res.status).toBe(402);
    expect(res.body.type).toContain("malformed-credential");

    // Must re-issue challenge
    const wwwAuth = res.headers["www-authenticate"];
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth).toMatch(/^Payment\s+/i);
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. Tampered Challenge (wrong HMAC) → 402
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Invalid HMAC", () => {
  it("POST with credential containing tampered challenge → 402", async () => {
    const fakeChallenge: MppChallengeWire = {
      id: "fake_hmac_id_not_generated_by_server",
      realm: "asgcard.dev",
      method: "stripe",
      intent: "charge",
      request: 'amount="2500"&currency="usd"',
    };

    const credential = buildMppCredential(fakeChallenge, "spt_valid_test_123");

    const res = await request(app)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", mockSessionKey)
      .set("Authorization", credential)
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "test@test.com", amount: 25 });

    expect(res.status).toBe(402);
    expect(res.body.type).toContain("invalid-challenge");
    expect(res.body.detail).toContain("not issued by this server");
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. Happy Path — Valid Credential → 201
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Happy Path (Session Auth + MPP)", () => {
  it("402 challenge → build credential → retry → 201 card created", async () => {
    const amount = 25;
    const body = { nameOnCard: "Agent Alpha", email: "alpha@asgcard.dev", amount };

    // Step 1: GET the 402 challenge with session auth
    const res1 = await request(app)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", mockSessionKey)
      .set("Content-Type", "application/json")
      .send(body);

    expect(res1.status).toBe(402);
    const wwwAuth = res1.headers["www-authenticate"];
    expect(wwwAuth).toBeDefined();

    const challenge = parseMppChallenge(wwwAuth);
    expect(challenge).not.toBeNull();

    // Step 2: Build credential with valid SPT
    const credential = buildMppCredential(challenge!, "spt_valid_test_token_123");

    // Step 3: Retry with Authorization: Payment header + session auth
    const res2 = await request(app)
      .post("/stripe-beta/create")
      .set("X-STRIPE-SESSION", mockSessionKey)
      .set("Authorization", credential)
      .set("Content-Type", "application/json")
      .send(body);

    expect(res2.status).toBe(201);
    expect(res2.body.success).toBe(true);
    expect(res2.body.card).toBeDefined();
    expect(res2.body.card.cardId).toBeDefined();
    expect(res2.body.paymentRail).toBe("stripe_mpp");
    expect(res2.body.beta).toBe(true);
    expect(res2.body.detailsEnvelope).toBeDefined();
    expect(res2.body.detailsEnvelope.cardNumber).toBeDefined();

    // Verify receipt header
    const receiptHeader = res2.headers["x-payment-receipt"];
    expect(receiptHeader).toBeDefined();
    const receipt = JSON.parse(Buffer.from(receiptHeader, "base64url").toString("utf8"));
    expect(receipt.method).toBe("stripe");
    expect(receipt.status).toBe("success");
    expect(receipt.reference).toMatch(/^pi_from_/);
  });
});

// ═════════════════════════════════════════════════════════════════
// 6. Session Creation
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Session Creation", () => {
  it("POST /stripe-beta/session with valid email → 201 with sessionKey", async () => {
    const res = await request(app)
      .post("/stripe-beta/session")
      .set("Content-Type", "application/json")
      .send({ email: "test@asgcard.dev" });

    expect(res.status).toBe(201);
    expect(res.body.sessionKey).toBeDefined();
    expect(res.body.sessionId).toBeDefined();
    expect(res.body.ownerId).toBeDefined();
    expect(res.body.managedWalletAddress).toBeDefined();
    expect(res.body.note).toContain("sessionKey");
  });

  it("POST /stripe-beta/session without email → 400", async () => {
    const res = await request(app)
      .post("/stripe-beta/session")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(400);
  });
});
