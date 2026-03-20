/**
 * Stripe Service — Docs-aligned SPT flow
 *
 * Creates PaymentIntents using shared_payment_granted_token (SPT).
 * Per Stripe MPP docs: when confirming a PI with an SPT, Stripe
 * clones the customer's PaymentMethod from the token.
 *
 * No custom credential parsing. SPT ID is a plain string "spt_xxx".
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

/**
 * Create and confirm a PaymentIntent using a Stripe SharedPaymentToken (SPT).
 *
 * Docs-aligned: uses `shared_payment_granted_token` parameter.
 * Stripe automatically clones the customer's PaymentMethod from the SPT.
 */
export async function createPaymentIntentWithSPT(
  sptId: string,
  amountCents: number,
  description: string
): Promise<{ success: boolean; paymentIntentId: string; error?: string }> {
  try {
    const stripe = getStripe();

    // Docs-aligned: shared_payment_granted_token creates + confirms PI
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      // @ts-expect-error — shared_payment_granted_token is a new Stripe MPP param
      shared_payment_granted_token: sptId,
      confirm: true,
      description,
      metadata: {
        source: "asgcard_stripe_mpp",
      },
    });

    if (paymentIntent.status === "succeeded") {
      appLogger.info(
        { piId: paymentIntent.id, amount: amountCents },
        "[STRIPE] PaymentIntent succeeded via SPT"
      );
      return { success: true, paymentIntentId: paymentIntent.id };
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
    return { success: false, paymentIntentId: "", error: msg };
  }
}
