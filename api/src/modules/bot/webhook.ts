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
import { handleFundCommand, handleFundCallback } from "./commands/fund";
import { AuditService } from "../authz/auditService";
import { AdminBot } from "../admin/adminBot";

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

// ── Rate Limiter (per-instance, fits serverless warm instances) ──
// Note: On Vercel serverless each cold start resets state.
// For cross-instance rate limiting, use Redis/KV in a future phase.
const rateLimitMap = new Map<number, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 actions per minute per user
const RATE_LIMIT_MAX_ENTRIES = 10_000; // safety cap
let lastCleanup = Date.now();

function checkRateLimit(userId: number): boolean {
    const now = Date.now();

    // Periodic cleanup: purge expired entries every 5 min (or if Map is too big)
    if (now - lastCleanup > 5 * 60_000 || rateLimitMap.size > RATE_LIMIT_MAX_ENTRIES) {
        for (const [key, val] of rateLimitMap) {
            if (now > val.resetAt) rateLimitMap.delete(key);
        }
        lastCleanup = now;
    }

    const entry = rateLimitMap.get(userId);
    if (!entry || now > entry.resetAt) {
        rateLimitMap.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
        return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) return false;
    return true;
}

/** Strip @botusername from commands (P2 #11) */
function normalizeCommand(text: string): string {
    return text.replace(/@\S+/, "").trim();
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
            const userId = update.message.from?.id;
            if (userId && !checkRateLimit(userId)) {
                AdminBot.rateLimited(userId).catch(() => {});
                res.status(200).json({ ok: true });
                return;
            }
            await handleMessage(client, update.message);
        } else if (update.callback_query) {
            const userId = update.callback_query.from?.id;
            if (userId && !checkRateLimit(userId)) {
                await client.answerCallbackQuery({
                    callback_query_id: update.callback_query.id,
                    text: "Too many requests. Please wait a moment.",
                    show_alert: true,
                });
                res.status(200).json({ ok: true });
                return;
            }
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
    // Protected: require ops key (P3 #14: fail-closed)
    const opsKey = env.OPS_API_KEY;
    if (!opsKey || req.header("X-Ops-Key") !== opsKey) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    try {
        const client = getTelegramClient();

        // Set persistent menu commands
        await client.setMyCommands([
            { command: "start", description: "Start / Link account" },
            { command: "mycards", description: "💳 My Cards" },
            { command: "fund", description: "💰 Fund a Card" },
            { command: "faq", description: "❓ FAQ's" },
            { command: "support", description: "🧑‍💻 Support" },
        ]);

        // Register webhook
        const webhookUrl = "https://api.asgcard.dev/bot/telegram/webhook";
        await client.setWebhook(webhookUrl, env.TG_WEBHOOK_SECRET);

        res.json({
            status: "ok",
            webhook: webhookUrl,
            commands: ["start", "mycards", "fund", "faq", "support"],
        });
    } catch (error) {
        res.status(500).json({ error: (error as Error).message });
    }
});

// ── Ops Metrics endpoint ───────────────────────────────────

botRouter.get("/ops/metrics", async (req, res) => {
    const opsKey = env.OPS_API_KEY;
    if (!opsKey || req.header("X-Ops-Key") !== opsKey) {
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
    const cmd = normalizeCommand(text);
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Track command in admin bot (non-blocking)
    if (text.startsWith("/")) {
        AdminBot.botCommand(userId, text, msg.from.username).catch(() => {});
    }

    // /start with optional deep-link token
    if (cmd.startsWith("/start")) {
        const parts = text.split(" ");
        const token = parts.length > 1 ? parts[1] : undefined;
        await handleStartCommand(client, chatId, userId, token);
        return;
    }

    // Slash commands
    if (cmd === "/mycards" || text === "💳 My Cards") {
        await handleMyCardsCommand(client, chatId, userId);
        return;
    }

    if (cmd === "/fund" || text === "💰 Fund") {
        await handleFundCommand(client, chatId, userId);
        return;
    }

    if (cmd === "/faq" || text === "❓ FAQ's") {
        await handleFaqCommand(client, chatId);
        return;
    }

    if (cmd === "/support" || text.startsWith("🧑‍💻") || text === "Support") {
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

    // Route fund callbacks
    if (cbq.data.startsWith("fund_select:") || cbq.data.startsWith("fund_info:")) {
        await handleFundCallback(client, chatId, cbq.from.id, cbq.data);
        return;
    }

    await handleCardCallback(client, chatId, cbq.from.id, cbq.data);
}

// ── Helpers ────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
}
