/**
 * Stripe MPP Payment Middleware
 *
 * Mirrors x402.ts pattern for Stripe Machine Payments Protocol:
 *   - No X-PAYMENT header → 402 with stripe_mpp challenge
 *   - Has X-PAYMENT header → validate SPT, create PaymentIntent, attach paymentContext
 *
 * Usage: requireStripeMPPPayment("create") or requireStripeMPPPayment("fund")
 */
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import {
  calcCreationCost,
  calcFundingCost,
  isValidAmount,
} from "../config/pricing";
import {
  parseSPTCredential,
  createPaymentIntentFromSPT,
} from "../services/stripeService";
import { appLogger } from "../utils/logger";

type StripePurpose = "create" | "fund";

/**
 * Build a 402 challenge for Stripe MPP.
 * Returns payment requirements with scheme="stripe_mpp".
 */
const buildStripeChallenge = (
  req: Request,
  amount: number,
  totalCostUsd: number,
  purpose: StripePurpose
) => ({
  x402Version: 2,
  resource: {
    url: `https://${req.get("host")}${req.originalUrl}`,
    description:
      purpose === "create"
        ? `Create ASG Card with $${amount} load via Stripe`
        : `Fund ASG Card with $${amount} via Stripe`,
    mimeType: "application/json",
  },
  accepts: [
    {
      scheme: "stripe_mpp",
      amount: Math.round(totalCostUsd * 100).toString(), // cents
      currency: "usd",
      maxTimeoutSeconds: 300,
      extra: {
        description: `ASG Card ${purpose}: $${amount} load`,
        paymentRail: "stripe_mpp",
      },
    },
  ],
});

export const requireStripeMPPPayment = (purpose: StripePurpose) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // ── Extract amount from body or params ──
    const amount =
      typeof req.body?.amount === "number"
        ? req.body.amount
        : Number(req.params.amount);

    if (!isValidAmount(amount)) {
      res
        .status(400)
        .json({ error: "Invalid amount. Must be between $5 and $5,000." });
      return;
    }

    const totalCostUsd =
      purpose === "create"
        ? calcCreationCost(amount)
        : calcFundingCost(amount);
    const totalCostCents = Math.round(totalCostUsd * 100);

    // ── Check for X-PAYMENT header ──
    const paymentHeader =
      req.header("X-PAYMENT") ?? req.header("X-Payment");

    if (!paymentHeader) {
      // No credential — return 402 challenge
      appLogger.info(
        { purpose, amount, totalCostUsd },
        "[STRIPE-MPP] Returning 402 challenge"
      );
      res.status(402).json(buildStripeChallenge(req, amount, totalCostUsd, purpose));
      return;
    }

    // ── Parse SPT credential ──
    const spt = parseSPTCredential(paymentHeader);

    if (!spt) {
      res.status(401).json({
        error: "Invalid X-PAYMENT header: expected Stripe MPP credential",
      });
      return;
    }

    // ── Create PaymentIntent from SPT ──
    appLogger.info(
      { purpose, amount, tokenPrefix: spt.token.substring(0, 8) },
      "[STRIPE-MPP] Processing SPT credential"
    );

    const result = await createPaymentIntentFromSPT(
      spt,
      totalCostCents,
      `ASG Card ${purpose}: $${amount} load`
    );

    if (!result.success) {
      appLogger.warn(
        { error: result.error, piId: result.paymentIntentId },
        "[STRIPE-MPP] Payment failed"
      );
      res.status(402).json({
        error: result.error ?? "Stripe payment failed",
        paymentIntentId: result.paymentIntentId || undefined,
      });
      return;
    }

    // ── Success: attach payment context ──
    appLogger.info(
      { piId: result.paymentIntentId, amount, purpose },
      "[STRIPE-MPP] Payment verified"
    );

    req.paymentContext = {
      payer: req.walletContext?.address ?? "",
      txHash: result.paymentIntentId,
      atomicAmount: totalCostCents.toString(),
      amount,
      totalCostUsd,
      paymentRail: "stripe_mpp",
    };

    next();
  };
};
