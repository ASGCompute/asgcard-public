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
    accountBalanceMessage,
    noBindingMessage,
    cardFrozenMessage,
    cardUnfrozenMessage,
    cardRevealLinkMessage,
} from "../templates";
import {
    cardActionsKeyboard,
    persistentMenu,
} from "../keyboards";

// ── My Cards ───────────────────────────────────────────────

export async function handleMyCardsCommand(
    client: TelegramClient,
    chatId: number,
    userId: number
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

    // 2. Fetch cards from existing cardService
    // listCards returns: { cardId, nameOnCard, lastFour, balance, status, createdAt }[]
    const cards = await cardService.listCards(owner.ownerWallet);

    // 3. Calculate total balance
    const totalBalance = cards.reduce((sum, c) => sum + c.balance, 0);

    // 4. Build card summaries for template
    const summaries = cards.map((c) => ({
        cardId: c.cardId,
        nameOnCard: c.nameOnCard,
        last4: c.lastFour,
        balance: c.balance,
        status: c.status as "active" | "frozen",
    }));

    // 5. Send account balance header
    await client.sendMessage({
        chat_id: chatId,
        text: accountBalanceMessage(totalBalance, summaries),
        parse_mode: "HTML",
    });

    // 6. Send each card with action buttons
    if (summaries.length > 0) {
        for (const card of summaries) {
            const statusIcon = card.status === "frozen" ? "❄️" : "💳";
            await client.sendMessage({
                chat_id: chatId,
                text: `${statusIcon} ASG Virtual Card - xxxx ${card.last4}`,
                reply_markup: cardActionsKeyboard(card.cardId, card.status),
            });
        }
    }
}

// ── Card Callback Router ───────────────────────────────────

export async function handleCardCallback(
    client: TelegramClient,
    chatId: number,
    userId: number,
    data: string
): Promise<void> {
    const [action, cardId] = data.split(":");
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
        // getCard returns { card: { cardId, nameOnCard, ... status } }
        const result = await cardService.getCard(wallet, cardId);
        // Get last4 from listCards
        const cards = await cardService.listCards(wallet);
        const matched = cards.find((c) => c.cardId === cardId);
        const last4 = matched?.lastFour ?? "????";

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

        const cards = await cardService.listCards(wallet);
        const matched = cards.find((c) => c.cardId === cardId);
        const last4 = matched?.lastFour ?? "????";

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

        const cards = await cardService.listCards(wallet);
        const matched = cards.find((c) => c.cardId === cardId);
        const last4 = matched?.lastFour ?? "????";

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

// ── Reveal (secure one-time link, PAN/CVV never in Telegram) ──

async function handleCardReveal(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    userId: number,
    cardId: string
): Promise<void> {
    try {
        // Verify card belongs to wallet (throws 404 if not)
        await cardService.getCard(wallet, cardId);

        // Generate one-time reveal token
        const crypto = await import("node:crypto");
        const revealToken = crypto.randomBytes(32).toString("base64url");

        // TODO: store revealToken with TTL 60s in DB for secure reveal page
        const revealUrl = `https://asgcard.dev/reveal?token=${revealToken}&card=${cardId}`;

        await AuditService.log({
            actorType: "telegram_user",
            actorId: String(userId),
            action: "card_reveal_requested",
            resourceId: cardId,
            decision: "allow",
        });

        await client.sendMessage({
            chat_id: chatId,
            text: cardRevealLinkMessage(revealUrl),
            parse_mode: "HTML",
            disable_web_page_preview: true,
        });
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
        await cardService.getCard(wallet, cardId);

        const cards = await cardService.listCards(wallet);
        const matched = cards.find((c) => c.cardId === cardId);
        const last4 = matched?.lastFour ?? "????";

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

async function sendCardError(
    client: TelegramClient,
    chatId: number,
    error: unknown
): Promise<void> {
    const message =
        error instanceof HttpError
            ? `⚠️ ${error.message}`
            : "⚠️ Something went wrong. Please try again.";

    await client.sendMessage({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
    });
}
