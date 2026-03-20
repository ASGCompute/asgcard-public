/**
 * Stripe MPP Beta — Route Handler (Managed Identity Edition)
 *
 * POST /stripe-beta/session
 *   - Create beta session (email → managed wallet → session key)
 *
 * GET  /stripe-beta/config
 *   - Public config (Stripe publishable key + beta status)
 *
 * POST /stripe-beta/create-spt
 *   - SPT provisioning (requires session auth)
 *
 * POST /stripe-beta/create
 *   - Card creation via MPP flow (requires session auth + payment)
 *
 * GET  /stripe-beta/cards
 * GET  /stripe-beta/cards/:cardId
 * GET  /stripe-beta/cards/:cardId/details
 * GET  /stripe-beta/cards/:cardId/balance
 * GET  /stripe-beta/cards/:cardId/transactions
 * POST /stripe-beta/cards/:cardId/fund
 * POST /stripe-beta/cards/:cardId/freeze
 * POST /stripe-beta/cards/:cardId/unfreeze
 */
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { requireStripeSession } from "../middleware/stripeSession";
import { requireMppxPayment } from "../middleware/mppxPayment";
import { requireAgentNonce } from "../middleware/agentDetailsMiddleware";
import { cardService, HttpError } from "../services/cardService";
import { createSession } from "../services/sessionService";
import { appLogger } from "../utils/logger";
import type { RequestHandler } from "express";

/** Beta kill-switch — blocks all Stripe routes when beta is off */
const requireStripeBetaEnabled: RequestHandler = (_req, res, next) => {
  if (env.STRIPE_MPP_BETA_ENABLED !== "true") {
    res.status(503).json({
      error: "Stripe MPP beta is not currently available",
      retryAfter: 3600,
    });
    return;
  }
  next();
};

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

const sessionCreateSchema = z.object({
  email: z.string().email(),
});

export const stripeBetaRouter = Router();

// ── Public endpoints (no auth) ────────────────────────────

/**
 * GET /stripe-beta/config
 * Public config — Stripe publishable key + beta status.
 */
stripeBetaRouter.get("/config", (_req, res) => {
  res.json({
    betaEnabled: env.STRIPE_MPP_BETA_ENABLED === "true",
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY || "",
  });
});

/**
 * POST /stripe-beta/session
 * Create a beta session. Returns the raw session key once.
 * Email allowlist gate applied here.
 */
stripeBetaRouter.post("/session", async (req, res) => {
  if (env.STRIPE_MPP_BETA_ENABLED !== "true") {
    res.status(503).json({ error: "Stripe beta is not currently available" });
    return;
  }

  const parsed = sessionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues.map(
        (i) => `${i.path.join(".")}: ${i.message}`
      ),
    });
    return;
  }

  const { email } = parsed.data;

  // Email allowlist gate
  const allowlist = env.STRIPE_BETA_EMAIL_ALLOWLIST;
  if (allowlist) {
    const allowed = allowlist
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) {
      appLogger.info({ email: email.substring(0, 3) + "***" }, "[SESSION] Email not in beta allowlist");
      res.status(403).json({
        error: "This email is not enrolled in the Stripe beta",
      });
      return;
    }
  }

  try {
    const result = await createSession(email);

    appLogger.info(
      { sessionId: result.sessionId, ownerId: result.ownerId },
      "[SESSION] Beta session created"
    );

    res.status(201).json({
      sessionId: result.sessionId,
      ownerId: result.ownerId,
      sessionKey: result.sessionKey,
      managedWalletAddress: result.managedWalletAddress,
      note: "Store this sessionKey securely. It will not be shown again.",
    });
  } catch (err) {
    appLogger.error({ err }, "[SESSION] Session creation failed");
    res.status(500).json({ error: "Session creation failed" });
  }
});

// ── Authenticated endpoints (session auth) ─────────────────
// Beta gate + session auth applied to ALL mutation/management routes

stripeBetaRouter.use(requireStripeBetaEnabled, requireStripeSession);

/**
 * POST /stripe-beta/create-spt
 * SPT provisioning for MPP client flow.
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
 * Create card via MPP flow. Session auth + MPP payment required.
 *
 * Flow:
 *   1. Session auth (X-STRIPE-SESSION) → managed wallet
 *   2. MPP payment: no Authorization → 402; has credential → verify → PI
 *   3. Create card via cardService (uses managed wallet address)
 */
stripeBetaRouter.post(
  "/create",
  requireMppxPayment("create"),
  async (req, res) => {
    if (!req.stripeSession) {
      res.status(401).json({ error: "Session auth required" });
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
        session: req.stripeSession.sessionId,
        owner: req.stripeSession.ownerId,
        amount,
        paymentIntentId: txHash,
        rail: "stripe_mpp",
      },
      "[STRIPE-BETA] Card creation — payment verified via MPP"
    );

    try {
      const result = await cardService.createCard({
        walletAddress: req.stripeSession.managedWalletAddress,
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
          session: req.stripeSession.sessionId,
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
          note: "Store securely. Use GET /stripe-beta/cards/:id/details with X-STRIPE-SESSION for subsequent access.",
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

// ── Card management routes ──────────────────────────────────

/** GET /stripe-beta/cards — list cards for this session's managed wallet */
stripeBetaRouter.get("/cards", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const cards = await cardService.listCards(req.stripeSession.managedWalletAddress);
    res.json({ cards });
  } catch (error) {
    appLogger.error({ err: error }, "[STRIPE-BETA] List cards failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /stripe-beta/cards/:cardId — get card info */
stripeBetaRouter.get("/cards/:cardId", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const result = await cardService.getCard(
      req.stripeSession.managedWalletAddress,
      req.params.cardId
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /stripe-beta/cards/:cardId/details — sensitive card info (nonce required) */
stripeBetaRouter.get("/cards/:cardId/details", requireAgentNonce, async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const result = await cardService.getCardDetails(
      req.stripeSession.managedWalletAddress,
      req.params.cardId
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /stripe-beta/cards/:cardId/balance — live balance */
stripeBetaRouter.get("/cards/:cardId/balance", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const result = await cardService.getBalance(
      req.stripeSession.managedWalletAddress,
      req.params.cardId
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /stripe-beta/cards/:cardId/transactions — transaction history */
stripeBetaRouter.get("/cards/:cardId/transactions", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const result = await cardService.getTransactions(
      req.stripeSession.managedWalletAddress,
      req.params.cardId,
      page,
      limit
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /stripe-beta/cards/:cardId/freeze — freeze card */
stripeBetaRouter.post("/cards/:cardId/freeze", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const result = await cardService.setCardStatus(
      req.stripeSession.managedWalletAddress,
      req.params.cardId,
      "frozen"
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /stripe-beta/cards/:cardId/unfreeze — unfreeze card */
stripeBetaRouter.post("/cards/:cardId/unfreeze", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }
  try {
    const result = await cardService.setCardStatus(
      req.stripeSession.managedWalletAddress,
      req.params.cardId,
      "active"
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /stripe-beta/cards/:cardId/fund — top up via MPP */
stripeBetaRouter.post(
  "/cards/:cardId/fund",
  requireMppxPayment("fund"),
  async (req, res) => {
    if (!req.stripeSession || !req.paymentContext) {
      res.status(401).json({ error: "Session and payment auth required" });
      return;
    }
    try {
      const result = await cardService.fundCard({
        walletAddress: req.stripeSession.managedWalletAddress,
        cardId: req.params.cardId,
        fundAmountUsd: req.paymentContext.amount,
        chargedUsd: req.paymentContext.totalCostUsd,
        txHash: req.paymentContext.txHash,
      });
      res.json(result);
    } catch (error) {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
