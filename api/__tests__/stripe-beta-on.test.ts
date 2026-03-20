/**
 * Stripe MPP Beta — Official MPP Contract Tests (beta ON)
 *
 * Tests the official Machine Payments Protocol (MPP) transport:
 *   - 402 with WWW-Authenticate: Payment <challenge>
 *   - Retry with Authorization: Payment <credential> containing SPT
 *   - HMAC-bound challenge verification
 *   - Freighter (SEP-0043) auth + MPP challenge
 *   - Happy path: valid credential → 201 card created
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import crypto from "node:crypto";
import nacl from "tweetnacl";
import { StrKey, Keypair } from "@stellar/stellar-sdk";

// ── Mock env with beta enabled + MPP key ────────────────────────
vi.mock("../src/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/config/env")>();
  return {
    env: {
      ...mod.env,
      STRIPE_MPP_BETA_ENABLED: "true",
      STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_for_tests",
      STRIPE_SECRET_KEY: "sk_test_dummy_for_tests",
      STRIPE_BETA_ALLOWLIST: "",  // empty = allow all
      MPP_SECRET_KEY: "test-mpp-secret-key-for-hmac-challenges-32chars!",
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

// ── Test Helpers ────────────────────────────────────────────────

const testKeypair = Keypair.random();
const testPubKey = testKeypair.publicKey();

function fullSecretKey(): Uint8Array {
  const full = Buffer.alloc(64);
  full.set(testKeypair.rawSecretKey(), 0);
  full.set(StrKey.decodeEd25519PublicKey(testPubKey), 32);
  return new Uint8Array(full);
}

function buildRawAuthHeaders(): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const msg = `asgcard-auth:${timestamp}`;
  const sig = nacl.sign.detached(new TextEncoder().encode(msg), fullSecretKey());
  return {
    "X-WALLET-ADDRESS": testPubKey,
    "X-WALLET-SIGNATURE": Buffer.from(sig).toString("base64"),
    "X-WALLET-TIMESTAMP": timestamp,
  };
}

function buildFreighterAuthHeaders(): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const msg = `asgcard-auth:${timestamp}`;
  const prefix = "Stellar Signed Message:\n";
  const payload = Buffer.concat([Buffer.from(prefix, "utf8"), Buffer.from(msg, "utf8")]);
  const hash = crypto.createHash("sha256").update(payload).digest();
  const sig = nacl.sign.detached(new Uint8Array(hash), fullSecretKey());
  return {
    "X-WALLET-ADDRESS": testPubKey,
    "X-WALLET-SIGNATURE": Buffer.from(sig).toString("base64"),
    "X-WALLET-TIMESTAMP": timestamp,
    "X-WALLET-AUTH-MODE": "message",
  };
}

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
// 1. Auth Gate
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Auth", () => {
  it("POST /stripe-beta/create without wallet auth → 401", async () => {
    const res = await request(app)
      .post("/stripe-beta/create")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "t@t.com", amount: 25 });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Missing wallet authentication headers");
  });
});

// ═════════════════════════════════════════════════════════════════
// 2. Raw Auth → 402 Official MPP Challenge
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — 402 Official MPP Challenge", () => {
  it("POST with auth + no credential → 402 with WWW-Authenticate: Payment", async () => {
    const headers = buildRawAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
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

    // Body is RFC 9457 Problem Details (not custom paymentRequired JSON)
    expect(res.body.type).toBe("https://mpp.dev/errors/payment-required");
    expect(res.body.status).toBe(402);
    expect(res.body.challengeId).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. Freighter Auth (SEP-0043) → 402 MPP Challenge
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Freighter Auth → MPP Challenge", () => {
  it("POST with Freighter signMessage auth + no credential → 402", async () => {
    const headers = buildFreighterAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Browser User", email: "browser@asgcard.dev", amount: 50 });

    expect(res.status).toBe(402);

    const wwwAuth = res.headers["www-authenticate"];
    expect(wwwAuth).toBeDefined();
    expect(wwwAuth).toMatch(/^Payment\s+/i);

    const challenge = parseMppChallenge(wwwAuth);
    expect(challenge).not.toBeNull();
    expect(challenge!.method).toBe("stripe");
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. Malformed Credential → 402
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Malformed Credential", () => {
  it("POST with invalid Authorization: Payment → 402 malformed", async () => {
    const headers = buildRawAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
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
// 5. Tampered Challenge (wrong HMAC) → 402
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Invalid HMAC", () => {
  it("POST with credential containing tampered challenge → 402", async () => {
    const headers = buildRawAuthHeaders();

    // Build a fake challenge with wrong HMAC ID
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
      .set(headers)
      .set("Authorization", credential)
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "test@test.com", amount: 25 });

    expect(res.status).toBe(402);
    expect(res.body.type).toContain("invalid-challenge");
    expect(res.body.detail).toContain("not issued by this server");
  });
});

// ═════════════════════════════════════════════════════════════════
// 6. Happy Path — Valid Credential → 201
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Happy Path (Official MPP)", () => {
  it("GET 402 challenge → build credential → retry → 201 card created", async () => {
    const amount = 25;
    const body = { nameOnCard: "Agent Alpha", email: "alpha@asgcard.dev", amount };

    // Step 1: GET the 402 challenge
    const headers1 = buildRawAuthHeaders();
    const res1 = await request(app)
      .post("/stripe-beta/create")
      .set(headers1)
      .set("Content-Type", "application/json")
      .send(body);

    expect(res1.status).toBe(402);
    const wwwAuth = res1.headers["www-authenticate"];
    expect(wwwAuth).toBeDefined();

    const challenge = parseMppChallenge(wwwAuth);
    expect(challenge).not.toBeNull();

    // Step 2: Build credential with valid SPT
    const credential = buildMppCredential(challenge!, "spt_valid_test_token_123");

    // Step 3: Retry with Authorization: Payment header
    const headers2 = buildRawAuthHeaders();
    const res2 = await request(app)
      .post("/stripe-beta/create")
      .set(headers2)
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
