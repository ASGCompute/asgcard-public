/**
 * Stripe MPP Beta — Feature-flag guard middleware.
 *
 * Checks:
 * 1. STRIPE_MPP_BETA_ENABLED === "true"
 * 2. If STRIPE_BETA_ALLOWLIST is set, wallet must be in allowlist
 */
import type { RequestHandler } from "express";
import { env } from "../config/env";
import { appLogger } from "../utils/logger";

export const requireStripeBeta: RequestHandler = (req, res, next) => {
  // Kill switch
  if (env.STRIPE_MPP_BETA_ENABLED !== "true") {
    appLogger.warn("[STRIPE-BETA] Beta route hit but STRIPE_MPP_BETA_ENABLED is off");
    res.status(503).json({
      error: "Stripe MPP beta is not currently available",
      retryAfter: 3600,
    });
    return;
  }

  // Allowlist gate (requires wallet auth to have run first)
  const allowlist = env.STRIPE_BETA_ALLOWLIST;
  if (allowlist && req.walletContext) {
    const allowed = allowlist
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);

    if (allowed.length > 0 && !allowed.includes(req.walletContext.address)) {
      appLogger.info(
        { wallet: req.walletContext.address },
        "[STRIPE-BETA] Wallet not in beta allowlist"
      );
      res.status(403).json({
        error: "Your wallet is not currently enrolled in the Stripe beta",
      });
      return;
    }
  }

  next();
};
