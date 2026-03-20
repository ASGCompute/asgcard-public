/**
 * Stripe MPP Beta — Route Handler
 *
 * POST /stripe-beta/create
 *   - Wallet auth → beta gate → MPP payment → card creation
 *
 * POST /stripe-beta/create-spt
 *   - SPT provisioning endpoint for the MPP client flow
 *   - Takes { paymentMethod, amount, currency, networkId, expiresAt }
 *   - Returns { spt: "spt_xxx" }
 *
 * Protocol: MPP spec (https://mpp.dev)
 * Headers: Authorization: Payment <credential> (not X-STRIPE-SPT)
 */
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { requireWalletAuth } from "../middleware/walletAuth";
import { requireStripeBeta } from "../middleware/stripeBeta";
import { requireMppxPayment } from "../middleware/mppxPayment";
import { cardService, HttpError } from "../services/cardService";
import { appLogger } from "../utils/logger";

const stripeBetaBodySchema = z.object({
  nameOnCard: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  amount: z.number().min(5).max(5000),
});

const sptProvisionSchema = z.object({
  paymentMethod: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.string().min(3).max(3).default("usd"),
  networkId: z.string().optional(),
  expiresAt: z.number().int().optional(),
});

export const stripeBetaRouter = Router();

/**
 * GET /stripe-beta/config
 *
 * Public config endpoint — provides the Stripe publishable key
 * and beta status. No auth required (frontend needs this before login).
 */
stripeBetaRouter.get("/config", (_req, res) => {
  res.json({
    betaEnabled: env.STRIPE_MPP_BETA_ENABLED === "true",
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "",
  });
});

// Apply auth + beta guard to all mutation routes
stripeBetaRouter.use(requireWalletAuth);
stripeBetaRouter.use(requireStripeBeta);

/**
 * POST /stripe-beta/create-spt
 *
 * SPT provisioning endpoint for MPP client flow.
 * The client's createToken callback calls this to get an SPT
 * (requires secret key, so must be server-side).
 */
stripeBetaRouter.post("/create-spt", async (req, res) => {
  const parsed = sptProvisionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`
      ),
    });
    return;
  }

  const { paymentMethod, amount, currency, expiresAt } = parsed.data;

  try {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) {
      res.status(500).json({ error: "STRIPE_SECRET_KEY not configured" });
      return;
    }

    // Create SPT via Stripe raw API (SDK types don't include SPT yet)
    const body = new URLSearchParams({
      payment_method: paymentMethod,
      "usage_limit[amount]": String(amount),
      "usage_limit[currency]": currency,
    });
    if (expiresAt) {
      body.set("expires_at", String(expiresAt));
    }

    const response = await fetch(
      "https://api.stripe.com/v1/shared_payment_tokens",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      appLogger.error(
        { status: response.status, body: errBody },
        "[MPP] SPT creation failed"
      );
      res.status(502).json({ error: "SPT creation failed" });
      return;
    }

    const result = (await response.json()) as { id: string };
    appLogger.info(
      { sptId: result.id?.substring(0, 12) },
      "[MPP] SPT created"
    );
    res.json({ spt: result.id });
  } catch (err) {
    appLogger.error({ err }, "[MPP] SPT creation failed");
    res.status(502).json({ error: "SPT creation failed" });
  }
});

/**
 * POST /stripe-beta/create
 * Create a card via official MPP flow.
 *
 * Flow:
 *   1. Wallet auth (X-WALLET-ADDRESS, X-WALLET-SIGNATURE, X-WALLET-TIMESTAMP)
 *   2. Beta gate
 *   3. MPP payment: no Authorization → 402 WWW-Authenticate: Payment <challenge>
 *      has Authorization: Payment <credential> → verify → create PI → paymentContext
 *   4. Create card via cardService
 *   5. Return card + receipt
 */
stripeBetaRouter.post(
  "/create",
  requireMppxPayment("create"),
  async (req, res) => {
    if (!req.walletContext) {
      res.status(401).json({ error: "Wallet auth required" });
      return;
    }

    if (!req.paymentContext) {
      res.status(500).json({ error: "Payment context missing after middleware" });
      return;
    }

    const parsed = stripeBetaBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid request body",
        details: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`
        ),
      });
      return;
    }

    const { nameOnCard, email, phone } = parsed.data;
    const { amount, totalCostUsd, txHash } = req.paymentContext;

    appLogger.info(
      {
        wallet: req.walletContext.address,
        amount,
        paymentIntentId: txHash,
        rail: "stripe_mpp",
      },
      "[STRIPE-BETA] Card creation — payment verified via MPP"
    );

    try {
      const result = await cardService.createCard({
        walletAddress: req.walletContext.address,
        nameOnCard,
        email,
        phone,
        initialAmountUsd: amount,
        amount,
        chargedUsd: totalCostUsd,
        txHash,
        paymentRail: "stripe_mpp",
        paymentReference: txHash,
      });

      appLogger.info(
        {
          wallet: req.walletContext.address,
          cardId: result.card.cardId,
          amount,
          rail: "stripe_mpp",
        },
        "[STRIPE-BETA] Card created successfully via MPP"
      );

      const response: Record<string, unknown> = {
        success: result.success,
        card: result.card,
        payment: result.payment,
        beta: true,
        paymentRail: "stripe_mpp",
      };
      if (result.details) {
        response.detailsEnvelope = {
          cardNumber: result.details.cardNumber,
          cvv: result.details.cvv,
          expiryMonth: result.details.expiryMonth,
          expiryYear: result.details.expiryYear,
          billingAddress: result.details.billingAddress,
          oneTimeAccess: true,
          expiresInSeconds: 300,
          note: "Store securely. Use GET /cards/:id/details with X-AGENT-NONCE for subsequent access.",
        };
      }

      res.status(201).json(response);
    } catch (error) {
      if (error instanceof HttpError) {
        appLogger.warn(
          { status: error.status, message: error.message },
          "[STRIPE-BETA] Card creation failed"
        );
        res.status(error.status).json({ error: error.message });
        return;
      }

      appLogger.error(
        { err: error },
        "[STRIPE-BETA] Unexpected error in card creation"
      );
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
