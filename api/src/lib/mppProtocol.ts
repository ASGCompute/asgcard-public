/**
 * MPP Protocol — Challenge / Credential helpers
 *
 * Implements the Machine Payments Protocol (MPP) spec:
 *   - Challenge:   WWW-Authenticate: Payment <base64url-json>
 *   - Credential:  Authorization: Payment <base64url-json>
 *   - Challenge ID: HMAC-SHA256 over (realm|method|intent|request|expires)
 *
 * Protocol source: https://mpp.dev / wevm/mppx
 */
import crypto from "node:crypto";

// ── Challenge ───────────────────────────────────────────────────

export interface MppChallenge {
  id: string;
  realm: string;
  method: string;
  intent: string;
  request: Record<string, unknown>;
  description?: string;
  expires?: string;
  opaque?: Record<string, string>;
}

export interface MppCredential {
  challenge: MppChallenge;
  payload: Record<string, unknown>;
  source?: string;
}

/**
 * Create a challenge with HMAC-bound ID (stateless — no DB needed).
 */
export function createChallenge(
  params: {
    realm: string;
    method: string;
    intent: string;
    request: Record<string, unknown>;
    description?: string;
    expires?: string;
    opaque?: Record<string, string>;
  },
  secretKey: string
): MppChallenge {
  const expires = params.expires ?? new Date(Date.now() + 5 * 60_000).toISOString();

  const id = computeChallengeId(
    {
      realm: params.realm,
      method: params.method,
      intent: params.intent,
      request: params.request,
      expires,
    },
    secretKey
  );

  return {
    id,
    realm: params.realm,
    method: params.method,
    intent: params.intent,
    request: params.request,
    ...(params.description && { description: params.description }),
    ...(expires && { expires }),
    ...(params.opaque && { opaque: params.opaque }),
  };
}

/**
 * Verify a challenge was issued by us — recompute HMAC and compare.
 */
export function verifyChallenge(
  challenge: MppChallenge,
  secretKey: string
): boolean {
  const expectedId = computeChallengeId(
    {
      realm: challenge.realm,
      method: challenge.method,
      intent: challenge.intent,
      request: challenge.request,
      expires: challenge.expires,
    },
    secretKey
  );

  return constantTimeEqual(challenge.id, expectedId);
}

/**
 * Serialize a challenge for WWW-Authenticate header.
 * Format: Payment <base64url(JSON)>
 */
export function serializeChallenge(challenge: MppChallenge): string {
  const requestSerialized = serializePaymentRequest(challenge.request);
  const wire = {
    ...challenge,
    request: requestSerialized,
  };
  const json = JSON.stringify(wire);
  const encoded = base64urlEncode(json);
  return `Payment ${encoded}`;
}

/**
 * Deserialize a credential from Authorization header.
 * Expected: Authorization: Payment <base64url(JSON)>
 */
export function deserializeCredential(header: string): MppCredential {
  const match = header.match(/^Payment\s+(.+)$/i);
  if (!match?.[1]) throw new Error("Missing Payment scheme");

  try {
    const json = base64urlDecode(match[1]);
    const parsed = JSON.parse(json);

    if (!parsed.challenge || !parsed.payload) {
      throw new Error("Missing challenge or payload in credential");
    }

    // Deserialize request if it's a string (compact format)
    const challenge: MppChallenge = {
      ...parsed.challenge,
      request:
        typeof parsed.challenge.request === "string"
          ? deserializePaymentRequest(parsed.challenge.request)
          : parsed.challenge.request,
    };

    return {
      challenge,
      payload: parsed.payload,
      ...(parsed.source && { source: parsed.source }),
    };
  } catch {
    throw new Error("Invalid base64url or JSON in credential");
  }
}

/**
 * Serialize a credential for Authorization header.
 * Format: Payment <base64url(JSON({challenge, payload}))>
 */
export function serializeCredential(credential: MppCredential): string {
  const wire = {
    challenge: {
      ...credential.challenge,
      request: serializePaymentRequest(credential.challenge.request),
    },
    payload: credential.payload,
    ...(credential.source && { source: credential.source }),
  };
  const json = JSON.stringify(wire);
  const encoded = base64urlEncode(json);
  return `Payment ${encoded}`;
}

/**
 * Extract Payment scheme from Authorization header (handles multi-scheme).
 */
export function extractPaymentScheme(header: string): string | null {
  const schemes = header.split(",").map((s) => s.trim());
  for (const s of schemes) {
    if (/^Payment\s+/i.test(s)) return s;
  }
  return null;
}

// ── Internal Helpers ────────────────────────────────────────────

function computeChallengeId(
  params: {
    realm: string;
    method: string;
    intent: string;
    request: Record<string, unknown>;
    expires?: string;
  },
  secretKey: string
): string {
  const data = [
    params.realm,
    params.method,
    params.intent,
    serializePaymentRequest(params.request),
    params.expires ?? "",
  ].join("|");

  return crypto
    .createHmac("sha256", secretKey)
    .update(data)
    .digest("base64url");
}

/**
 * Serialize payment request to compact string (sorted keys).
 * Matches mppx PaymentRequest.serialize.
 */
function serializePaymentRequest(request: Record<string, unknown>): string {
  const sorted = Object.keys(request)
    .sort()
    .map((k) => `${k}=${JSON.stringify(request[k])}`)
    .join("&");
  return sorted;
}

/**
 * Deserialize payment request from compact string.
 */
function deserializePaymentRequest(
  str: string
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  if (!str) return result;
  for (const pair of str.split("&")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx === -1) continue;
    const key = pair.substring(0, eqIdx);
    const val = pair.substring(eqIdx + 1);
    try {
      result[key] = JSON.parse(val);
    } catch {
      result[key] = val;
    }
  }
  return result;
}

function base64urlEncode(str: string): string {
  return Buffer.from(str, "utf8")
    .toString("base64url");
}

function base64urlDecode(encoded: string): string {
  return Buffer.from(encoded, "base64url").toString("utf8");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return crypto.timingSafeEqual(bufA, bufB);
}
