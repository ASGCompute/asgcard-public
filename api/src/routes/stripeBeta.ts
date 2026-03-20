/**
 * Stripe MPP Beta — Create Card Route
 *
 * POST /stripe-beta/create
 *
 * Requires:
 *   - Wallet auth (X-WALLET-ADDRESS, X-WALLET-SIGNATURE, X-WALLET-TIMESTAMP)
 *   - STRIPE_MPP_BETA_ENABLED=true
 *   - Body: { nameOnCard, email, phone?, amount, stripePaymentIntentId }
 *
 * Flow:
 *   1. Validate wallet auth
 *   2. Check beta feature flag + allowlist
 *   3. Validate request body
 *   4. Call cardService.createCard with payment_rail="stripe_mpp"
 *   5. Return card creation result
 *
 * Note: In beta v1, stripePaymentIntentId is accepted but NOT verified
 * against Stripe API. This is a demo-first surface.
 */
import { Router } from "express";
import { z } from "zod";
import { requireWalletAuth } from "../middleware/walletAuth";
import { requireStripeBeta } from "../middleware/stripeBeta";
import { cardService, HttpError } from "../services/cardService";
import { isValidAmount, calcCreationCost } from "../config/pricing";
import { appLogger } from "../utils/logger";

const stripeBetaCreateSchema = z.object({
  nameOnCard: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  amount: z.number().min(5).max(5000),
  stripePaymentIntentId: z.string().min(1),
});

export const stripeBetaRouter = Router();

// Apply auth + beta guard to all routes
stripeBetaRouter.use(requireWalletAuth);
stripeBetaRouter.use(requireStripeBeta);

/**
 * POST /stripe-beta/create
 * Create a card via Stripe MPP beta flow.
 */
stripeBetaRouter.post("/create", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const parsed = stripeBetaCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
    return;
  }

  const { nameOnCard, email, phone, amount, stripePaymentIntentId } = parsed.data;

  if (!isValidAmount(amount)) {
    res.status(400).json({ error: "Invalid amount. Must be between $5 and $5,000." });
    return;
  }

  const chargedUsd = calcCreationCost(amount);

  appLogger.info(
    {
      wallet: req.walletContext.address,
      amount,
      stripePaymentIntentId,
    },
    "[STRIPE-BETA] Card creation request"
  );

  try {
    const result = await cardService.createCard({
      walletAddress: req.walletContext.address,
      nameOnCard,
      email,
      phone,
      initialAmountUsd: amount,
      amount,
      chargedUsd,
      txHash: stripePaymentIntentId,
      paymentRail: "stripe_mpp",
      paymentReference: stripePaymentIntentId,
    });

    appLogger.info(
      {
        wallet: req.walletContext.address,
        cardId: result.card.cardId,
        amount,
        rail: "stripe_mpp",
      },
      "[STRIPE-BETA] Card created successfully"
    );

    // Build response (same contract as Stellar flow, different rail)
    const response: Record<string, unknown> = {
      success: result.success,
      card: result.card,
      payment: result.payment,
      beta: true,
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

    appLogger.error({ err: error }, "[STRIPE-BETA] Unexpected error in card creation");
    res.status(500).json({ error: "Internal server error" });
  }
});
