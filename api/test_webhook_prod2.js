const crypto = require("crypto");
const https = require("https");

const secret = "3e921193cdaf87f0947e1fd85a3877e46f287ae465efd89ccb2bfdc93718d01b";

function makePayload(idempKey) {
    return JSON.stringify({
        type: "card.funded",
        idempotency_key: idempKey,
        data: {
            card_id: "c_test_mainnet_1",
            amount: 1000,
            currency: "USD",
            tx_hash: "test_tx_hash_mainnet_idempotency_check"
        }
    });
}

function sendReq(label, payloadStr) {
    const rawBody = Buffer.from(payloadStr, "utf-8");
    const sig = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const options = {
        hostname: 'api.asgcard.dev',
        port: 443,
        path: '/webhooks/4payments',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'webhook-sign': sig,
            'Content-Length': rawBody.length
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                console.log(`${label} -> HTTP ${res.statusCode}: ${body}`);
                resolve();
            });
        });
        req.on('error', e => { console.error(`${label} ERROR: ${e.message}`); resolve(); });
        req.write(rawBody);
        req.end();
    });
}

(async () => {
    const IDEMPKEY = "mnet-e2e-idem-" + Date.now();
    const payload = makePayload(IDEMPKEY);
    console.log("Using idempotency_key:", IDEMPKEY);
    await sendReq("Req 1 (New event)", payload);
    await sendReq("Req 2 (Same key - duplicate)", payload);
    // Different key = new event
    const payload2 = makePayload("mnet-e2e-idem-" + (Date.now() + 1));
    await sendReq("Req 3 (Different key - new event)", payload2);
})();
