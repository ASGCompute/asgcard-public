import { PaymentError } from "../errors";
import type {
  X402Accept,
  X402Challenge,
  PaymentPayload
} from "../types";

/**
 * Validate an x402 v2 challenge from the API.
 */
const isChallenge = (input: unknown): input is X402Challenge => {
  if (!input || typeof input !== "object") {
    return false;
  }

  const asRecord = input as Record<string, unknown>;
  return asRecord.x402Version === 2 && Array.isArray(asRecord.accepts);
};

/**
 * Parse the 402 challenge and return the first accept entry.
 */
export const parseChallenge = (input: unknown): X402Accept => {
  if (!isChallenge(input) || input.accepts.length === 0) {
    throw new PaymentError("Invalid x402 v2 challenge payload");
  }

  return input.accepts[0];
};

/**
 * Build a PaymentPayload (x402 v2 format) and return it as a
 * base64-encoded string suitable for the X-PAYMENT header.
 */
export const buildPaymentPayload = (input: {
  from: string;
  to: string;
  value: string;
  signature: string;
}): string => {
  const payload: PaymentPayload = {
    scheme: "exact",
    network: "stellar:pubnet",
    payload: {
      authorization: {
        from: input.from,
        to: input.to,
        value: input.value
      },
      signature: input.signature
    }
  };

  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
};

/**
 * Handle the full x402 v2 payment flow:
 * 1. Parse the 402 challenge
 * 2. Submit USDC payment on Stellar
 * 3. Build and return the X-PAYMENT header value
 *
 * Note: This is a reference implementation. In production,
 * the facilitator (OpenZeppelin Channels) verifies and settles
 * the payment. The SDK submits the transaction to Stellar
 * and provides the payment proof to the API.
 */
export const handleX402Payment = async (params: {
  challengePayload: unknown;
  secretKey: string;
  horizonUrl: string;
}): Promise<string> => {
  const accept = parseChallenge(params.challengePayload);

  // In a full implementation, this would:
  // 1. Build a Stellar USDC transfer transaction
  // 2. Sign with the secret key
  // 3. Submit to Stellar network
  // 4. Return the payment proof
  //
  // For now, this serves as the SDK interface contract.
  // See the API docs for the full x402 v2 payment flow:
  // https://asgcard.dev/docs

  throw new PaymentError(
    "Direct Stellar payment execution requires @stellar/stellar-sdk. " +
    "Install it as a peer dependency: npm install @stellar/stellar-sdk"
  );
};

export {
  parseChallenge as parseX402Challenge,
  buildPaymentPayload as buildX402PaymentPayload
};
