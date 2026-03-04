const crypto = require('node:crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const fs = require('fs');

const API_URL = "https://api.asgcard.dev";
let OPS_KEY = process.env.OPS_API_KEY;

// Fallback to reading env directly if not populated
if (!OPS_KEY) {
    try {
        const envText = fs.readFileSync('.env.prod', 'utf8');
        const match = envText.match(/OPS_API_KEY="([^"]+)"/);
        if (match) OPS_KEY = match[1];
    } catch (e) { }
}

// Generate an Ed25519 keypair for authentication
const keypair = nacl.sign.keyPair();
const publicKeyBase58 = bs58.encode(Buffer.from(keypair.publicKey));

function signRequest(urlPath, body, method = "POST") {
    const timestamp = Date.now().toString();
    const payload = body ? JSON.stringify(body) : "";
    let dataToSign = `${method}:${urlPath}:${timestamp}`;
    if (payload) dataToSign += `:${payload}`;
    const hash = crypto.createHash("sha256").update(dataToSign).digest();
    const signatureBytes = nacl.sign.detached(hash, keypair.secretKey);
    const signatureHex = Buffer.from(signatureBytes).toString("hex");

    return {
        "Content-Type": "application/json",
        "X-WALLET-ADDRESS": publicKeyBase58,
        "X-WALLET-SIGNATURE": signatureHex,
        "X-WALLET-TIMESTAMP": timestamp
    };
}

async function run() {
    try {
        console.log("SMOKE TEST PROTOCOL / REALIGN / " + new Date().toISOString());
        console.log("---------------------------------------------------------");

        // 1. POST /cards/create/tier/25
        const createPath = "/cards/create/tier/25";
        const createBody = {
            network: "stellar",
            txHash: "smoke_" + Date.now().toString(),
            nameOnCard: "Prod Smoke Bot",
            email: "bot@asg.dev"
        };
        const createHeaders = signRequest(createPath, createBody, "POST");
        const createRes = await fetch(API_URL + createPath, {
            method: "POST",
            headers: createHeaders,
            body: JSON.stringify(createBody)
        });
        const createData = await createRes.json();
        const createCode = createRes.status;
        console.log(`[POST /create] Code: ${createCode}`);
        const hasEnvelope = !!createData.detailsEnvelope;
        console.log(`[POST /create] Has detailsEnvelope: ${hasEnvelope}`);

        if (createCode !== 201) throw new Error("Create failed: " + JSON.stringify(createData));

        const cardId = createData.card.cardId;

        // 2. GET /cards/:id/details with Nonce
        const nonce = crypto.randomUUID();
        const detailsPath = `/cards/${cardId}/details`;
        const getHeaders = signRequest(detailsPath, null, "GET");
        getHeaders["X-AGENT-NONCE"] = nonce;

        const getRes1 = await fetch(API_URL + detailsPath, { method: "GET", headers: getHeaders });
        const getCode1 = getRes1.status;
        console.log(`[GET /details] Code: ${getCode1} (success)`);

        // 3. Repeat GET with same nonce -> Blocked (Replay)
        const getRes2 = await fetch(API_URL + detailsPath, { method: "GET", headers: getHeaders });
        const getCode2 = getRes2.status;
        console.log(`[GET /details replay] Code: ${getCode2} (should be 409 blocked)`);

        // 4. POST /portal/cards/:id/revoke-details
        const revokePath = `/portal/cards/${cardId}/revoke-details`;
        const revokeHeaders = signRequest(revokePath, null, "POST");
        const revokeRes = await fetch(API_URL + revokePath, { method: "POST", headers: revokeHeaders });
        console.log(`[POST /revoke-details] Code: ${revokeRes.status}`);

        // 5. GET /cards/:id/details again -> 403 Forbidden
        const nonce2 = crypto.randomUUID();
        const getHeaders2 = signRequest(detailsPath, null, "GET");
        getHeaders2["X-AGENT-NONCE"] = nonce2;
        const getRes3 = await fetch(API_URL + detailsPath, { method: "GET", headers: getHeaders2 });
        const getCode3 = getRes3.status;
        console.log(`[GET /details post-revoke] Code: ${getCode3} (should be 403)`);

        // 6. Health & Metrics (No Regressions)
        const healthRes = await fetch(API_URL + "/health");
        console.log(`[GET /health] Code: ${healthRes.status}`);

        const opsRes = await fetch(API_URL + "/bot/ops/metrics", {
            headers: { "X-Ops-Key": OPS_KEY }
        });
        console.log(`[GET /ops/metrics] Code: ${opsRes.status}`);

        console.log("\nALL SMOKE TESTS COMPLETED!");
    } catch (e) {
        console.error("SMOKE TEST FAILED:", e);
        process.exit(1);
    }
}
run();
