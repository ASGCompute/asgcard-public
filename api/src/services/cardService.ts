import type { CardDetails, TierAmount } from "../types/domain";
import type { CardRepository } from "../repositories/types";
import { cardRepository } from "../repositories/runtime";

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
  private readonly repo: CardRepository;

  constructor(repo: CardRepository = cardRepository) {
    this.repo = repo;
  }

  async createCard(input: {
    walletAddress: string;
    nameOnCard: string;
    email: string;
    initialAmountUsd: number;
    tierAmount: TierAmount;
    chargedUsd: number;
    txHash: string;
  }) {
    const card = await this.repo.create({
      walletAddress: input.walletAddress,
      nameOnCard: input.nameOnCard,
      email: input.email,
      initialAmountUsd: input.initialAmountUsd,
      tierAmount: input.tierAmount,
      txHash: input.txHash,
      details: createMockCardDetails()
    });

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
        network: "stellar"
      },
      details: card.details
    };
  }

  async fundCard(input: {
    walletAddress: string;
    cardId: string;
    fundAmountUsd: number;
    chargedUsd: number;
    txHash: string;
  }) {
    const card = await this.repo.findById(input.cardId);
    if (!card || card.walletAddress !== input.walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    const updated = await this.repo.addBalance(card.cardId, input.fundAmountUsd);
    if (!updated) {
      throw new HttpError(500, "Unable to update card balance");
    }

    const refreshed = await this.repo.findById(card.cardId);
    if (!refreshed) {
      throw new HttpError(500, "Card not found after balance update");
    }

    return {
      success: true,
      cardId: card.cardId,
      fundedAmount: input.fundAmountUsd,
      newBalance: refreshed.balance,
      payment: {
        amountCharged: input.chargedUsd,
        txHash: input.txHash,
        network: "stellar"
      }
    };
  }

  async listCards(walletAddress: string) {
    const cards = await this.repo.findByWallet(walletAddress);
    return cards
      .map((card) => ({
        cardId: card.cardId,
        nameOnCard: card.nameOnCard,
        lastFour: card.details.cardNumber.slice(-4),
        balance: card.balance,
        status: card.status,
        createdAt: card.createdAt
      }));
  }

  async getCard(walletAddress: string, cardId: string) {
    const card = await this.repo.findById(cardId);
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

  async getCardDetails(walletAddress: string, cardId: string) {
    const card = await this.repo.findById(cardId);
    if (!card || card.walletAddress !== walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    // REALIGN-005: Owner can revoke agent access to details
    if ((card as any).detailsRevoked) {
      throw new HttpError(403, "Card details access revoked by owner");
    }

    return {
      details: card.details
    };
  }

  async setCardStatus(walletAddress: string, cardId: string, status: "active" | "frozen") {
    const card = await this.repo.findById(cardId);
    if (!card || card.walletAddress !== walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    const updated = await this.repo.updateStatus(cardId, status);
    if (!updated) {
      throw new HttpError(500, "Unable to update card status");
    }

    return {
      success: true,
      cardId: card.cardId,
      status
    };
  }

  // REALIGN-005: Owner revoke/restore agent access to card details
  async setDetailsRevoked(walletAddress: string, cardId: string, revoked: boolean) {
    const card = await this.repo.findById(cardId);
    if (!card || card.walletAddress !== walletAddress) {
      throw new HttpError(404, "Card not found");
    }

    const updated = await this.repo.setDetailsRevoked(cardId, revoked);
    if (!updated) {
      throw new HttpError(500, "Unable to update card details access");
    }

    return {
      success: true,
      cardId: card.cardId,
      detailsRevoked: revoked
    };
  }
}

export const cardService = new CardService();
export { HttpError };
