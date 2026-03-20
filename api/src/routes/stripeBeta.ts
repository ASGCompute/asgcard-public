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
import express, { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { requireStripeSession } from "../middleware/stripeSession";
import { requireMppxPayment } from "../middleware/mppxPayment";
import { requireAgentNonce } from "../middleware/agentDetailsMiddleware";
import { cardService, HttpError } from "../services/cardService";
import { createSession } from "../services/sessionService";
import {
  createPaymentRequest,
  getPaymentRequest,
  getPaymentRequestByToken,
  approvePaymentRequest,
  rejectPaymentRequest,
  completePaymentRequest,
  failPaymentRequest,
} from "../services/paymentRequestService";
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
  amount: z.number().min(0).max(5000).default(0),
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

const paymentRequestCreateSchema = z.object({
  amountUsd: z.number().min(0).max(5000).default(0),
  description: z.string().max(500).optional(),
  nameOnCard: z.string().min(1).optional(),
  phone: z.string().optional(),
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

// ── Owner approval endpoints (public — token auth) ──────────

/**
 * GET /stripe-beta/approve/:id
 * Public approval page. Token in query string is the auth.
 * Returns JSON with request details for the frontend to render.
 */
stripeBetaRouter.get("/approve/:id", requireStripeBetaEnabled, async (req, res) => {
  const { id } = req.params;
  const token = req.query.token as string;

  if (!id || !token) {
    res.status(400).json({ error: "Missing request ID or token" });
    return;
  }

  try {
    const pr = await getPaymentRequestByToken(id, token);
    if (!pr) {
      res.status(403).json({ error: "Invalid or expired approval link" });
      return;
    }

    res.json({
      requestId: pr.id,
      status: pr.status,
      amountUsd: pr.amountUsd,
      description: pr.description,
      email: pr.email,
      nameOnCard: pr.nameOnCard,
      phone: pr.phone,
      createdAt: pr.createdAt,
      expiresAt: pr.expiresAt,
    });
  } catch (err) {
    appLogger.error({ err }, "[APPROVE] Get request failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /stripe-beta/approve/:id
 * Owner approves or rejects a payment request.
 * Body: { action: 'approve' | 'reject', token: string }
 *
 * On approve: triggers the card creation + MPP payment flow.
 * The approval page frontend handles Stripe payment, then POSTs here
 * with the SPT credential in the Authorization header.
 */
stripeBetaRouter.post(
  "/approve/:id",
  requireStripeBetaEnabled,
  express.json(),
  async (req, res) => {
    const { id } = req.params;
    const token = (req.body?.token || req.query.token) as string;
    const action = (req.body?.action || "approve") as string;

    if (!id || !token) {
      res.status(400).json({ error: "Missing request ID or token" });
      return;
    }

    try {
      if (action === "reject") {
        const ok = await rejectPaymentRequest(id, token);
        if (!ok) {
          res.status(400).json({ error: "Cannot reject — request not found, already processed, or expired" });
          return;
        }
        res.json({ status: "rejected", requestId: id });
        return;
      }

      // Action: approve
      const pr = await getPaymentRequestByToken(id, token);
      if (!pr || pr.status !== "pending") {
        res.status(400).json({ error: "Cannot approve — request not found, already processed, or expired" });
        return;
      }

      const ok = await approvePaymentRequest(id, token);
      if (!ok) {
        res.status(400).json({ error: "Approval failed — request may have expired" });
        return;
      }

      // After approval, the owner will make a payment via Stripe.
      // The card creation happens when the owner completes payment.
      // Return the approved status — the frontend will proceed to payment.
      res.json({
        status: "approved",
        requestId: id,
        amountUsd: pr.amountUsd,
        note: "Proceed to payment to complete the card creation.",
      });
    } catch (err) {
      appLogger.error({ err, requestId: id }, "[APPROVE] Action failed");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /stripe-beta/approve/:id/complete
 * Called after owner completes Stripe payment.
 * Body: { token, txHash, nameOnCard, email, phone, amount }
 * Creates the card and marks the request as completed.
 */
stripeBetaRouter.post(
  "/approve/:id/complete",
  requireStripeBetaEnabled,
  requireMppxPayment("create"),
  async (req, res) => {
    const { id } = req.params;
    const token = (req.body?.token || req.query.token) as string;

    if (!token) {
      res.status(400).json({ error: "Missing approval token" });
      return;
    }

    try {
      const pr = await getPaymentRequestByToken(id, token);
      if (!pr || pr.status !== "approved") {
        res.status(400).json({ error: "Request not in approved state" });
        return;
      }

      if (!req.paymentContext) {
        res.status(500).json({ error: "Payment context missing" });
        return;
      }

      const { amount, totalCostUsd, txHash } = req.paymentContext;

      // Look up session to get managed wallet
      const sessionRows = await import("../db/db").then(m =>
        m.query<{ managed_wallet: string }>(
          `SELECT managed_wallet FROM stripe_beta_sessions WHERE id = $1`,
          [pr.sessionId]
        )
      );

      if (sessionRows.length === 0) {
        res.status(400).json({ error: "Session not found" });
        return;
      }

      const walletAddress = sessionRows[0].managed_wallet;

      const result = await cardService.createCard({
        walletAddress,
        nameOnCard: pr.nameOnCard || "ASG Card",
        email: pr.email,
        phone: pr.phone || undefined,
        initialAmountUsd: amount,
        amount,
        chargedUsd: totalCostUsd,
        txHash,
        paymentRail: "stripe_mpp",
        paymentReference: txHash,
      });

      await completePaymentRequest(id, result.card.cardId, txHash, {
        success: result.success,
        card: result.card,
        payment: result.payment,
      });

      appLogger.info(
        { requestId: id, cardId: result.card.cardId },
        "[APPROVE] Payment request completed — card created"
      );

      res.status(201).json({
        status: "completed",
        requestId: id,
        card: result.card,
        payment: result.payment,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        await failPaymentRequest(id, error.message);
        res.status(error.status).json({ error: error.message });
        return;
      }
      await failPaymentRequest(id, "Internal error");
      appLogger.error({ err: error, requestId: id }, "[APPROVE] Complete failed");
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/**
 * POST /stripe-beta/approve/:id/create-spt
 * Create SPT for approved payment requests.
 * Uses approval token for auth (owner doesn't have session key).
 */
stripeBetaRouter.post(
  "/approve/:id/create-spt",
  requireStripeBetaEnabled,
  async (req, res) => {
    const { id } = req.params;
    const token = req.body?.token as string;

    if (!token) {
      res.status(400).json({ error: "Missing approval token" });
      return;
    }

    const pr = await getPaymentRequestByToken(id, token);
    if (!pr || pr.status !== "approved") {
      res.status(400).json({ error: "Request not in approved state" });
      return;
    }

    const { paymentMethod, amount, currency } = req.body;
    if (!paymentMethod || !amount) {
      res.status(400).json({ error: "Missing paymentMethod or amount" });
      return;
    }

    try {
      const key = env.STRIPE_SECRET_KEY;
      if (!key) {
        res.status(500).json({ error: "STRIPE_SECRET_KEY not configured" });
        return;
      }

      const body = new URLSearchParams({
        payment_method: paymentMethod,
        "usage_limit[amount]": String(amount),
        "usage_limit[currency]": currency || "usd",
      });

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
          "[APPROVE] SPT creation failed"
        );
        res.status(502).json({ error: "SPT creation failed" });
        return;
      }

      const result = (await response.json()) as { id: string };
      appLogger.info(
        { sptId: result.id?.substring(0, 12), requestId: id },
        "[APPROVE] SPT created for approval flow"
      );
      res.json({ spt: result.id });
    } catch (err) {
      appLogger.error({ err }, "[APPROVE] SPT creation failed");
      res.status(502).json({ error: "SPT creation failed" });
    }
  }
);

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

// ── Payment request routes (session-authenticated) ──────────

const paymentRequestRouter = Router();

/**
 * POST /stripe-beta/payment-requests
 * Agent creates a payment request for owner approval.
 */
paymentRequestRouter.post("/", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }

  const parsed = paymentRequestCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }

  try {
    const result = await createPaymentRequest({
      sessionId: req.stripeSession.sessionId,
      ownerId: req.stripeSession.ownerId,
      email: req.stripeSession.email,
      amountUsd: parsed.data.amountUsd,
      description: parsed.data.description,
      nameOnCard: parsed.data.nameOnCard,
      phone: parsed.data.phone,
    });

    res.status(201).json({
      status: "approval_required",
      requestId: result.requestId,
      approvalUrl: result.approvalUrl,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    appLogger.error({ err }, "[PAYMENT-REQUEST] Creation failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /stripe-beta/payment-requests/:id
 * Agent polls payment request status.
 */
paymentRequestRouter.get("/:id", async (req, res) => {
  if (!req.stripeSession) {
    res.status(401).json({ error: "Session auth required" });
    return;
  }

  try {
    const pr = await getPaymentRequest(req.params.id, req.stripeSession.ownerId);
    if (!pr) {
      res.status(404).json({ error: "Payment request not found" });
      return;
    }

    const response: Record<string, unknown> = {
      requestId: pr.id,
      status: pr.status,
      amountUsd: pr.amountUsd,
      description: pr.description,
      createdAt: pr.createdAt,
      expiresAt: pr.expiresAt,
    };

    if (pr.status === "completed" && pr.resultJson) {
      response.card = pr.resultJson.card;
      response.payment = pr.resultJson.payment;
      response.cardId = pr.cardId;
      response.completedAt = pr.completedAt;
    }

    if (pr.status === "failed" && pr.resultJson) {
      response.error = pr.resultJson.error;
    }

    if (pr.status === "approved") {
      response.approvedAt = pr.approvedAt;
    }

    res.json(response);
  } catch (err) {
    appLogger.error({ err }, "[PAYMENT-REQUEST] Get failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

stripeBetaRouter.use("/payment-requests", paymentRequestRouter);
