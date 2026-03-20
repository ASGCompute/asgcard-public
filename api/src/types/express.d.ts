import type { PaymentContext, WalletContext, StripeSessionContext } from "./http-context";

declare global {
  namespace Express {
    interface Request {
      paymentContext?: PaymentContext;
      walletContext?: WalletContext;
      stripeSession?: StripeSessionContext;
    }
  }
}

export {};
