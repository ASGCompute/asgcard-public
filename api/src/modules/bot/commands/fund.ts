/**
 * Fund command handler — shows fund options and deep-links to SDK/API.
 *
 * Since funding requires x402 payment (on-chain USDC), the bot
 * provides card selection + funding info with deep-link to the API.
 *
 * @module modules/bot/commands/fund
 */

import type { TelegramClient } from "../telegramClient";
import { requireOwnerBinding } from "../../authz/ownerPolicy";
import { cardService, HttpError } from "../../../services/cardService";
import { persistentMenu } from "../keyboards";
import { TOPUP_RATE, calcFundingCost, MIN_AMOUNT, MAX_AMOUNT } from "../../../config/pricing";

// ── Fund Command ───────────────────────────────────────────

export async function handleFundCommand(
    client: TelegramClient,
    chatId: number,
    userId: number
): Promise<void> {
    // Verify binding
    const owner = await requireOwnerBinding(userId, "fund_cards");

    if (!owner) {
        await client.sendMessage({
            chat_id: chatId,
            text: "🔐 You need to link your wallet first.\nUse the portal at https://asgcard.dev to connect your Telegram.",
            reply_markup: persistentMenu(),
        });
        return;
    }

    try {
        const cards = await cardService.listCards(owner.ownerWallet);

        if (cards.length === 0) {
            await client.sendMessage({
                chat_id: chatId,
                text: "📭 You don't have any cards yet.\n\nCreate one using the SDK:\n<code>client.createCard({ amount: 50, nameOnCard: 'AI', email: 'a@b.com', phone: '+1234567890' })</code>",
                parse_mode: "HTML",
                reply_markup: persistentMenu(),
            });
            return;
        }

        // Build card selection keyboard for funding
        const buttons = cards
            .filter((c) => c.status === "active")
            .map((c) => [
                {
                    text: `💳 xxxx ${c.lastFour} — $${c.balance.toFixed(2)}`,
                    callback_data: `fund_select:${c.cardId}`,
                },
            ]);

        if (buttons.length === 0) {
            await client.sendMessage({
                chat_id: chatId,
                text: "❄️ All your cards are frozen. Unfreeze a card first to fund it.",
                reply_markup: persistentMenu(),
            });
            return;
        }

        await client.sendMessage({
            chat_id: chatId,
            text: "<b>💰 Fund a Card</b>\n\nSelect a card to see funding options:",
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: buttons },
        });
    } catch (error) {
        const msg =
            error instanceof HttpError
                ? `⚠️ ${error.message}`
                : "⚠️ Something went wrong. Please try again.";
        await client.sendMessage({ chat_id: chatId, text: msg });
    }
}

// ── Fund Callbacks ─────────────────────────────────────────

export async function handleFundCallback(
    client: TelegramClient,
    chatId: number,
    userId: number,
    data: string
): Promise<void> {
    const parts = data.split(":");
    const action = parts[0];
    const cardId = parts[1];
    if (!cardId) return;

    const owner = await requireOwnerBinding(userId, "fund_card_action");
    if (!owner) {
        await client.sendMessage({
            chat_id: chatId,
            text: "🔐 Session expired. Please /start again.",
        });
        return;
    }

    if (action === "fund_select") {
        await showFundInfo(client, chatId, owner.ownerWallet, cardId);
    } else if (action === "fund_info") {
        const amount = Number(parts[2]);
        await showFundDetails(client, chatId, owner.ownerWallet, cardId, amount);
    }
}

// ── Fund Details (amount selected) ─────────────────────────

async function showFundDetails(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    cardId: string,
    amount: number
): Promise<void> {
    try {
        if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
            await client.sendMessage({
                chat_id: chatId,
                text: `⚠️ Amount must be between $${MIN_AMOUNT} and $${MAX_AMOUNT}.`,
            });
            return;
        }

        const result = await cardService.getCard(wallet, cardId);
        const last4 = result.card.lastFour;
        const totalCost = calcFundingCost(amount);
        const fee = totalCost - amount;

        await client.sendMessage({
            chat_id: chatId,
            text:
                `<b>💰 Fund Card xxxx ${last4}</b>\n\n` +
                `<b>Load Amount:</b> $${amount.toFixed(2)}\n` +
                `<b>Top-up fee (${(TOPUP_RATE * 100).toFixed(1)}%):</b> $${fee.toFixed(2)}\n` +
                `<b>Total USDC Cost:</b> $${totalCost.toFixed(2)}\n\n` +
                `<i>Payment: USDC on Stellar via x402 protocol</i>\n\n` +
                `To fund this card, use the SDK or API:\n` +
                `<code>POST /cards/fund/tier/${amount}</code>\n` +
                `with the card ID and x402 payment header.\n\n` +
                `📖 <a href="https://docs.asgcard.dev/api/fund">Documentation</a>`,
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "⬅️ Back",
                            callback_data: `fund_select:${cardId}`,
                        },
                    ],
                ],
            },
        });
    } catch (error) {
        const msg =
            error instanceof HttpError
                ? `⚠️ ${error.message}`
                : "⚠️ Something went wrong.";
        await client.sendMessage({ chat_id: chatId, text: msg });
    }
}

// ── Fund Info Display ──────────────────────────────────────

async function showFundInfo(
    client: TelegramClient,
    chatId: number,
    wallet: string,
    cardId: string
): Promise<void> {
    try {
        const result = await cardService.getCard(wallet, cardId);
        const last4 = result.card.lastFour;

        // Show common amounts as quick buttons
        const quickAmounts = [25, 50, 100, 200, 500];
        const amountButtons = quickAmounts.map((amt) => [
            {
                text: `$${amt} (cost: $${calcFundingCost(amt).toFixed(2)})`,
                callback_data: `fund_info:${cardId}:${amt}`,
            },
        ]);

        await client.sendMessage({
            chat_id: chatId,
            text:
                `<b>💰 Fund Card xxxx ${last4}</b>\n` +
                `Current Balance: <b>$${result.card.balance.toFixed(2)}</b>\n\n` +
                `<b>Top-up fee:</b> ${(TOPUP_RATE * 100).toFixed(1)}% • Any amount $${MIN_AMOUNT}–$${MAX_AMOUNT}\n\n` +
                `Select a quick amount or use the SDK with any amount:\n` +
                `<i>Payment is via USDC on Stellar (x402 protocol).</i>`,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: amountButtons },
        });
    } catch (error) {
        const msg =
            error instanceof HttpError
                ? `⚠️ ${error.message}`
                : "⚠️ Something went wrong.";
        await client.sendMessage({ chat_id: chatId, text: msg });
    }
}
