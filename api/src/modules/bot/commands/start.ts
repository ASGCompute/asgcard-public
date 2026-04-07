/**
 * /start command handler.
 *
 * Handles:
 * 1. /start lnk_<token> → consume token, create binding, trigger sponsorship
 * 2. /start (no token) → welcome message with link instructions
 *
 * @module modules/bot/commands/start
 */

import type { TelegramClient } from "../telegramClient";
import { LinkService } from "../../portal/linkService";
import { AdminBot } from "../../admin/adminBot";
import { SponsorshipService } from "../../../services/sponsorship";
import { env } from "../../../config/env";
import { appLogger } from "../../../utils/logger";
import {
    welcomeMessage,
    linkSuccessMessage,
    linkFailedMessage,
} from "../templates";
import { persistentMenu } from "../keyboards";

export async function handleStartCommand(
    client: TelegramClient,
    chatId: number,
    userId: number,
    token?: string,
    username?: string
): Promise<void> {
    // Deep-link: /start lnk_<token>
    if (token && token.startsWith("lnk_")) {
        const result = await LinkService.consumeToken(token, userId, chatId);

        if (result.success && result.ownerWallet) {
            const walletShort =
                result.ownerWallet.substring(0, 6) +
                "..." +
                result.ownerWallet.substring(result.ownerWallet.length - 4);

            await client.sendMessage({
                chat_id: chatId,
                text: linkSuccessMessage(walletShort),
                parse_mode: "HTML",
                reply_markup: persistentMenu(),
            });

            // Notify admin bot
            AdminBot.accountLinked({
                wallet: result.ownerWallet,
                telegramUserId: userId,
                username,
            }).catch(() => {});

            // ── Async sponsorship trigger (fail-open) ──────────
            // After successful identity binding, try to build a sponsored
            // account activation XDR. If treasury is not configured or
            // Horizon is down, identity binding still works. The user can
            // retry sponsorship later via the CLI or MCP tools.
            if (env.ONBOARDING_ENABLED === "true" && env.STELLAR_TREASURY_SECRET) {
                (async () => {
                    try {
                        const ipAllowed = await SponsorshipService.checkIpRateLimit("telegram_bot");
                        const budgetOk = await SponsorshipService.checkDailyBudget();

                        if (ipAllowed && budgetOk) {
                            const sponsorResult = await SponsorshipService.buildSponsoredXdr(
                                result.ownerWallet!,
                                "telegram_bot"
                            );
                            appLogger.info(
                                { wallet: result.ownerWallet, success: sponsorResult.success },
                                "[BOT/START] Async sponsorship triggered"
                            );
                        } else {
                            appLogger.warn(
                                { wallet: result.ownerWallet, ipAllowed, budgetOk },
                                "[BOT/START] Sponsorship skipped (rate/budget limit)"
                            );
                        }
                    } catch (err) {
                        // Fail-open: never let sponsorship failure affect identity binding
                        appLogger.error(
                            { err, wallet: result.ownerWallet },
                            "[BOT/START] Async sponsorship failed (non-blocking)"
                        );
                    }
                })();
            }
        } else {
            await client.sendMessage({
                chat_id: chatId,
                text: linkFailedMessage(result.error ?? "unknown"),
                parse_mode: "HTML",
                reply_markup: persistentMenu(),
            });
        }
        return;
    }

    // Plain /start — welcome
    await client.sendMessage({
        chat_id: chatId,
        text: welcomeMessage(),
        parse_mode: "HTML",
        reply_markup: persistentMenu(),
    });
}

