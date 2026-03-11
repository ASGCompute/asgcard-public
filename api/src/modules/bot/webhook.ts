import { appLogger } from "../../utils/logger";
/**
 * Bot Webhook — Telegram update handler.
 *
 * POST /bot/telegram/webhook
 *
 * Verifies X-Telegram-Bot-Api-Secret-Token, parses update,
 * routes to command handlers. Fail-closed on invalid signatures.
 *
 * @module modules/bot/webhook
 */

import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env";
import { TelegramClient } from "./telegramClient";
import type { TgUpdate, TgMessage, TgCallbackQuery } from "./telegramClient";
import { handleStartCommand } from "./commands/start";
import { handleMyCardsCommand, handleCardCallback } from "./commands/myCards";
import { handleFaqCommand } from "./commands/faq";
import { handleSupportCommand } from "./commands/support";
import { AuditService } from "../authz/auditService";

// ── Router ─────────────────────────────────────────────────

export const botRouter = Router();

/** Lazily initialized Telegram client (only when bot is enabled). */
let tgClient: TelegramClient | null = null;

export function getTelegramClient(): TelegramClient {
    if (!tgClient) {
        if (!env.TG_BOT_TOKEN) {
            throw new Error("TG_BOT_TOKEN is required when TG_BOT_ENABLED=true");
        }
        tgClient = new TelegramClient(env.TG_BOT_TOKEN);
    }
    return tgClient;
}

// ── Webhook endpoint ───────────────────────────────────────

botRouter.post("/telegram/webhook", async (req, res) => {
    // 1. Verify Telegram secret token (fail-closed)
    if (env.TG_WEBHOOK_SECRET) {
        const headerToken = req.header("X-Telegram-Bot-Api-Secret-Token");
        if (!headerToken || !safeEqual(headerToken, env.TG_WEBHOOK_SECRET)) {
            await AuditService.log({
                actorType: "system",
                actorId: "telegram_webhook",
                action: "webhook_signature_invalid",
                decision: "deny",
                ipAddress: req.ip,
            });
            res.status(401).json({ error: "Invalid webhook secret" });
            return;
        }
    }

    // 2. Parse update
    const update = req.body as TgUpdate;

    if (!update || !update.update_id) {
        res.status(400).json({ error: "Invalid update" });
        return;
    }

    // 3. Process update BEFORE responding (Vercel kills function after res.send)
    try {
        const client = getTelegramClient();

        if (update.message) {
            await handleMessage(client, update.message);
        } else if (update.callback_query) {
            await handleCallback(client, update.callback_query);
        }
    } catch (error) {
        appLogger.error({ err: error }, "[BOT] Update handling error");
    }

    // 4. Respond 200 after processing (Telegram retries on non-200)
    res.status(200).json({ ok: true });
});

// ── Setup command (one-time, called manually or on deploy) ──

botRouter.post("/telegram/setup", async (req, res) => {
    // Protected: require same auth as ops
    const opsKey = env.OPS_API_KEY;
    if (opsKey && req.header("X-Ops-Key") !== opsKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    try {
        const client = getTelegramClient();

        // Set persistent menu commands
        await client.setMyCommands([
            { command: "start", description: "Start / Link account" },
            { command: "mycards", description: "💳 My Cards" },
            { command: "faq", description: "❓ FAQ's" },
            { command: "support", description: "🧑‍💻 Support" },
        ]);

        // Register webhook
        const webhookUrl = "https://api.asgcard.dev/bot/telegram/webhook";
        await client.setWebhook(webhookUrl, env.TG_WEBHOOK_SECRET);

        res.json({
            status: "ok",
            webhook: webhookUrl,
            commands: ["start", "mycards", "faq", "support"],
        });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ── Ops Metrics endpoint ───────────────────────────────────

botRouter.get("/ops/metrics", async (req, res) => {
    const opsKey = env.OPS_API_KEY;
    if (opsKey && req.header("X-Ops-Key") !== opsKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    try {
        const { MetricsService } = await import("./services/metricsService");
        const hours = parseInt(req.query.hours as string || "24", 10);
        const metrics = await MetricsService.collect(hours);
        res.json(metrics);
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ── Message Router ─────────────────────────────────────────

async function handleMessage(client: TelegramClient, msg: TgMessage): Promise<void> {
    if (!msg.text || !msg.from) return;

    const text = msg.text.trim();
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // /start with optional deep-link token
    if (text.startsWith("/start")) {
        const parts = text.split(" ");
        const token = parts.length > 1 ? parts[1] : undefined;
        await handleStartCommand(client, chatId, userId, token);
        return;
    }

    // Slash commands
    if (text === "/mycards" || text === "💳 My Cards") {
        await handleMyCardsCommand(client, chatId, userId);
        return;
    }

    if (text === "/faq" || text === "❓ FAQ's") {
        await handleFaqCommand(client, chatId);
        return;
    }

    if (text === "/support" || text.startsWith("🧑‍💻") || text === "Support") {
        await handleSupportCommand(client, chatId);
        return;
    }

    // Unknown — ignore silently (don't spam user)
}

// ── Callback Router ────────────────────────────────────────

async function handleCallback(client: TelegramClient, cbq: TgCallbackQuery): Promise<void> {
    if (!cbq.data || !cbq.from) return;

    // Acknowledge immediately
    await client.answerCallbackQuery({ callback_query_id: cbq.id });

    const chatId = cbq.message?.chat.id;
    if (!chatId) return;

    await handleCardCallback(client, chatId, cbq.from.id, cbq.data);
}

// ── Helpers ────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
