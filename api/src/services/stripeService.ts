/**
 * Stripe SDK Service — thin wrapper for PaymentIntent operations
 *
 * Uses STRIPE_SECRET_KEY from env. Only loaded when Stripe beta is enabled.
 */
import Stripe from "stripe";
import { env } from "../config/env";
import { appLogger } from "../utils/logger";

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY not configured");
    }
    stripeClient = new Stripe(key, {
      apiVersion: "2025-03-31.basil" as Stripe.LatestApiVersion,
      appInfo: { name: "asgcard", version: "0.3.3" },
    });
  }
  return stripeClient;
}

export interface SPTPayload {
  /** Stripe-issued Shared Payment Token */
  token: string;
  /** Amount in cents */
  amountCents: number;
  /** Currency (always "usd") */
  currency: string;
}

/**
 * Parse a Stripe MPP credential from the X-PAYMENT header.
 * Expected: base64-encoded JSON with {token, amountCents, currency}
 * or a raw SPT token string.
 */
export function parseSPTCredential(headerValue: string): SPTPayload | null {
  try {
    // Try base64 JSON first
    let parsed: unknown;
    try {
      parsed = JSON.parse(headerValue);
    } catch {
      const decoded = Buffer.from(headerValue, "base64").toString("utf8");
      parsed = JSON.parse(decoded);
    }

    const spt = parsed as Record<string, unknown>;

    if (typeof spt.token === "string" && spt.token.length > 0) {
      return {
        token: spt.token,
        amountCents: typeof spt.amountCents === "number" ? spt.amountCents : 0,
        currency: typeof spt.currency === "string" ? spt.currency : "usd",
      };
    }

    return null;
  } catch {
    // If it's just a raw token string, wrap it
    if (typeof headerValue === "string" && headerValue.length > 10) {
      return {
        token: headerValue,
        amountCents: 0,
        currency: "usd",
      };
    }
    return null;
  }
}

/**
 * Create and confirm a PaymentIntent using a Stripe SPT credential.
 */
export async function createPaymentIntentFromSPT(
  spt: SPTPayload,
  amountCents: number,
  description: string
): Promise<{ success: boolean; paymentIntentId: string; error?: string }> {
  try {
    const stripe = getStripe();

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      description,
      payment_method: spt.token,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        source: "asgcard_stripe_mpp_beta",
      },
    });

    if (paymentIntent.status === "succeeded") {
      return {
        success: true,
        paymentIntentId: paymentIntent.id,
      };
    }

    appLogger.warn(
      { piId: paymentIntent.id, status: paymentIntent.status },
      "[STRIPE] PaymentIntent not succeeded"
    );

    return {
      success: false,
      paymentIntentId: paymentIntent.id,
      error: `PaymentIntent status: ${paymentIntent.status}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    appLogger.error({ err: error }, "[STRIPE] PaymentIntent creation failed");
    return {
      success: false,
      paymentIntentId: "",
      error: `Stripe payment failed: ${msg}`,
    };
  }
}

/**
 * Retrieve a PaymentIntent by ID (for status checks).
 */
export async function retrievePaymentIntent(
  paymentIntentId: string
): Promise<Stripe.PaymentIntent | null> {
  try {
    const stripe = getStripe();
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (error) {
    appLogger.error({ err: error }, "[STRIPE] PaymentIntent retrieval failed");
    return null;
  }
}
