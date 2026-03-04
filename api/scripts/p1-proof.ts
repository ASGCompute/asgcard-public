import { appLogger } from "../src/utils/logger";
import { httpLogger } from "../src/utils/logger";
import httpMocks from "node-mocks-http";
import { randomUUID } from "node:crypto";

async function runProof() {
    console.log("🚀 Starting P1 Observability Proof Package...\n");

    // 1. Structured Logs check
    console.log("--- 1. STRUCTURED JSON LOGS ---");
    appLogger.info({ event: "proof_started", system: "ASG_Card_API" }, "Structured logging initialized successfully");

    // 2. PAN/CVV Redaction check
    console.log("\n--- 2. PAN/CVV/AUTHENTICATION REDACTION ---");
    const sensitivePayload = {
        event: "card_creation",
        walletAddress: "GABCD123",
        amount: 100,
        cardNumber: "4111111111111111", // Should be redacted
        cvv: "123", // Should be redacted
        expiryMonth: 12,
        expiryYear: 2029, // Should be redacted
        detailsEnvelope: "encrypted_payload...", // Should be redacted
        safeField: "this should remain visible"
    };
    appLogger.info(sensitivePayload, "Testing data leak redaction filters");

    const nestedLeak = {
        error: "Failed to process",
        requestData: {
            cardNumber: "4222222222222222", // Should be redacted
            cvv: "000" // Should be redacted
        }
    };
    appLogger.error({ err: nestedLeak }, "Testing nested data leak redaction");


    // 3. Global Trace ID Check (using pino-http mock)
    console.log("\n--- 3. HTTP GLOBAL TRACE IDs ---");
    const req = httpMocks.createRequest({
        method: 'POST',
        url: '/cards/create/tier/Tier1_50',
        headers: {
            'authorization': 'Bearer super-secret-token', // Should be redacted automatically by pino-http
            'x-agent-nonce': randomUUID() // Should be redacted
        }
    });

    const res = httpMocks.createResponse();

    // Process through the http logger middleware
    httpLogger(req, res, () => {
        // Output trace ID injected onto request object
        console.log(`[Express req.id attached]: ${req.id}`);
        console.log(`[Response X-Request-Id header]: ${res.getHeader('X-Request-Id')}`);

        // Log something from inside the fake "route" which will inherit the request context?
        // Actually pino-http adds req.log which has the bindings. 
        if (req.log) {
            req.log.info("Processing card creation inside route (notice traceId is injected in the JSON)");
        }
    });

    console.log("\n✅ All P1 Observation proofs completed.");
}

runProof().catch(console.error);
