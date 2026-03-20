/**
 * Stripe Session Auth Middleware
 *
 * Validates X-STRIPE-SESSION header for Stripe-edition routes.
 * On success:
 *   - Sets req.stripeSession with session context
 *   - Sets req.walletContext with the managed wallet address (for cardService compat)
 */
import type { RequestHandler } from "express";
import { validateSession } from "../services/sessionService";
import { appLogger } from "../utils/logger";

export const requireStripeSession: RequestHandler = async (req, res, next) => {
  const sessionKey = req.header("X-STRIPE-SESSION");

  if (!sessionKey) {
    res.status(401).json({ error: "Missing X-STRIPE-SESSION header" });
    return;
  }

  if (!sessionKey.startsWith("sk_sess_")) {
    res.status(401).json({ error: "Invalid session key format" });
    return;
  }

  try {
    const ctx = await validateSession(sessionKey);

    if (!ctx) {
      res.status(401).json({ error: "Invalid or revoked session" });
      return;
    }

    req.stripeSession = {
      sessionId: ctx.sessionId,
      ownerId: ctx.ownerId,
      email: ctx.email,
      managedWalletAddress: ctx.managedWalletAddress,
    };

    // Bridge for cardService backward compat
    req.walletContext = {
      address: ctx.managedWalletAddress,
      timestamp: Math.floor(Date.now() / 1000),
    };

    next();
  } catch (err) {
    appLogger.error({ err }, "[STRIPE-SESSION] Validation error");
    res.status(500).json({ error: "Session validation failed" });
  }
};
