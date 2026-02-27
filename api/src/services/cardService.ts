import { randomUUID } from "crypto";
import type { CardDetails, StoredCard } from "../types/domain";

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_BILLING = {
  street: "123 Main St",
  city: "San Francisco",
  state: "CA",
  zip: "94105",
  country: "US"
};

const createMockCardDetails = (): CardDetails => {
  const lastFour = Math.floor(1000 + Math.random() * 9000).toString();
  return {
    cardNumber: `411111111111${lastFour}`,
    expiryMonth: 12,
    expiryYear: 2028,
    cvv: Math.floor(100 + Math.random() * 900).toString(),
    billingAddress: DEFAULT_BILLING
  };
};

class CardService {
  private cards = new Map<string, StoredCard>();

  private detailsReadTimestamps = new Map<string, number[]>();

  createCard(input: {
    walletAddress: string;
    nameOnCard: string;
    email: string;
    initialAmountUsd: number;
    chargedUsd: number;
    txHash: string;
  }) {
    const nowIso = new Date().toISOString();
    const cardId = randomUUID();

    const card: StoredCard = {
      cardId,
      walletAddress: input.walletAddress,
      nameOnCard: input.nameOnCard,
      email: input.email,
      balance: input.initialAmountUsd,
      initialAmountUsd: input.initialAmountUsd,
      status: "active",
      createdAt: nowIso,
      updatedAt: nowIso,
      details: createMockCardDetails()
    };

    this.cards.set(cardId, card);

    return {
      success: true,
      card: {
        cardId: card.cardId,
        nameOnCard: card.nameOnCard,
        balance: card.balance,
        status: card.status,
        createdAt: card.createdAt
      },
      payment: {
        amountCharged: input.chargedUsd,
        txHash: input.txHash,
        network: "solana"
      },
      details: card.details
    };
  }

  fundCard(input: {
    walletAddress: string;
    cardId: string;
    fundAmountUsd: number;
    chargedUsd: number;
    txHash: string;
  }) {
    const card = this.cards.get(input.cardId);
    if (!card || card.walletAddress !== input.walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    card.balance += input.fundAmountUsd;
    card.updatedAt = new Date().toISOString();

    return {
      success: true,
      cardId: card.cardId,
      fundedAmount: input.fundAmountUsd,
      newBalance: card.balance,
      payment: {
        amountCharged: input.chargedUsd,
        txHash: input.txHash,
        network: "solana"
      }
    };
  }

  listCards(walletAddress: string) {
    return Array.from(this.cards.values())
      .filter((card) => card.walletAddress === walletAddress)
      .map((card) => ({
        cardId: card.cardId,
        nameOnCard: card.nameOnCard,
        lastFour: card.details.cardNumber.slice(-4),
        balance: card.balance,
        status: card.status,
        createdAt: card.createdAt
      }));
  }

  getCard(walletAddress: string, cardId: string) {
    const card = this.cards.get(cardId);
    if (!card || card.walletAddress !== walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    return {
      card: {
        cardId: card.cardId,
        nameOnCard: card.nameOnCard,
        email: card.email,
        balance: card.balance,
        initialAmountUsd: card.initialAmountUsd,
        status: card.status,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt
      }
    };
  }

  getCardDetails(walletAddress: string, cardId: string) {
    const card = this.cards.get(cardId);
    if (!card || card.walletAddress !== walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const readWindowStart = nowSec - 3600;
    const existingReads = this.detailsReadTimestamps.get(cardId) ?? [];
    const recentReads = existingReads.filter((stamp) => stamp >= readWindowStart);

    if (recentReads.length >= 3) {
      throw new HttpError(429, "Card details rate limit exceeded (3 requests / hour)");
    }

    recentReads.push(nowSec);
    this.detailsReadTimestamps.set(cardId, recentReads);

    return {
      details: card.details
    };
  }

  setCardStatus(walletAddress: string, cardId: string, status: "active" | "frozen") {
    const card = this.cards.get(cardId);
    if (!card || card.walletAddress !== walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    card.status = status;
    card.updatedAt = new Date().toISOString();

    return {
      success: true,
      cardId: card.cardId,
      status: card.status
    };
  }
}

export const cardService = new CardService();
export { HttpError };
