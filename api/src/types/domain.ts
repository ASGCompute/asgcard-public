export interface CardBillingAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface CardDetails {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  maskedCardNumber?: string;
  billingAddress: CardBillingAddress;
}

export interface StoredCard {
  cardId: string;
  walletAddress: string;
  nameOnCard: string;
  email: string;
  balance: number;
  initialAmountUsd: number;
  status: "active" | "frozen";
  createdAt: string;
  updatedAt: string;
  details: CardDetails;
  fourPaymentsId?: string;
  paymentRail?: "stellar_x402" | "stripe_mpp";
  paymentReference?: string;
  issuerProvider?: string;
}
