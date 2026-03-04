/**
 * Statement Service — queries real transaction history from bot_events + webhook_events.
 *
 * Supports pagination, status mapping: pending/declined/settled/reversed.
 *
 * @module modules/bot/services/statementService
 */

import { query } from "../../../db/db";

// ── Types ──────────────────────────────────────────────────

export type TransactionStatus = "pending" | "declined" | "settled" | "reversed";

export interface StatementEntry {
    txnId: string;
    date: string;
    type: string;
    merchant: string;
    amount: number;
    status: TransactionStatus;
    last4: string;
}

export interface StatementPage {
    items: StatementEntry[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}

// ── Event-Type → Status Mapping ────────────────────────────

const EVENT_STATUS_MAP: Record<string, TransactionStatus> = {
    "card.transaction": "settled",
    "card.charge": "settled",
    "card.authorization": "pending",
    "card.authorized": "pending",
    "card.decline": "declined",
    "card.refund": "reversed",
    "card.reversal": "reversed",
    "card.load": "settled",
    "card.funded": "settled",
};

function mapEventStatus(eventType: string): TransactionStatus {
    return EVENT_STATUS_MAP[eventType] ?? "pending";
}

// ── Service ────────────────────────────────────────────────

export class StatementService {
    /**
     * Retrieve statement for a specific card, with pagination.
     * Pulls from bot_events table (which tracks all card events).
     */
    static async getStatement(
        walletAddress: string,
        cardId: string,
        page = 1,
        pageSize = 10
    ): Promise<StatementPage> {
        const offset = (page - 1) * pageSize;

        // Count total events for this card
        const countResult = await query<{ count: string }>(
            `SELECT COUNT(*) as count
       FROM bot_events be
       WHERE be.idempotency_key LIKE $1
         AND be.delivery_status != 'skipped'`,
            [`%:${cardId}:%`]
        );

        const total = parseInt(countResult[0]?.count ?? "0", 10);

        // Fetch paginated events
        const events = await query<{
            idempotency_key: string;
            event_type: string;
            payload_hash: string;
            created_at: string;
        }>(
            `SELECT idempotency_key, event_type, payload_hash, created_at
       FROM bot_events
       WHERE idempotency_key LIKE $1
         AND delivery_status != 'skipped'
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
            [`%:${cardId}:%`, pageSize, offset]
        );

        // Try to pull merchant/amount from bot_messages correlation
        const items: StatementEntry[] = [];

        for (const evt of events) {
            // Parse idempotency key: "eventType:cardId:txnId"
            const parts = evt.idempotency_key.split(":");
            const txnId = parts[2] ?? evt.payload_hash.substring(0, 12);

            // Try to pull amount from the original event payload via webhook_events
            const webhookData = await query<{
                merchant: string;
                amount: number;
                card_last4: string;
            }>(
                `SELECT
           COALESCE(
             payload->>'merchant',
             payload->>'merchant_name',
             'Unknown'
           ) as merchant,
           COALESCE(
             (payload->>'amount')::numeric,
             (payload->>'transaction_amount')::numeric,
             0
           ) as amount,
           COALESCE(
             payload->>'card_last4',
             RIGHT(payload->>'card_number', 4),
             '????'
           ) as card_last4
         FROM webhook_events
         WHERE event_type = $1
           AND idempotency_key = $2
         LIMIT 1`,
                [evt.event_type, evt.idempotency_key]
            ).catch(() => [] as { merchant: string; amount: number; card_last4: string }[]);

            const data = webhookData[0];

            items.push({
                txnId,
                date: evt.created_at,
                type: evt.event_type.replace("card.", ""),
                merchant: data?.merchant ?? "Unknown",
                amount: data?.amount ?? 0,
                status: mapEventStatus(evt.event_type),
                last4: data?.card_last4 ?? "????",
            });
        }

        return {
            items,
            total,
            page,
            pageSize,
            hasMore: offset + pageSize < total,
        };
    }

    /**
     * Format statement page as Telegram HTML message.
     */
    static formatStatementMessage(
        last4: string,
        statement: StatementPage
    ): string {
        if (statement.items.length === 0) {
            return (
                `📊 <b>Statement</b> — Card xxxx ${last4}\n\n` +
                `No transactions found.\n\n` +
                `<i>Page ${statement.page} of ${Math.max(1, Math.ceil(statement.total / statement.pageSize))}</i>`
            );
        }

        const statusIcon: Record<TransactionStatus, string> = {
            settled: "✅",
            pending: "⏳",
            declined: "❌",
            reversed: "↩️",
        };

        const lines = statement.items.map((item) => {
            const icon = statusIcon[item.status] ?? "❔";
            const date = new Date(item.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
            });
            const sign = ["reversed", "declined"].includes(item.status) ? "" : "-";
            return `${icon} ${date} │ ${sign}$${item.amount.toFixed(2)} │ ${item.merchant}\n   <i>${item.status}</i> • <code>${item.txnId.substring(0, 10)}</code>`;
        });

        const totalPages = Math.max(1, Math.ceil(statement.total / statement.pageSize));

        return (
            `📊 <b>Statement</b> — Card xxxx ${last4}\n\n` +
            lines.join("\n\n") +
            `\n\n<i>Page ${statement.page}/${totalPages} (${statement.total} total)</i>`
        );
    }
}
