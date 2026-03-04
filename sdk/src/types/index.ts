export interface StellarKeypair {
  publicKey(): string;
  sign(data: Buffer): Buffer;
}

export interface ASGCardClientConfig {
  /** Stellar secret key (S...) */
  secretKey?: string;
  /** Base URL for the ASG Card API */
  baseUrl?: string;
  /** Stellar Horizon URL */
  horizonUrl?: string;
  /** Request timeout in ms */
  timeout?: number;
}

export interface CreateCardParams {
  amount: 10 | 25 | 50 | 100 | 200 | 500;
  nameOnCard: string;
  email: string;
}

export interface FundCardParams {
  amount: 10 | 25 | 50 | 100 | 200 | 500;
  cardId: string;
}

export interface TierEntry {
  loadAmount?: number;
  fundAmount?: number;
  totalCost: number;
  endpoint: string;
  breakdown?: Record<string, number>;
}

export interface TierResponse {
  creation: TierEntry[];
  funding: TierEntry[];
}

export interface CardResult {
  success: boolean;
  card: {
    cardId: string;
    nameOnCard: string;
    balance: number;
    status: string;
    createdAt: string;
  };
  payment: {
    amountCharged: number;
    txHash: string;
    network: string;
  };
  details: {
    cardNumber: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
    billingAddress: {
      street: string;
      city: string;
      state: string;
      zip: string;
      country: string;
    };
  };
}

export interface FundResult {
  success: boolean;
  cardId: string;
  fundedAmount: number;
  newBalance: number;
  payment: {
    amountCharged: number;
    txHash: string;
    network: string;
  };
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

/** x402 v2 accept entry (Stellar) */
export interface X402Accept {
  scheme: "exact";
  network: "stellar:pubnet";
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
}

/** x402 v2 challenge (Stellar) */
export interface X402Challenge {
  x402Version: 2;
  accepts: X402Accept[];
}

/** x402 v2 payment payload (Stellar) */
export interface PaymentPayload {
  scheme: "exact";
  network: "stellar:pubnet";
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
    };
    signature: string;
  };
}
