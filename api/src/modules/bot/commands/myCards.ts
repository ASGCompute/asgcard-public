/**
 * My Cards command handler — read-only card list + card actions.
 *
 * Uses existing cardService API to read cards.
 * All actions verified via requireOwnerBinding + audit log.
 *
 * @module modules/bot/commands/myCards
 */

import type { TelegramClient } from "../telegramClient";
import { requireOwnerBinding } from "../../authz/ownerPolicy";
import { AuditService } from "../../authz/auditService";
import { cardService, HttpError } from "../../../services/cardService";
import {
    noBindingMessage,
    cardFrozenMessage,
    cardUnfrozenMessage,
} from "../templates";
import {
    cardActionsKeyboard,
    persistentMenu,
} from "../keyboards";

// ── Constants ──────────────────────────────────────────────
const CARDS_PER_PAGE = 3;

// ── My Cards ───────────────────────────────────────────────

export async function handleMyCardsCommand(
    client: TelegramClient,
    chatId: number,
    userId: number,
    page: number = 1,
    editMessageId?: number
): Promise<void> {
    // 1. Verify binding
    const owner = await requireOwnerBinding(userId, "my_cards");
    if (!owner) {
        await client.sendMessage({
            chat_id: chatId,
            text: noBindingMessage(),
            parse_mode: "HTML",
            reply_markup: persistentMenu(),
        });
        return;
    }

    // 2. Fetch all cards from cardService
    const allCards = await cardService.listCards(owner.ownerWallet);

    if (allCards.length === 0) {
        const text =
            `<b>💳 My Cards</b>\n\n` +
            `You don't have any cards yet.\n` +
            `Create one at <a href="https://asgcard.dev">asgcard.dev</a> or via the API.`;
        if (editMessageId) {
            await client.editMessageText({ chat_id: chatId, message_id: editMessageId, text, parse_mode: "HTML" });
        } else {
            await client.sendMessage({ chat_id: chatId, text, parse_mode: "HTML" });
        }
        return;
    }

    // 3. Pagination
    const totalPages = Math.ceil(allCards.length / CARDS_PER_PAGE);
    const safePage = Math.max(1, Math.min(page, totalPages));
    const start = (safePage - 1) * CARDS_PER_PAGE;
    const pageCards = allCards.slice(start, start + CARDS_PER_PAGE);

    // 4. Total balance (across ALL cards)
    const totalBalance = allCards.reduce((sum, c) => sum + c.balance, 0);

    // 5. Build single combined message with header + all cards for this page
    let text = `💳 <b>Account Balance</b> (USD): <b>$${totalBalance.toFixed(2)}</b>\n`;
    if (totalPages > 1) {
        text += `<i>Page ${safePage}/${totalPages} · ${allCards.length} cards</i>\n`;
    }
    text += `\n`;

    for (const card of pageCards) {
        const statusIcon = card.status === "frozen" ? "❄️" : "💳";
        text += `${statusIcon} <b>ASG Virtual Card</b> · xxxx <code>${card.lastFour}</code>\n`;
        text += `   Balance: <b>$${card.balance.toFixed(2)}</b> · ${card.status === "frozen" ? "❄️ Frozen" : "✅ Active"}\n\n`;
    }

    // 6. Build inline keyboard: card action buttons + navigation
    const keyboard: { text: string; callback_data: string }[][] = [];

    for (const card of pageCards) {
        const row: { text: string; callback_data: string }[] = [];
        if (card.status === "active") {
            row.push({ text: "❄️ Freeze", callback_data: `card_freeze:${card.cardId}` });
        } else {
            row.push({ text: "🔓 Unfreeze", callback_data: `card_unfreeze:${card.cardId}` });
        }
        row.push({ text: "👁 Reveal", callback_data: `card_reveal:${card.cardId}` });
        row.push({ text: "📊 Statement", callback_data: `card_statement:${card.cardId}` });
        keyboard.push(row);
    }

    // Navigation row
    if (totalPages > 1) {
        const navRow: { text: string; callback_data: string }[] = [];
        if (safePage > 1) {
            navRow.push({ text: "◀️ Prev", callback_data: `cards_page:${safePage - 1}` });
        }
        navRow.push({ text: `${safePage}/${totalPages}`, callback_data: "noop" });
        if (safePage < totalPages) {
            navRow.push({ text: "▶️ Next", callback_data: `cards_page:${safePage + 1}` });
        }
        keyboard.push(navRow);
    }

    const reply_markup = { inline_keyboard: keyboard };

    // 7. Edit existing message or send new one
    if (editMessageId) {
        await client.editMessageText({
            chat_id: chatId,
            message_id: editMessageId,
            text,
            parse_mode: "HTML",
            reply_markup,
        });
    } else {
        await client.sendMessage({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
            reply_markup,
        });
    }
}

// ── Card Callback Router ───────────────────────────────────

export async function handleCardCallback(
    client: TelegramClient,
    chatId: number,
    userId: number,
    data: string
): Promise<void> {
    const parts = data.split(":");
    const action = parts[0];
    const cardId = parts[1];
    if (!cardId) return;

    // Verify binding for every action
    const owner = await requireOwnerBinding(userId, action);
    if (!owner) {
        await client.sendMessage({
            chat_id: chatId,
            text: noBindingMessage(),
            parse_mode: "HTML",
        });
        return;
    }

    switch (action) {
        case "card_select":
            await handleCardSelect(client, chatId, owner.ownerWallet, cardId);
            break;
        case "card_freeze":
            await handleCardFreeze(client, chatId, owner.ownerWallet, cardId);
            break;
        case "card_unfreeze":
            await handleCardUnfreeze(client, chatId, owner.ownerWallet, cardId);
            break;
        case "card_reveal":
            await handleCardReveal(client, chatId, owner.ownerWallet, userId, cardId);
            break;
        case "card_statement":
            await handleCardStatement(client, chatId, owner.ownerWallet, cardId);
            break;
        case "card_statement_page": {
            const page = parseInt(parts[2] ?? "1", 10);
            await handleCardStatement(client, chatId, owner.ownerWallet, cardId, page);
            break;
        }
        case "confirm": {
            const confirmAction = parts[2];
            if (confirmAction === "freeze") {
                await handleCardFreeze(client, chatId, owner.ownerWallet, cardId);
            } else if (confirmAction === "unfreeze") {
                await handleCardUnfreeze(client, chatId, owner.ownerWallet, cardId);
            }
            break;
        }
        case "cancel":
            await client.sendMessage({
                chat_id: chatId,
                text: "❌ Action cancelled.",
            });
            break;
    }
}

// ── Card Select (show actions) ─────────────────────────────

async function handleCardSelect(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    cardId: string
): Promise<void> {
    try {
        const result = await cardService.getCard(wallet, cardId);
        const last4 = result.card.lastFour;

        await client.sendMessage({
            chat_id: chatId,
            text: `💳 ASG Virtual Card - xxxx ${last4}`,
            reply_markup: cardActionsKeyboard(cardId, result.card.status),
        });
    } catch (error) {
        await sendCardError(client, chatId, error);
    }
}

// ── Freeze ─────────────────────────────────────────────────

async function handleCardFreeze(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    cardId: string
): Promise<void> {
    try {
        await cardService.setCardStatus(wallet, cardId, "frozen");

        const result = await cardService.getCard(wallet, cardId);
        const last4 = result.card.lastFour;

        await AuditService.log({
            actorType: "telegram_user",
            actorId: wallet,
            action: "card_frozen",
            resourceId: cardId,
            decision: "allow",
        });

        await client.sendMessage({
            chat_id: chatId,
            text: cardFrozenMessage(last4),
            parse_mode: "HTML",
            reply_markup: cardActionsKeyboard(cardId, "frozen"),
        });
    } catch (error) {
        await sendCardError(client, chatId, error);
    }
}

// ── Unfreeze ───────────────────────────────────────────────

async function handleCardUnfreeze(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    cardId: string
): Promise<void> {
    try {
        await cardService.setCardStatus(wallet, cardId, "active");

        const result = await cardService.getCard(wallet, cardId);
        const last4 = result.card.lastFour;

        await AuditService.log({
            actorType: "telegram_user",
            actorId: wallet,
            action: "card_unfrozen",
            resourceId: cardId,
            decision: "allow",
        });

        await client.sendMessage({
            chat_id: chatId,
            text: cardUnfrozenMessage(last4),
            parse_mode: "HTML",
            reply_markup: cardActionsKeyboard(cardId, "active"),
        });
    } catch (error) {
        await sendCardError(client, chatId, error);
    }
}

// ── Reveal (secure auto-deleting message with PCI data) ──

async function handleCardReveal(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    userId: number,
    cardId: string
): Promise<void> {
    try {
        // Verify card belongs to wallet
        const result = await cardService.getCard(wallet, cardId);
        const fpId = result.card.fourPaymentsId;

        if (!fpId) {
            await client.sendMessage({
                chat_id: chatId,
                text: "⚠️ Card details unavailable — no payment provider link.",
                parse_mode: "HTML",
            });
            return;
        }

        // Fetch sensitive data from 4Payments
        const { getFourPaymentsClient } = await import("../../../services/fourPaymentsClient");
        const fpClient = getFourPaymentsClient();
        const sensitive = await fpClient.getSensitiveInfo(fpId);

        await AuditService.log({
            actorType: "telegram_user",
            actorId: String(userId),
            action: "card_reveal_viewed",
            resourceId: cardId,
            decision: "allow",
        });

        // Format card number with spaces
        const formatted = sensitive.number.replace(/(.{4})/g, "$1 ").trim();

        const text =
            `🔐 <b>Card Details</b> (auto-deletes in 30s)\n\n` +
            `💳 <code>${formatted}</code>\n` +
            `📅 Exp: <code>${sensitive.expire}</code>\n` +
            `🔑 CVV: <code>${sensitive.cvc}</code>\n\n` +
            `<i>⚠️ This message will be deleted automatically.</i>`;

        const msgId = await client.sendMessage({
            chat_id: chatId,
            text,
            parse_mode: "HTML",
        });

        // Auto-delete after 30 seconds for security
        if (msgId) {
            setTimeout(() => {
                client.deleteMessage(chatId, msgId).catch(() => {});
            }, 30_000);
        }
    } catch (error) {
        await sendCardError(client, chatId, error);
    }
}

// ── Statement ──────────────────────────────────────────────

async function handleCardStatement(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    cardId: string,
    page = 1
): Promise<void> {
    try {
        // Verify ownership
        const result = await cardService.getCard(wallet, cardId);
        const last4 = result.card.lastFour;

        // Fetch real statement data
        const { StatementService } = await import("../services/statementService");
        const statement = await StatementService.getStatement(wallet, cardId, page);
        const message = StatementService.formatStatementMessage(last4, statement);

        // Build pagination keyboard if needed
        const keyboard = statement.hasMore
            ? {
                inline_keyboard: [
                    [
                        {
                            text: `📄 Page ${page + 1} →`,
                            callback_data: `card_statement_page:${cardId}:${page + 1}`,
                        },
                    ],
                ],
            }
            : undefined;

        await client.sendMessage({
            chat_id: chatId,
            text: message,
            parse_mode: "HTML",
            reply_markup: keyboard,
        });
    } catch (error) {
        await sendCardError(client, chatId, error);
    }
}

// ── Error helper ───────────────────────────────────────────

import { escapeHtml } from "../../../utils/html";

async function sendCardError(
    client: TelegramClient,
    chatId: number,
    error: unknown
): Promise<void> {
    const message =
        error instanceof HttpError
            ? `⚠️ ${escapeHtml(error.message)}`
            : "⚠️ Something went wrong. Please try again.";

    await client.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
    });
}
