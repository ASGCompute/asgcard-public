import crypto from "node:crypto";
import { query } from "../db/db";
import type { StoredCard, CardDetails } from "../types/domain";
import type { CardRepository, CreateCardInput } from "./types";
import { encryptCardDetails, decryptCardDetails, parseEncryptionKey } from "../utils/crypto";

/**
 * Postgres-backed card repository.
 * Card details are encrypted at rest with AES-256-GCM.
 * NUMERIC columns are explicitly cast to number via parseFloat.
 */
export class PostgresCardRepository implements CardRepository {
    private readonly encKey: Buffer;

    constructor() {
        const keyEnv = process.env.CARD_DETAILS_KEY;
        if (!keyEnv) {
            throw new Error("CARD_DETAILS_KEY is required when REPO_MODE=postgres");
        }
        this.encKey = parseEncryptionKey(keyEnv);
    }

    async create(input: CreateCardInput): Promise<StoredCard> {
        const cardId = `card_${crypto.randomUUID().slice(0, 8)}`;
        const detailsEncrypted = encryptCardDetails(input.details, this.encKey);

        const rows = await query<{
            card_id: string;
            wallet_address: string;
            name_on_card: string;
            email: string;
            balance: string;
            initial_amount: string;
            status: string;
            details_encrypted: Buffer;
            created_at: Date;
            updated_at: Date;
        }>(
            `INSERT INTO cards
               (card_id, wallet_address, name_on_card, email, balance, initial_amount, status, details_encrypted)
             VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
             RETURNING card_id, wallet_address, name_on_card, email,
                       balance, initial_amount, status, details_encrypted,
                       created_at, updated_at`,
            [
                cardId,
                input.walletAddress,
                input.nameOnCard,
                input.email,
                input.initialAmountUsd,
                input.initialAmountUsd,
                detailsEncrypted
            ]
        );

        return this.rowToStoredCard(rows[0]);
    }

    async findById(cardId: string): Promise<StoredCard | undefined> {
        const rows = await query<{
            card_id: string;
            wallet_address: string;
            name_on_card: string;
            email: string;
            balance: string;
            initial_amount: string;
            status: string;
            details_encrypted: Buffer;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT card_id, wallet_address, name_on_card, email,
                    balance, initial_amount, status, details_encrypted,
                    created_at, updated_at
             FROM cards
             WHERE card_id = $1`,
            [cardId]
        );

        return rows.length > 0 ? this.rowToStoredCard(rows[0]) : undefined;
    }

    async findByWallet(walletAddress: string): Promise<StoredCard[]> {
        const rows = await query<{
            card_id: string;
            wallet_address: string;
            name_on_card: string;
            email: string;
            balance: string;
            initial_amount: string;
            status: string;
            details_encrypted: Buffer;
            created_at: Date;
            updated_at: Date;
        }>(
            `SELECT card_id, wallet_address, name_on_card, email,
                    balance, initial_amount, status, details_encrypted,
                    created_at, updated_at
             FROM cards
             WHERE wallet_address = $1
             ORDER BY created_at DESC`,
            [walletAddress]
        );

        return rows.map((r) => this.rowToStoredCard(r));
    }

    async updateStatus(
        cardId: string,
        status: "active" | "frozen"
    ): Promise<boolean> {
        const rows = await query(
            `UPDATE cards SET status = $2 WHERE card_id = $1 RETURNING card_id`,
            [cardId, status]
        );
        return rows.length > 0;
    }

    async addBalance(cardId: string, amount: number): Promise<boolean> {
        const rows = await query(
            `UPDATE cards SET balance = balance + $2 WHERE card_id = $1 RETURNING card_id`,
            [cardId, amount]
        );
        return rows.length > 0;
    }

    // ── Row mapping ─────────────────────────────────────────

    private rowToStoredCard(row: {
        card_id: string;
        wallet_address: string;
        name_on_card: string;
        email: string;
        balance: string;
        initial_amount: string;
        status: string;
        details_encrypted: Buffer;
        created_at: Date;
        updated_at: Date;
    }): StoredCard {
        return {
            cardId: row.card_id,
            walletAddress: row.wallet_address,
            nameOnCard: row.name_on_card,
            email: row.email,
            balance: parseFloat(row.balance),             // NUMERIC → number
            initialAmountUsd: parseFloat(row.initial_amount), // NUMERIC → number
            status: row.status as "active" | "frozen",
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
            details: decryptCardDetails(row.details_encrypted, this.encKey)
        };
    }
}
