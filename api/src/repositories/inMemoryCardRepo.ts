import crypto from "node:crypto";
import type { StoredCard, CardDetails } from "../types/domain";
import type { CardRepository, CreateCardInput } from "./types";

export class InMemoryCardRepository implements CardRepository {
    private cards = new Map<string, StoredCard>();

    async create(input: CreateCardInput): Promise<StoredCard> {
        const card: StoredCard = {
            cardId: `card_${crypto.randomUUID().slice(0, 8)}`,
            walletAddress: input.walletAddress,
            nameOnCard: input.nameOnCard,
            email: input.email,
            balance: input.initialAmountUsd,
            initialAmountUsd: input.initialAmountUsd,
            status: "active",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            details: input.details
        };

        this.cards.set(card.cardId, card);
        return card;
    }

    async findById(cardId: string): Promise<StoredCard | undefined> {
        return this.cards.get(cardId);
    }

    async findByWallet(walletAddress: string): Promise<StoredCard[]> {
        return Array.from(this.cards.values()).filter(
            (c) => c.walletAddress === walletAddress
        );
    }

    async updateStatus(cardId: string, status: "active" | "frozen"): Promise<boolean> {
        const card = this.cards.get(cardId);
        if (!card) return false;
        card.status = status;
        card.updatedAt = new Date().toISOString();
        return true;
    }

    async addBalance(cardId: string, amount: number): Promise<boolean> {
        const card = this.cards.get(cardId);
        if (!card) return false;
        card.balance += amount;
        card.updatedAt = new Date().toISOString();
        return true;
    }
}
