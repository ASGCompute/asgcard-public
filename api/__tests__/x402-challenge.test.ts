import { describe, it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

// Mock issuer balance check — always sufficient so existing 402 tests pass
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
import { calcCreationCost, calcFundingCost, toAtomicUsdc } from "../src/config/pricing";

let app: Express;
beforeAll(async () => { app = await createApp(); });

describe("x402 Challenge — Create (dynamic pricing)", () => {
    const testAmounts = [10, 25, 50, 100, 200, 500];

    for (const amount of testAmounts) {
        it(`POST /cards/create/tier/${amount} → 402 with correct dynamic challenge`, async () => {
            const expectedCost = calcCreationCost(amount);
            const expectedAtomic = toAtomicUsdc(expectedCost);

            const res = await request(app)
                .post(`/cards/create/tier/${amount}`)
                .expect(402);

            expect(res.body).toHaveProperty("x402Version", 2);
            expect(res.body.accepts).toHaveLength(1);

            const accept = res.body.accepts[0];
            expect(accept.scheme).toBe("exact");
            expect(accept.network).toBe("stellar:pubnet");
            expect(accept.asset).toBe("CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75");
            expect(accept.amount).toBe(expectedAtomic);
            expect(accept.payTo).toMatch(/^G[A-Z2-7]{55}$/);
            expect(accept.maxTimeoutSeconds).toBe(300);
            expect(res.body.resource.url).toContain(`/cards/create/tier/${amount}`);
            expect(res.body.resource.description).toContain(`$${amount}`);
        });
    }

    it("POST /cards/create/tier/75 → 402 (any valid amount works)", async () => {
        const expectedCost = calcCreationCost(75);
        const expectedAtomic = toAtomicUsdc(expectedCost);

        const res = await request(app)
            .post("/cards/create/tier/75")
            .expect(402);

        expect(res.body.accepts[0].amount).toBe(expectedAtomic);
    });
});

describe("x402 Challenge — Fund (dynamic pricing)", () => {
    const testAmounts = [10, 25, 50, 100, 200, 500];

    for (const amount of testAmounts) {
        it(`POST /cards/fund/tier/${amount} → 402 with correct dynamic challenge`, async () => {
            const expectedCost = calcFundingCost(amount);
            const expectedAtomic = toAtomicUsdc(expectedCost);

            const res = await request(app)
                .post(`/cards/fund/tier/${amount}`)
                .expect(402);

            expect(res.body).toHaveProperty("x402Version", 2);
            expect(res.body.accepts[0].amount).toBe(expectedAtomic);
            expect(res.body.resource.url).toContain(`/cards/fund/tier/${amount}`);
        });
    }
});

describe("x402 Challenge — Amount Validation", () => {
    it("POST /cards/create/tier/3 → 400 (below min)", async () => {
        const res = await request(app)
            .post("/cards/create/tier/3")
            .expect(400);

        expect(res.body.error).toContain("Invalid amount");
    });

    it("POST /cards/fund/tier/6000 → 400 (above max)", async () => {
        const res = await request(app)
            .post("/cards/fund/tier/6000")
            .expect(400);

        expect(res.body.error).toContain("Invalid amount");
    });

    it("POST /cards/create/tier/abc → 400 (non-numeric)", async () => {
        const res = await request(app)
            .post("/cards/create/tier/abc")
            .expect(400);

        expect(res.body.error).toContain("Invalid amount");
    });

    it("POST /cards/create/tier/25 with malformed X-Payment → 401", async () => {
        const res = await request(app)
            .post("/cards/create/tier/25")
            .set("X-Payment", "not-valid-json-or-base64")
            .expect(401);

        expect(res.body.error).toBe("Invalid X-PAYMENT header: expected x402 v2 PaymentPayload");
    });

    it("POST /cards/create/tier/25 with wrong network in X-Payment → 401", async () => {
        const payment = {
            x402Version: 2,
            accepted: {
                scheme: "exact",
                network: "eip155:1" // wrong network
            },
            payload: {
                transaction: "xyz"
            }
        };
        const encoded = Buffer.from(JSON.stringify(payment)).toString("base64");
        const res = await request(app)
            .post("/cards/create/tier/25")
            .set("X-Payment", encoded)
            .expect(401);

        expect(res.body.error).toBe("Unsupported payment scheme or network");
    });
});

describe("Public Endpoints", () => {
    it("GET /health → 200 with status ok", async () => {
        const res = await request(app)
            .get("/health")
            .expect(200);

        expect(res.body.status).toBe("ok");
        expect(res.body.version).toBeDefined();
        expect(res.body.timestamp).toBeDefined();
    });

    it("GET /pricing → 200 with dynamic pricing model", async () => {
        const res = await request(app)
            .get("/pricing")
            .expect(200);

        expect(res.body.cardFee).toBe(10);
        expect(res.body.topUpPercent).toBe(3.5);
        expect(res.body.minAmount).toBe(5);
        expect(res.body.maxAmount).toBe(5000);
    });

    it("GET /cards/tiers → 200 with pricing info", async () => {
        const res = await request(app)
            .get("/cards/tiers")
            .expect(200);

        expect(res.body.cardFee).toBe(10);
        expect(res.body.topUpPercent).toBe(3.5);
    });

    it("GET /nonexistent → 404", async () => {
        await request(app)
            .get("/nonexistent")
            .expect(404);
    });
});

describe("Wallet Auth Errors", () => {
    it("GET /wallet → 401 without auth headers", async () => {
        const res = await request(app)
            .get("/cards")
            .expect(401);

        expect(res.body.error).toBe("Missing wallet authentication headers");
    });

    it("GET /wallet → 401 with invalid timestamp", async () => {
        const res = await request(app)
            .get("/cards")
            .set("X-WALLET-ADDRESS", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
            .set("X-WALLET-SIGNATURE", "dGVzdA==")
            .set("X-WALLET-TIMESTAMP", "not-a-number")
            .expect(401);

        expect(res.body.error).toBe("Invalid wallet timestamp");
    });

    it("GET /wallet → 401 with expired timestamp", async () => {
        const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
        const res = await request(app)
            .get("/cards")
            .set("X-WALLET-ADDRESS", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
            .set("X-WALLET-SIGNATURE", "dGVzdA==")
            .set("X-WALLET-TIMESTAMP", String(oldTimestamp))
            .expect(401);

        expect(res.body.error).toBe("Wallet timestamp outside accepted window");
    });
});
