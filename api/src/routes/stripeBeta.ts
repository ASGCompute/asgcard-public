/**
 * Stripe MPP Beta — Create Card Route
 *
 * POST /stripe-beta/create
 *
 * Flow (production MPP):
 *   1. Wallet auth (X-WALLET-ADDRESS, X-WALLET-SIGNATURE, X-WALLET-TIMESTAMP)
 *   2. Beta gate (feature flag + allowlist)
 *   3. Stripe MPP payment middleware:
 *      - No X-PAYMENT → 402 with stripe_mpp challenge
 *      - Has X-PAYMENT → validate SPT, create PaymentIntent, attach paymentContext
 *   4. Create card via cardService
 *   5. Return card details
 */
import { Router } from "express";
import { z } from "zod";
import { requireWalletAuth } from "../middleware/walletAuth";
import { requireStripeBeta } from "../middleware/stripeBeta";
import { requireStripeMPPPayment } from "../middleware/stripeMPP";
import { cardService, HttpError } from "../services/cardService";
import { appLogger } from "../utils/logger";

const stripeBetaBodySchema = z.object({
  nameOnCard: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  amount: z.number().min(5).max(5000),
});

export const stripeBetaRouter = Router();

// Apply auth + beta guard to all routes
stripeBetaRouter.use(requireWalletAuth);
stripeBetaRouter.use(requireStripeBeta);

/**
 * POST /stripe-beta/create
 * Create a card via Stripe MPP beta flow.
 *
 * Body: { nameOnCard, email, phone?, amount }
 * Headers: X-PAYMENT (SPT credential, optional — triggers 402 if absent)
 */
stripeBetaRouter.post(
  "/create",
  requireStripeMPPPayment("create"),
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
      "[STRIPE-BETA] Card creation — payment verified"
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
        "[STRIPE-BETA] Card created successfully"
      );

      // Response contract (same as Stellar flow, different rail)
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
