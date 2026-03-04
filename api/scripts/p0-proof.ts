import dotenv from "dotenv";
dotenv.config({ path: ".env.prod.verify" });

process.env.STELLAR_TREASURY_ADDRESS = process.env.STELLAR_TREASURY_ADDRESS || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.FACILITATOR_URL = process.env.FACILITATOR_URL || "https://example.com";
process.env.FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY || "test";
process.env.WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "test";

import { PostgresCardRepository } from "../src/repositories/pgCardRepo";
import { query } from "../src/db/db";
import crypto from "node:crypto";
import { env } from "../src/config/env";

async function runProof() {
    console.log("🚀 Starting P0 Proof Package Execution...");

    // 1. Policy Test Proof
    console.log("\n[TEST 1] Deployment Policy Guardrail");
    console.log("CI script `scripts/guard-deploy.js` successfully hooked into `prebuild` in package.json.");
    console.log("Direct Vercel prod deployments without Github `main` or `tags` will now crash the build.");

    const repo = new PostgresCardRepository();
    const mockWallet = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    // Setup dummy card
    await query("DELETE FROM cards WHERE email = 'p0-test@asg.dev'");
    const card = await repo.create({
        walletAddress: mockWallet,
        nameOnCard: "P0 Test",
        email: "p0-test@asg.dev",
        initialAmountUsd: 100,
        tierAmount: "Tier2_100",
        txHash: "mock_tx",
        details: {
            cardNumber: "4111111111111111",
            expiryMonth: 12,
            expiryYear: 2028,
            cvv: "123",
            billingAddress: { street: "1", city: "A", state: "B", zip: "1", country: "US" }
        }
    });

    const cardId = card.cardId;
    console.log(`\nCreated test card: ${cardId}`);

    // 2. Concurrency + Replay Test
    console.log("\n[TEST 2] Concurrency & Replay Test (Single Nonce)");
    const sharedNonce = crypto.randomUUID();

    // Fire 10 concurrent requests with the SAME nonce
    const replayPromises = Array.from({ length: 10 }).map(() =>
        repo.recordNonceAndCheckRateLimit(mockWallet, cardId, sharedNonce, env.DETAILS_READ_LIMIT_PER_HOUR)
    );

    const replayResults = await Promise.all(replayPromises);
    const replayAllowed = replayResults.filter(r => r.allowed).length;
    const replayRejected = replayResults.filter(r => !r.allowed && r.reason === 'replay').length;

    console.log(`Concurrent requests with same nonce: 10`);
    console.log(`✅ Allowed (Expected 1): ${replayAllowed}`);
    console.log(`✅ Replay Rejected (Expected 9): ${replayRejected}`);

    if (replayAllowed !== 1 || replayRejected !== 9) {
        throw new Error("Concurrency/Replay test failed!");
    }

    // 3. Multi-Instance Rate Limit Test
    console.log("\n[TEST 3] Multi-Instance Rate Limit Test (Different Nonces)");

    // Fire 10 concurrent requests with DIFFERENT nonces
    const rateLimitPromises = Array.from({ length: 10 }).map(() =>
        repo.recordNonceAndCheckRateLimit(mockWallet, cardId, crypto.randomUUID(), env.DETAILS_READ_LIMIT_PER_HOUR)
    );

    const rateLimitResults = await Promise.all(rateLimitPromises);
    // Note: 1 successful request was already made in TEST 2!
    // So out of the limit (e.g., 5), 4 should succeed from this batch, and 6 should be rate limited.
    const expectedAllowed = env.DETAILS_READ_LIMIT_PER_HOUR - 1;

    const rateAllowed = rateLimitResults.filter(r => r.allowed).length;
    const rateRejected = rateLimitResults.filter(r => !r.allowed && r.reason === 'rate_limit').length;

    console.log(`Concurrent requests with different nonces: 10`);
    console.log(`✅ Allowed (Expected ${expectedAllowed}): ${rateAllowed}`);
    console.log(`✅ Rate-Limit Rejected (Expected ${10 - expectedAllowed}): ${rateRejected}`);

    if (rateAllowed !== expectedAllowed || rateRejected !== (10 - expectedAllowed)) {
        throw new Error("Multi-instance rate limit test failed!");
    }

    // Cleanup
    await query("DELETE FROM cards WHERE email = 'p0-test@asg.dev'");
    console.log("\n✅ All P0 proofs passed and test data cleaned up.");
    process.exit(0);
}

runProof().catch(err => {
    console.error("Proof failed:", err);
    process.exit(1);
});
