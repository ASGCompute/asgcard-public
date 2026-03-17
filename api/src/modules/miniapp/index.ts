import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env";
import { query } from "../../db/db";
import { appLogger } from "../../utils/logger";
import { AuditService } from "../authz/auditService";
import { cardService } from "../../services/cardService";
import { FUNDING_TIERS } from "../../config/pricing";
import { CryptoBotClient } from "../payments/cryptoBot";

export const miniappRouter = Router();

// ── Helpers ────────────────────────────────────────────────

function validateInitData(initData: string, botToken: string): any | null {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');
    if (!hash) return null;
    urlParams.delete('hash');
    const keys = Array.from(urlParams.keys()).sort();
    const dataCheckString = keys.map(k => `${k}=${urlParams.get(k)}`).join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (computedHash === hash) {
        const userStr = urlParams.get('user');
        if (userStr) { try { return JSON.parse(userStr); } catch { return null; } }
    }
    return null;
}

/**
 * Derive a deterministic wallet identifier for a Telegram user.
 * NOTE: This is a DB-level identifier, NOT a real blockchain wallet.
 * It links Telegram users to their cards. The hash must remain stable
 * to preserve existing DB associations (do NOT change the seed format).
 */
function deriveTelegramWalletId(telegramUserId: number): string {
    const hash = crypto.createHash('sha256').update(`sim-wallet-seed-${telegramUserId}-${env.TG_BOT_TOKEN}`).digest('hex');
    return '0x' + hash.slice(0, 40);
}

/** Extract and verify user from initData */
function extractUser(initData: string): { id: number; first_name?: string } | null {
    if (!initData) return null;
    const botToken = env.TG_BOT_TOKEN;
    if (!botToken) return null;
    // test_mode: requires explicit opt-in AND non-production
    if (initData === 'test_mode'
        && process.env.NODE_ENV !== 'production'
        && process.env.MINIAPP_TEST_MODE === 'true') {
        appLogger.warn('[MiniApp] test_mode bypass active — disable MINIAPP_TEST_MODE in production');
        return { id: 123456789, first_name: "Test" };
    }
    return validateInitData(initData, botToken);
}

/** Resolve wallet and profile for a telegram user ID */
async function resolveWalletData(telegramUserId: number): Promise<{ wallet: string, email: string | null, phone: string | null } | null> {
    const rows = await query<{ owner_wallet: string, email: string | null, phone: string | null }>(
        `SELECT owner_wallet, email, phone FROM owner_telegram_links WHERE telegram_user_id = $1 AND status = 'active' LIMIT 1`,
        [telegramUserId]
    );
    return rows.length > 0 ? { wallet: rows[0].owner_wallet, email: rows[0].email, phone: rows[0].phone } : null;
}

// ── POST /onboard ──────────────────────────────────────────

miniappRouter.post("/onboard", async (req, res) => {
    try {
        const { initData } = req.body;
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Invalid Telegram Signature" }); return; }

        const telegramUserId = user.id;
        const walletId = deriveTelegramWalletId(telegramUserId);

        await query(
            `INSERT INTO owner_telegram_links (owner_wallet, telegram_user_id, status)
             VALUES ($1, $2, 'active')
             ON CONFLICT (owner_wallet, telegram_user_id)
             DO UPDATE SET status = 'active', linked_at = now(), revoked_at = NULL`,
            [walletId, telegramUserId]
        );

        await AuditService.log({
            actorType: "telegram_user", actorId: String(telegramUserId),
            action: "miniapp_wallet_created", resourceId: walletId, decision: "allow",
        });

        res.json({ success: true, walletAddress: walletId, telegramUserId });
    } catch (error) {
        appLogger.error({ err: error }, "[MiniApp] Onboard error");
        res.status(500).json({ error: "Internal server error" });
    }
});

// ── GET /cards ─────────────────────────────────────────────

miniappRouter.get("/cards", async (req, res) => {
    try {
        const initData = (req.query.initData as string) || '';
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Unauthorized" }); return; }

        const walletData = await resolveWalletData(user.id);
        if (!walletData) { res.json({ cards: [], walletAddress: '', profile: null }); return; }

        const cards = await cardService.listCards(walletData.wallet);
        res.json({ cards, walletAddress: walletData.wallet, profile: { email: walletData.email, phone: walletData.phone } });
    } catch (error) {
        appLogger.error({ err: error }, "[MiniApp] Cards error");
        res.status(500).json({ error: "Internal server error" });
    }
});

// ── POST /kyc ──────────────────────────────────────────────

miniappRouter.post("/kyc", async (req, res) => {
    try {
        const { initData, email, phone } = req.body;
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Unauthorized" }); return; }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!email || !emailRegex.test(email)) {
            res.status(400).json({ error: "Please enter a valid email address." }); return;
        }

        // Validate phone format (must start with + and have 7-15 digits)
        const phoneClean = phone?.replace(/[\s\-()]/g, '') || '';
        if (!phoneClean || !/^\+\d{7,15}$/.test(phoneClean)) {
            res.status(400).json({ error: "Please enter a valid phone number starting with +." }); return;
        }

        const walletData = await resolveWalletData(user.id);
        if (!walletData) { res.status(403).json({ error: "No wallet found" }); return; }

        await query(
            `UPDATE owner_telegram_links SET email = $1, phone = $2 WHERE telegram_user_id = $3`,
            [email.trim(), phoneClean, user.id]
        );

        res.json({ success: true, profile: { email: email.trim(), phone: phoneClean } });
    } catch (error) {
        appLogger.error({ err: error }, "[MiniApp] KYC error");
        res.status(500).json({ error: "Internal server error" });
    }
});

// ── POST /order-card ───────────────────────────────────────

const VALID_TIERS = ['virtual', 'stellar', 'locked'];
// Unlock codes loaded from env — no hardcoded secrets in source
const VALID_UNLOCK_CODES: string[] = (process.env.MINIAPP_UNLOCK_CODES || '')
    .split(',')
    .map(c => c.trim().toUpperCase())
    .filter(Boolean);
const TIER_PRICES: Record<string, number> = { virtual: 10, stellar: 50, locked: 500 };
const TIER_NAMES: Record<string, string> = { virtual: 'Virtual Card', stellar: 'Stellar Platinum', locked: 'Locked Card (Special)' };

miniappRouter.post("/order-card", async (req, res) => {
    try {
        const { initData, tier, unlockCode } = req.body;
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Unauthorized" }); return; }

        if (!VALID_TIERS.includes(tier)) {
            res.status(400).json({ error: "Invalid card tier" }); return;
        }

        if (tier === 'locked') {
            if (!unlockCode || !VALID_UNLOCK_CODES.includes(unlockCode.toUpperCase())) {
                res.status(403).json({ error: "Invalid unlock code" }); return;
            }
        }

        const walletData = await resolveWalletData(user.id);
        if (!walletData) { res.status(403).json({ error: "No wallet found" }); return; }

        const amount = TIER_PRICES[tier];
        const intentId = `pi_${Date.now()}_${user.id}`;

        // Try CryptoBot invoice if token is configured
        if (env.CRYPTO_BOT_TOKEN) {
            const cryptoBot = new CryptoBotClient();
            const invoice = await cryptoBot.createInvoice({
                amount,
                asset: "USDT",
                description: `ASG Card — ${TIER_NAMES[tier]}`,
                payload: JSON.stringify({ intentId, tier, userId: user.id }),
                paid_btn_name: "callback",
                paid_btn_url: "https://t.me/asgcardbot",
            });

            // Store payment intent in DB
            await query(
                `INSERT INTO payment_intents (id, telegram_user_id, tier, amount_usd, crypto_bot_invoice_id, invoice_url)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [intentId, user.id, tier, amount, String(invoice.invoice_id), invoice.mini_app_invoice_url || invoice.bot_invoice_url]
            );

            await AuditService.log({
                actorType: "telegram_user", actorId: String(user.id),
                action: "card_payment_initiated", resourceId: intentId, decision: "allow",
            });

            res.json({
                success: true,
                invoiceUrl: invoice.mini_app_invoice_url || invoice.bot_invoice_url,
                intentId,
            });
        } else {
            // No payment processor configured — reject instead of faking success
            appLogger.error('[MiniApp] CRYPTO_BOT_TOKEN not configured — cannot process card orders');
            res.status(503).json({
                error: "Payment processing unavailable",
                message: "Card ordering is temporarily unavailable. Please try again later.",
                retryAfter: 300,
            });
        }
    } catch (error) {
        appLogger.error({ err: error }, "[MiniApp] Order card error");
        res.status(500).json({ error: "Internal server error" });
    }
});

// ── POST /reveal ───────────────────────────────────────────

miniappRouter.post("/reveal", async (req, res) => {
    try {
        const { initData, cardId } = req.body;
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Unauthorized" }); return; }

        const walletData = await resolveWalletData(user.id);
        if (!walletData) { res.status(403).json({ error: "No linked wallet" }); return; }
        const wallet = walletData.wallet;

        const result = await cardService.getCardDetails(wallet, cardId);

        await AuditService.log({
            actorType: "telegram_user", actorId: String(user.id),
            action: "miniapp_card_reveal", resourceId: cardId, decision: "allow",
        });

        res.json({ details: result.details });
    } catch (error: any) {
        appLogger.error({ err: error }, "[MiniApp] Reveal error");
        res.status(error.status || 500).json({ error: error.message || "Internal server error" });
    }
});

// ── POST /card-status ──────────────────────────────────────

miniappRouter.post("/card-status", async (req, res) => {
    try {
        const { initData, cardId, status } = req.body;
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Unauthorized" }); return; }

        if (status !== 'active' && status !== 'frozen') {
            res.status(400).json({ error: "Status must be 'active' or 'frozen'" }); return;
        }

        const walletData = await resolveWalletData(user.id);
        if (!walletData) { res.status(403).json({ error: "No linked wallet" }); return; }
        const wallet = walletData.wallet;

        const result = await cardService.setCardStatus(wallet, cardId, status);
        res.json(result);
    } catch (error: any) {
        appLogger.error({ err: error }, "[MiniApp] Card-status error");
        res.status(error.status || 500).json({ error: error.message || "Internal server error" });
    }
});

// ── GET /fund-tiers ────────────────────────────────────────

miniappRouter.get("/fund-tiers", async (_req, res) => {
    res.json({ tiers: FUNDING_TIERS });
});

// ── GET /payment-status/:intentId ─────────────────────────

miniappRouter.get("/payment-status/:intentId", async (req, res) => {
    try {
        const initData = (req.query.initData as string) || '';
        const user = extractUser(initData);
        if (!user?.id) { res.status(401).json({ error: "Unauthorized" }); return; }

        const rows = await query<{ status: string, tier: string, paid_at: string | null }>(
            `SELECT status, tier, paid_at FROM payment_intents WHERE id = $1 AND telegram_user_id = $2 LIMIT 1`,
            [req.params.intentId, user.id]
        );

        if (rows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
        res.json({ status: rows[0].status, tier: rows[0].tier, paidAt: rows[0].paid_at });
    } catch (error) {
        appLogger.error({ err: error }, "[MiniApp] Payment status error");
        res.status(500).json({ error: "Internal server error" });
    }
});
