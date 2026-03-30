/**
 * /start command handler.
 *
 * Handles:
 * 1. /start lnk_<token> → consume token, create binding
 * 2. /start (no token) → welcome message with link instructions
 *
 * @module modules/bot/commands/start
 */

import type { TelegramClient } from "../telegramClient";
import { LinkService } from "../../portal/linkService";
import { AdminBot } from "../../admin/adminBot";
import {
    linkSuccessMessage,
    linkFailedMessage,
} from "../templates";
import { persistentMenu } from "../keyboards";
import crypto from "node:crypto";
import { env } from "../../../config/env";
import { query } from "../../../db/db";

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

    // Invalid deep-link token (not lnk_ prefixed)
    if (token) {
        await client.sendMessage({
            chat_id: chatId,
            text: linkFailedMessage("invalid_token"),
            parse_mode: "HTML",
            reply_markup: persistentMenu(),
        });
        return;
    }

    // Regular /start — check existing wallet and send welcome
    const rows = await query<{ owner_wallet: string }>(
        `SELECT owner_wallet FROM owner_telegram_links WHERE telegram_user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
    );

    // Store chat_id for later notifications (e.g. payment confirmations)
    if (rows.length > 0) {
        await query(
            `UPDATE owner_telegram_links SET chat_id = $1 WHERE telegram_user_id = $2 AND status = 'active'`,
            [chatId, userId]
        );
    }

    const hasWallet = rows.length > 0;
    const miniappUrl = process.env.VITE_APP_URL ? `${process.env.VITE_APP_URL}/miniapp` : "https://asgcard.dev/miniapp";

    const welcomeText = hasWallet
        ? `<b>Welcome back to ASG Card 🚀</b>\n\nYour wallet is active. Open the app below to manage your cards, fund your account, or issue new cards.`
        : `<b>Welcome to ASG Card 🚀</b>\n\n💳 Virtual debit cards for AI agents & humans\n⚡ Zero gas fees on all transactions\n🌍 Works in 195+ countries\n\nTap below to create your smart wallet and get started.`;

    await client.sendMessage({
        chat_id: chatId,
        text: welcomeText,
        parse_mode: "HTML",
        reply_markup: {
            inline_keyboard: [[{
                text: hasWallet ? "💳 Open ASG Card" : "🚀 Create Smart Wallet",
                web_app: { url: miniappUrl }
            }]],
        },
    });
}
