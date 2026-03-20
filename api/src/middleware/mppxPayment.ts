/**
 * MPP Payment Middleware — Official Protocol
 *
 * Implements the Machine Payments Protocol (MPP) spec for Express:
 *   - No credential → 402 with WWW-Authenticate: Payment <challenge>
 *   - Has Authorization: Payment <credential> → verify HMAC, extract SPT,
 *     create PaymentIntent via shared_payment_granted_token, attach paymentContext
 *
 * Protocol: https://mpp.dev
 */
import type { Request, Response, NextFunction } from "express";
import Stripe from "stripe";
import { env } from "../config/env";
import {
  calcCreationCost,
  calcFundingCost,
  isValidAmount,
  isValidCreateAmount,
} from "../config/pricing";
import {
  createChallenge,
  verifyChallenge,
  serializeChallenge,
  deserializeCredential,
  extractPaymentScheme,
} from "../lib/mppProtocol";
import { appLogger } from "../utils/logger";

type StripePurpose = "create" | "fund";

const MPP_REALM = "asgcard.dev";
const MPP_METHOD = "stripe";
const MPP_INTENT = "charge";

/** Lazy Stripe SDK instance */
let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeClient) {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
    stripeClient = new Stripe(key, {
      apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
      appInfo: { name: "asgcard", version: "0.5.0" },
    });
  }
  return stripeClient;
}

export const requireMppxPayment = (purpose: StripePurpose) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    const secretKey = env.MPP_SECRET_KEY;
    if (!secretKey) {
      res.status(500).json({ error: "MPP_SECRET_KEY not configured" });
      return;
    }

    // ── Extract amount from body ──
    const amount =
      typeof req.body?.amount === "number"
        ? req.body.amount
        : Number(req.params.amount);

    const amountValidator = purpose === "create" ? isValidCreateAmount : isValidAmount;
    if (!amountValidator(amount)) {
      const msg = purpose === "create"
        ? "Invalid amount. Must be 0 (card-only) or between $5 and $5,000."
        : "Invalid amount. Must be between $5 and $5,000.";
      res
        .status(400)
        .json({ error: msg });
      return;
    }

    const totalCostUsd =
      purpose === "create"
        ? calcCreationCost(amount)
        : calcFundingCost(amount);
    const totalCostCents = Math.round(totalCostUsd * 100);

    // Build the challenge for this request (stateless — recomputed each time)
    const challenge = createChallenge(
      {
        realm: MPP_REALM,
        method: MPP_METHOD,
        intent: MPP_INTENT,
        request: {
          amount: String(totalCostCents),
          currency: "usd",
        },
        description:
          purpose === "create"
            ? (amount > 0 ? `Create ASG Card with $${amount} load` : `Create ASG Card ($10 issuance)`)
            : `Fund ASG Card with $${amount}`,
      },
      secretKey
    );

    // ── Check for Authorization: Payment header ──
    const authHeader = req.header("Authorization");
    const paymentScheme = authHeader
      ? extractPaymentScheme(authHeader)
      : null;

    if (!paymentScheme) {
      // No credential — issue 402 challenge
      appLogger.info(
        { purpose, amount, totalCostCents },
        "[MPP] Returning 402 challenge"
      );

      const wwwAuth = serializeChallenge(challenge);
      res
        .status(402)
        .set("WWW-Authenticate", wwwAuth)
        .set("Cache-Control", "no-store")
        .json({
          type: "https://mpp.dev/errors/payment-required",
          title: "Payment Required",
          status: 402,
          detail: challenge.description,
          challengeId: challenge.id,
        });
      return;
    }

    // ── Parse credential ──
    let credential;
    try {
      credential = deserializeCredential(paymentScheme);
    } catch (err) {
      appLogger.warn(
        { error: String(err) },
        "[MPP] Malformed credential"
      );
      const wwwAuth = serializeChallenge(challenge);
      res
        .status(402)
        .set("WWW-Authenticate", wwwAuth)
        .json({
          type: "https://mpp.dev/errors/malformed-credential",
          title: "Malformed Credential",
          status: 402,
          detail: "Could not parse payment credential",
        });
      return;
    }

    // ── Verify credential challenge was issued by us (HMAC check) ──
    if (!verifyChallenge(credential.challenge, secretKey)) {
      appLogger.warn(
        { challengeId: credential.challenge?.id },
        "[MPP] Challenge HMAC verification failed"
      );
      const wwwAuth = serializeChallenge(challenge);
      res
        .status(402)
        .set("WWW-Authenticate", wwwAuth)
        .json({
          type: "https://mpp.dev/errors/invalid-challenge",
          title: "Invalid Challenge",
          status: 402,
          detail: "Challenge was not issued by this server",
        });
      return;
    }

    // ── Check expiry ──
    if (
      credential.challenge.expires &&
      new Date(credential.challenge.expires) < new Date()
    ) {
      const wwwAuth = serializeChallenge(challenge);
      res
        .status(402)
        .set("WWW-Authenticate", wwwAuth)
        .json({
          type: "https://mpp.dev/errors/payment-expired",
          title: "Payment Expired",
          status: 402,
          detail: "Challenge has expired, please retry",
        });
      return;
    }

    // ── Verify amount matches ──
    const echoedAmount = String(credential.challenge.request?.amount);
    const expectedAmount = String(totalCostCents);
    if (echoedAmount !== expectedAmount) {
      const wwwAuth = serializeChallenge(challenge);
      res
        .status(402)
        .set("WWW-Authenticate", wwwAuth)
        .json({
          type: "https://mpp.dev/errors/invalid-challenge",
          title: "Amount Mismatch",
          status: 402,
          detail: "Credential amount does not match this route's requirements",
        });
      return;
    }

    // ── Extract SPT from credential payload ──
    const spt = credential.payload?.spt as string | undefined;
    if (!spt || typeof spt !== "string" || !spt.startsWith("spt_")) {
      res.status(400).json({
        type: "https://mpp.dev/errors/invalid-payload",
        title: "Invalid Payload",
        status: 400,
        detail: "Missing or malformed SPT in credential payload",
      });
      return;
    }

    // ── Create PaymentIntent with SPT (same as mppx stripe.charge verify) ──
    appLogger.info(
      { purpose, amount, sptPrefix: spt.substring(0, 12) },
      "[MPP] Processing SPT → PaymentIntent"
    );

    try {
      const stripe = getStripe();
      const pi = await stripe.paymentIntents.create({
        amount: totalCostCents,
        currency: "usd",
        shared_payment_granted_token: spt,
        confirm: true,
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: "never",
        },
        description: challenge.description,
        metadata: {
          mpp_version: "1",
          mpp_is_mpp: "true",
          mpp_intent: MPP_INTENT,
          mpp_challenge_id: challenge.id,
          mpp_server_id: MPP_REALM,
          source: "asgcard_stripe_mpp",
        },
      } as unknown as Stripe.PaymentIntentCreateParams, {
        idempotencyKey: `mppx_${challenge.id}_${spt}`,
      });

      if (pi.status !== "succeeded") {
        appLogger.warn(
          { piId: pi.id, status: pi.status },
          "[MPP] PaymentIntent not succeeded"
        );
        const wwwAuth = serializeChallenge(challenge);
        res
          .status(402)
          .set("WWW-Authenticate", wwwAuth)
          .json({
            type: "https://mpp.dev/errors/verification-failed",
            title: "Payment Failed",
            status: 402,
            detail: `PaymentIntent status: ${pi.status}`,
          });
        return;
      }

      // ── Success: attach payment context + receipt header ──
      req.paymentContext = {
        payer: req.stripeSession?.managedWalletAddress ?? req.walletContext?.address ?? "",
        txHash: pi.id,
        atomicAmount: totalCostCents.toString(),
        amount,
        totalCostUsd,
        paymentRail: "stripe_mpp",
      };

      // Set MPP receipt header
      const receipt = JSON.stringify({
        method: "stripe",
        status: "success",
        timestamp: new Date().toISOString(),
        reference: pi.id,
      });
      res.set(
        "X-Payment-Receipt",
        Buffer.from(receipt).toString("base64url")
      );

      next();
    } catch (err) {
      appLogger.error({ err }, "[MPP] PaymentIntent creation failed");
      const wwwAuth = serializeChallenge(challenge);
      res
        .status(402)
        .set("WWW-Authenticate", wwwAuth)
        .json({
          type: "https://mpp.dev/errors/verification-failed",
          title: "Verification Failed",
          status: 402,
          detail: "Stripe PaymentIntent failed",
        });
    }
  };
};
