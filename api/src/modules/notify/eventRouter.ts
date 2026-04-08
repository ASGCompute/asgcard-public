/**
 * Event Router — hooks into webhook processing to dispatch notifications.
 *
 * Called after webhook events are accepted and stored.
 *
 * @module modules/notify/eventRouter
 */

import { NotifyService, type CardEvent } from "./notifyService";
import { query } from "../../db/db";

/**
 * Process a webhook event for potential Telegram notification.
 * Called from the main webhook handler after the event is stored.
 */
export async function routeCardEvent(
    eventType: string,
    payload: Record<string, unknown>
): Promise<void> {
    // Extract card/wallet info from webhook payload
    const cardId = (payload.card_id ?? payload.cardId ?? "") as string;
    if (!cardId) return;

    // Look up wallet from card — try our card_id first, then four_payments_id
    let cards = await query<{ wallet_address: string; last_four: string | null }>(
        `SELECT wallet_address, last_four
     FROM cards WHERE card_id = $1 LIMIT 1`,
        [cardId]
    );

    // Fallback: webhook payload card_id is often the 4payments provider ID
    if (cards.length === 0) {
        cards = await query<{ wallet_address: string; last_four: string | null }>(
            `SELECT wallet_address, last_four
         FROM cards WHERE four_payments_id = $1 LIMIT 1`,
            [cardId]
        );
    }

    if (cards.length === 0) return;

    const card = cards[0];

    const event: CardEvent = {
        eventType,
        cardId,
        walletAddress: card.wallet_address,
        payload: {
            last4: card.last_four ?? "????",
            amount: payload.amount as number | undefined,
            merchant: payload.merchant as string | undefined,
            balance: payload.available_balance as number | undefined,
            txnId: payload.transaction_id as string | undefined,
            reason: payload.decline_reason as string | undefined,
            newBalance: payload.new_balance as number | undefined,
        },
    };

    await NotifyService.processEvent(event);
}

// Re-export for convenience
export { NotifyService };
