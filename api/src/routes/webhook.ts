import { appLogger } from "../utils/logger";
import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../config/env";
import { webhookEventRepository } from "../repositories/runtime";
import { emitMetric } from "../services/metrics";
import { AlertService } from "../modules/bot/services/alertService";
import { getTelegramClient } from "../modules/bot/webhook";
import { AdminBot } from "../modules/admin/adminBot";

// ── Types ──────────────────────────────────────────────────

export interface WebhookEvent {
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    timestamp: string;
}

// ── HMAC Verification (safe length check) ──────────────────

const safeTimingSafeEqual = (a: string, b: string): boolean => {
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");

    if (bufA.length !== bufB.length) {
        return false;
    }

    return crypto.timingSafeEqual(bufA, bufB);
};

const verifyHmac = (rawBody: Buffer, signatureHeader: string): boolean => {
    // Try current secret first
    const expected = crypto
        .createHmac("sha256", env.WEBHOOK_SECRET)
        .update(rawBody)
        .digest("hex");

    if (safeTimingSafeEqual(expected, signatureHeader)) {
        return true;
    }

    // Try previous secret for rotation support
    if (env.WEBHOOK_SECRET_PREVIOUS) {
        const expectedPrevious = crypto
            .createHmac("sha256", env.WEBHOOK_SECRET_PREVIOUS)
            .update(rawBody)
            .digest("hex");

        return safeTimingSafeEqual(expectedPrevious, signatureHeader);
    }

    return false;
};

// ── Router ─────────────────────────────────────────────────

export const webhookRouter = Router();

// Raw body parser for HMAC — must be applied BEFORE json parser
webhookRouter.post(
    "/4payments",
    async (req, res) => {
        // 4payments canonical header: "webhook-sign"
        // Also accept "X-Webhook-Signature" for compatibility
        const signatureHeader =
            req.header("webhook-sign") ?? req.header("X-Webhook-Signature");

        if (!signatureHeader) {
            res.status(401).json({
                error: "Missing webhook signature header (expected: webhook-sign)"
            });
            return;
        }

        // Raw body is attached by express.raw() middleware in app.ts
        const rawBody = (req as unknown as { body: Buffer }).body;

        if (!Buffer.isBuffer(rawBody)) {
            res.status(400).json({ error: "Expected raw body for HMAC verification" });
            return;
        }

        if (!verifyHmac(rawBody, signatureHeader)) {
            emitMetric({ eventType: "webhook_sig_failure", source: "4payments" });
            AdminBot.webhookSigFailure(req.ip ?? "unknown").catch(() => {});
            res.status(401).json({ error: "Invalid webhook signature" });
            return;
        }

        // Parse the verified body
        let event: WebhookEvent;
        try {
            const parsed = JSON.parse(rawBody.toString("utf-8"));
            event = {
                type: parsed.type ?? "unknown",
                idempotencyKey: parsed.idempotency_key ?? parsed.id ?? crypto.randomUUID(),
                payload: parsed,
                timestamp: parsed.timestamp ?? new Date().toISOString()
            };
        } catch {
            res.status(400).json({ error: "Invalid JSON body" });
            return;
        }

        // Atomic idempotency — NO pre-check, INSERT ON CONFLICT handles dupes
        const { inserted } = await webhookEventRepository.store({
            idempotencyKey: event.idempotencyKey,
            eventType: event.type,
            payload: event.payload
        });

        if (!inserted) {
            // Duplicate — already processed, return 200 to prevent retries
            emitMetric({ eventType: "webhook_duplicate", source: "4payments" });
            AdminBot.webhookDuplicate(event.type, event.idempotencyKey).catch(() => {});
            res.status(200).json({ status: "already_processed" });
            return;
        }
        // Route card events to Telegram alerts (when enabled)
        if (env.BOT_ALERTS_ENABLED === "true" && env.TG_BOT_ENABLED === "true") {
            try {
                const tgClient = getTelegramClient();
                await AlertService.deliverAlert(
                    {
                        type: event.type,
                        fourPaymentsId: event.payload.card_id as string,
                        externalCardId: event.payload.external_card_id as string,
                        amount: event.payload.amount as number,
                        merchant: (event.payload.merchant ?? event.payload.merchant_name) as string,
                        balance: event.payload.balance as number,
                        reason: event.payload.reason as string,
                        txnId: event.idempotencyKey,
                        last4: event.payload.card_last4 as string,
                        payload: event.payload,
                    },
                    async (chatId: number, text: string) => {
                        await tgClient.sendMessage({ chat_id: chatId, text });
                    }
                );
            } catch (alertErr) {
                appLogger.error({ err: alertErr }, "[Webhook] Alert delivery error (non-fatal)");
            }
        }

        appLogger.info(`[Webhook] Received ${event.type} (key=${event.idempotencyKey})`);
        AdminBot.webhookReceived(event).catch(() => {});
        emitMetric({ eventType: "webhook_accepted", source: "4payments" });
        res.status(200).json({ status: "accepted", type: event.type });
    }
);
