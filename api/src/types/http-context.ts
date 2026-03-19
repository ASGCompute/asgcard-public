export interface PaymentContext {
  payer: string;
  txHash: string;
  atomicAmount: string;
  amount: number;
  totalCostUsd: number;
}

export interface WalletContext {
  address: string;
  timestamp: number;
}
