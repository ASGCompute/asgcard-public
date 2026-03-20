/**
 * Stripe MPP Payment Middleware — Docs-Aligned
 *
 * Simplified 402 challenge + X-STRIPE-SPT credential flow.
 *
 * - No X-STRIPE-SPT header → 402 with payment requirements
 * - Has X-STRIPE-SPT: spt_xxx → create PaymentIntent via SPT → attach paymentContext
 *
 * No custom protocol layer. No base64 credential parsing.
 */
import type { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import {
  calcCreationCost,
  calcFundingCost,
  isValidAmount,
} from "../config/pricing";
import { createPaymentIntentWithSPT } from "../services/stripeService";
import { appLogger } from "../utils/logger";

type StripePurpose = "create" | "fund";

export const requireStripeMPPPayment = (purpose: StripePurpose) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    // ── Extract amount from body ──
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

    // ── Check for X-STRIPE-SPT header ──
    const sptId = req.header("X-STRIPE-SPT");

    if (!sptId) {
      // No SPT — return 402 with payment requirements
      appLogger.info(
        { purpose, amount, totalCostCents },
        "[STRIPE-MPP] Returning 402 payment required"
      );
      res.status(402).json({
        status: 402,
        paymentRequired: {
          amount: totalCostCents,
          currency: "usd",
          description: purpose === "create"
            ? `Create ASG Card with $${amount} load`
            : `Fund ASG Card with $${amount}`,
          stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "",
        },
      });
      return;
    }

    // ── Validate SPT ID format ──
    if (!sptId.startsWith("spt_") || sptId.length < 10) {
      res.status(400).json({
        error: "Invalid X-STRIPE-SPT header: expected Stripe SPT ID (spt_xxx)",
      });
      return;
    }

    // ── Create PaymentIntent with SPT (docs-aligned) ──
    appLogger.info(
      { purpose, amount, sptPrefix: sptId.substring(0, 12) },
      "[STRIPE-MPP] Processing SPT"
    );

    const result = await createPaymentIntentWithSPT(
      sptId,
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
