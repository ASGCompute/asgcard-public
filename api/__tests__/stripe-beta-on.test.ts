/**
 * Stripe MPP Beta — Production Path Tests (beta ON)
 *
 * Uses vi.mock to override env module with beta enabled.
 * Tests: 402 challenge, Freighter auth, SPT validation, happy path.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import crypto from "node:crypto";
import nacl from "tweetnacl";
import { StrKey, Keypair } from "@stellar/stellar-sdk";

// ── Mock env with beta enabled ──────────────────────────────────
vi.mock("../src/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../src/config/env")>();
  return {
    env: {
      ...mod.env,
      STRIPE_MPP_BETA_ENABLED: "true",
      STRIPE_PUBLISHABLE_KEY: "pk_test_dummy_for_tests",
      STRIPE_SECRET_KEY: "sk_test_dummy_for_tests",
      STRIPE_BETA_ALLOWLIST: "",  // empty = allow all
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

// Mock Stripe service — test SPT → PI flow
vi.mock("../src/services/stripeService", () => ({
  createPaymentIntentWithSPT: vi.fn(async (sptId: string) => {
    if (sptId.startsWith("spt_valid")) {
      return { success: true, paymentIntentId: `pi_from_${sptId}` };
    }
    return { success: false, paymentIntentId: "", error: "Invalid SPT" };
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

// ── Test Key ────────────────────────────────────────────────────

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
// 2. Raw Auth → 402 Challenge
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Raw Auth → 402", () => {
  it("POST with raw wallet auth + no SPT → 402 with paymentRequired", async () => {
    const headers = buildRawAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test Agent", email: "test@asgcard.dev", amount: 25 });

    expect(res.status).toBe(402);
    expect(res.body.paymentRequired).toBeDefined();
    expect(res.body.paymentRequired.currency).toBe("usd");
    expect(res.body.paymentRequired.amount).toBeGreaterThan(0);
    expect(res.body.paymentRequired.stripePublishableKey).toBe("pk_test_dummy_for_tests");
  });
});

// ═════════════════════════════════════════════════════════════════
// 3. Freighter Auth (message mode) → 402
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Freighter Auth (SEP-0043)", () => {
  it("POST with Freighter signMessage auth + no SPT → 402", async () => {
    const headers = buildFreighterAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Browser User", email: "browser@asgcard.dev", amount: 50 });

    expect(res.status).toBe(402);
    expect(res.body.paymentRequired).toBeDefined();
    expect(res.body.paymentRequired.amount).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════
// 4. SPT Validation
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — SPT Validation", () => {
  it("POST with invalid SPT format → 400", async () => {
    const headers = buildRawAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
      .set("X-STRIPE-SPT", "not_a_valid_spt")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "test@test.com", amount: 25 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid X-STRIPE-SPT");
  });

  it("POST with SPT that Stripe rejects → 402 error", async () => {
    const headers = buildRawAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
      .set("X-STRIPE-SPT", "spt_rejected_by_stripe_12345")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Test", email: "test@test.com", amount: 25 });

    expect(res.status).toBe(402);
    expect(res.body.error).toBeDefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// 5. Happy Path — Valid SPT → 201
// ═════════════════════════════════════════════════════════════════

describe("Stripe Beta ON — Happy Path", () => {
  it("POST with valid SPT → 201 card created", async () => {
    const headers = buildRawAuthHeaders();
    const res = await request(app)
      .post("/stripe-beta/create")
      .set(headers)
      .set("X-STRIPE-SPT", "spt_valid_test_token_123")
      .set("Content-Type", "application/json")
      .send({ nameOnCard: "Agent Alpha", email: "alpha@asgcard.dev", amount: 25 });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.card).toBeDefined();
    expect(res.body.card.cardId).toBeDefined();
    expect(res.body.paymentRail).toBe("stripe_mpp");
    expect(res.body.beta).toBe(true);
  });
});
