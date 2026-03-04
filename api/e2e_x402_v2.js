/**
 * x402 v2 E2E — Real USDC Payment
 *
 * Sends UNassembled Soroban tx with ADDRESS-type auth entries.
 * The facilitator will assemble (add footprint) and submit.
 */
const {
    Keypair, Networks,
    TransactionBuilder,
    Contract, Address, nativeToScVal,
    authorizeInvocation,
} = require("@stellar/stellar-sdk");
const rpc = require("@stellar/stellar-sdk/rpc");

const API = "https://api.asgcard.dev";
const SOROBAN_RPC = "https://soroban-testnet.stellar.org";
const NP = Networks.TESTNET;
const USDC_SAC_ID = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TREASURY = "GDYNYCXUPQUEOAJHFOMDYQZTJ2AVEFGFCR5HUKOXU2IYAA45XDLEENHM";

const PAYER_SECRET = "SB6UN3PKNWSOF5ZPRD46HJBBWFTDCTJ5DC5AXWSMCXI5ZP5LRYQGIK4H";

async function main() {
    const payer = Keypair.fromSecret(PAYER_SECRET);
    const sorobanServer = new rpc.Server(SOROBAN_RPC);

    console.log("╔══════════════════════════════════════════════╗");
    console.log("║       x402 v2 E2E — REAL USDC PAYMENT       ║");
    console.log("╚══════════════════════════════════════════════╝");
    console.log("Time:  " + new Date().toISOString());
    console.log("Payer: " + payer.publicKey());

    // ── 1. GET 402 ────────────────────────────────────────────
    console.log("\n1. GET 402 challenge...");
    const t1 = Date.now();
    const r1 = await fetch(API + "/cards/create/tier/10", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nameOnCard: "E2E v2", email: "e2e@v2.test" }),
        signal: AbortSignal.timeout(15000)
    });
    const challenge = await r1.json();
    console.log("   HTTP " + r1.status + " (" + (Date.now() - t1) + "ms)");
    const req = challenge.accepts[0];
    console.log("   amount: " + req.amount);

    // ── 2. Build raw tx with address-type auth ────────────────
    console.log("\n2. Build transfer tx...");
    const sac = new Contract(USDC_SAC_ID);
    const transferOp = sac.call(
        "transfer",
        new Address(payer.publicKey()).toScVal(),
        new Address(TREASURY).toScVal(),
        nativeToScVal(BigInt(req.amount), { type: "i128" })
    );

    // First simulate to get auth entries
    const payerAcc = await sorobanServer.getAccount(payer.publicKey());
    let simTx = new TransactionBuilder(payerAcc, {
        fee: "100000",
        networkPassphrase: NP
    })
        .addOperation(transferOp)
        .setTimeout(300)
        .build();

    console.log("   Simulating...");
    const sim = await sorobanServer.simulateTransaction(simTx);
    if (rpc.Api.isSimulationError(sim)) {
        console.log("   ❌ " + JSON.stringify(sim.error).substring(0, 300));
        process.exit(1);
    }
    console.log("   ✓ Simulation OK (minResourceFee: " + sim.minResourceFee + ")");

    // Get the root invocation from simulated auth
    const assembledTx = rpc.assembleTransaction(simTx, sim).build();
    const simAuth = assembledTx.operations[0].auth[0];
    const rootInvocation = simAuth.rootInvocation();

    // Create address-type auth entry
    const latest = await sorobanServer.getLatestLedger();
    const signedAuth = await authorizeInvocation(
        payer,
        latest.sequence + 17,
        rootInvocation,
        payer.publicKey(),
        NP
    );
    console.log("   ✓ Address-type auth signed");

    // Build a FRESH (unassembled) tx with the signed auth
    // Important: use fresh account to get correct sequence
    const freshAcc = await sorobanServer.getAccount(payer.publicKey());

    // Create the invoke operation with our signed auth
    const freshOp = sac.call(
        "transfer",
        new Address(payer.publicKey()).toScVal(),
        new Address(TREASURY).toScVal(),
        nativeToScVal(BigInt(req.amount), { type: "i128" })
    );

    let tx = new TransactionBuilder(freshAcc, {
        fee: "100000",
        networkPassphrase: NP
    })
        .addOperation(freshOp)
        .setTimeout(300)
        .build();

    // Now assemble this fresh tx but inject our signed auth
    const sim2 = await sorobanServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim2)) {
        console.log("   ❌ Re-sim failed");
        process.exit(1);
    }

    tx = rpc.assembleTransaction(tx, sim2).build();

    // Replace the sourceAccount auth with our signed address-type auth
    const env = tx.toEnvelope();
    env.value().tx().operations()[0].body().invokeHostFunctionOp().auth([signedAuth]);
    env.value().signatures([]);

    tx = TransactionBuilder.fromXDR(env.toXDR("base64"), NP);
    console.log("   ✓ Final tx built (fee=" + tx.fee + ")");

    const rawXdr = tx.toXDR();
    console.log("   XDR length: " + rawXdr.length);

    // ── 3. Build v2 payload ───────────────────────────────────
    const paymentPayload = {
        x402Version: 2,
        accepted: req,
        payload: { transaction: rawXdr }
    };
    const header = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    // ── 4. POST with X-PAYMENT ───────────────────────────────
    console.log("\n3. POST X-PAYMENT...");
    const t2 = Date.now();
    const r2 = await fetch(API + "/cards/create/tier/10", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-PAYMENT": header
        },
        body: JSON.stringify({ nameOnCard: "E2E Card v2", email: "e2e@v2.card" }),
        signal: AbortSignal.timeout(60000)
    });
    const b2 = await r2.text();
    const lat2 = Date.now() - t2;
    console.log("   HTTP " + r2.status + " (" + lat2 + "ms)");
    console.log("   " + b2.substring(0, 600));

    if (r2.status === 201) console.log("\n   🎉 CARD CREATED! 🎉");

    // ── 5. Replay ─────────────────────────────────────────────
    console.log("\n4. REPLAY...");
    const t3 = Date.now();
    const r3 = await fetch(API + "/cards/create/tier/10", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-PAYMENT": header },
        body: JSON.stringify({ nameOnCard: "R", email: "r@t.co" }),
        signal: AbortSignal.timeout(30000)
    });
    const b3 = await r3.text();
    console.log("   HTTP " + r3.status + " (" + (Date.now() - t3) + "ms)");
    console.log("   " + b3.substring(0, 200));

    console.log("\n╔══════════════════════════╗");
    console.log("║    402:" + r1.status + "  Pay:" + r2.status + "  Replay:" + r3.status + "  ║");
    console.log("╚══════════════════════════╝");
}

main().catch(e => { console.error("FATAL:", e.message || e); process.exit(1); });
