export interface PaymentContext {
  payer: string;
  txHash: string;
  atomicAmount: string;
  amount: number;
  totalCostUsd: number;
  paymentRail?: "stellar_x402" | "stripe_mpp";
}

export interface WalletContext {
  address: string;
  timestamp: number;
}

export interface StripeSessionContext {
  sessionId: string;
  ownerId: string;
  email: string;
  managedWalletAddress: string;
}
