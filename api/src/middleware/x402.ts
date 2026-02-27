import type { RequestHandler } from "express";
import { env } from "../config/env";
import {
  findCreationTier,
  findFundingTier,
  toAtomicUsdc
} from "../config/pricing";
import { parsePaymentHeader } from "../utils/payment";

type PaidPurpose = "create" | "fund";

const getChallengeDescription = (purpose: PaidPurpose, amount: number): string => {
  if (purpose === "create") {
    return `Create ASG Card with $${amount} load`;
  }

  return `Fund ASG Card with $${amount}`;
};

const buildChallenge = (
  reqPath: string,
  amount: number,
  requiredAtomic: string,
  purpose: PaidPurpose
) => ({
  x402Version: 1,
  accepts: [
    {
      scheme: "exact",
      network: env.STELLAR_NETWORK,
      asset: env.STELLAR_USDC_ASSET,
      maxAmountRequired: requiredAtomic,
      payTo: env.STELLAR_TREASURY_ADDRESS,
      maxTimeoutSeconds: 300,
      resource: reqPath,
      description: getChallengeDescription(purpose, amount)
    }
  ]
});

export const requireX402Payment = (purpose: PaidPurpose): RequestHandler => {
  return (req, res, next) => {
    const amount = Number(req.params.amount);
    const tier = purpose === "create" ? findCreationTier(amount) : findFundingTier(amount);

    if (!tier) {
      res.status(400).json({ error: "Unsupported tier amount" });
      return;
    }

    const requiredAtomic = toAtomicUsdc(tier.totalCost);
    const xPaymentHeader = req.header("X-Payment");

    if (!xPaymentHeader) {
      res.status(402).json(buildChallenge(req.originalUrl, amount, requiredAtomic, purpose));
      return;
    }

    const proof = parsePaymentHeader(xPaymentHeader);

    if (!proof) {
      res.status(401).json({ error: "Invalid X-Payment header format" });
      return;
    }

    if (proof.scheme !== "exact" || proof.network !== env.STELLAR_NETWORK) {
      res.status(401).json({ error: "Unsupported payment scheme or network" });
      return;
    }

    if (proof.payload.authorization.to !== env.STELLAR_TREASURY_ADDRESS) {
      res.status(401).json({ error: "Payment recipient mismatch" });
      return;
    }

    if (proof.payload.authorization.value !== requiredAtomic) {
      res.status(401).json({ error: "Payment amount mismatch" });
      return;
    }

    if (!proof.payload.txHash || !proof.payload.authorization.from) {
      res.status(401).json({ error: "Payment proof is missing required fields" });
      return;
    }

    // TODO [PAY-002]: Verify txHash via facilitator or Horizon.
    // For PLAT-001, payment proof is accepted at face value.
    req.paymentContext = {
      payer: proof.payload.authorization.from,
      txHash: proof.payload.txHash,
      atomicAmount: proof.payload.authorization.value,
      tierAmount: amount as 10 | 25 | 50 | 100 | 200 | 500,
      totalCostUsd: tier.totalCost
    };

    next();
  };
};

