import type { PublicKey, Transaction } from "@solana/web3.js";

export interface WalletAdapter {
  publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

export interface ASGCardClientConfig {
  privateKey?: string;
  walletAdapter?: WalletAdapter;
  baseUrl?: string;
  rpcUrl?: string;
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

export interface X402Accept {
  scheme: "exact";
  network: string;
  asset: string;
  maxAmountRequired: string;
  payTo: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
}

export interface X402Challenge {
  x402Version: 1;
  accepts: X402Accept[];
}

export interface X402PaymentProof {
  scheme: "exact";
  network: string;
  payload: {
    authorization: {
      from: string;
      to: string;
      value: string;
    };
    txHash: string;
  };
}
