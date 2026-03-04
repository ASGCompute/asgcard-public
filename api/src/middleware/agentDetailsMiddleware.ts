import type { RequestHandler } from "express";
import crypto from "node:crypto";

/**
 * REALIGN-003: Nonce + anti-replay + rate-limit middleware
 * for agent card details access.
 *
 * - Requires X-AGENT-NONCE header (UUID v4 format)
 * - Rejects if nonce was already used (anti-replay)
 * - Rate limit: 5 requests / hour per card
 * - Nonces auto-expire after 5 minutes
 */

// In-memory nonce store (swap to Redis/DB in production scale)
const usedNonces = new Map<string, number>(); // nonce → timestamp
const rateLimitStore = new Map<string, number[]>(); // cardId → timestamps[]

const NONCE_TTL_MS = 5 * 60 * 1000;    // 5 minutes
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT = 5;                   // 5 requests / hour per card

// Prune expired nonces every 60s
const pruneInterval = setInterval(() => {
    const cutoff = Date.now() - NONCE_TTL_MS;
    for (const [nonce, ts] of usedNonces) {
        if (ts < cutoff) usedNonces.delete(nonce);
    }
}, 60_000);
// Don't block process exit
if (pruneInterval.unref) pruneInterval.unref();

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const requireAgentNonce: RequestHandler = (req, res, next) => {
    const nonce = req.header("X-AGENT-NONCE");

    if (!nonce) {
        res.status(400).json({
            error: "Missing X-AGENT-NONCE header",
            hint: "Generate a UUID v4 nonce for each details request"
        });
        return;
    }

    // Validate UUID v4 format
    if (!UUID_V4_REGEX.test(nonce)) {
        res.status(400).json({ error: "X-AGENT-NONCE must be UUID v4 format" });
        return;
    }

    // Anti-replay: reject if nonce already used
    if (usedNonces.has(nonce)) {
        res.status(409).json({
            error: "Nonce already used (replay detected)",
            code: "REPLAY_REJECTED"
        });
        return;
    }

    // Rate limit per card
    const cardId = req.params.cardId;
    if (cardId) {
        const now = Date.now();
        const windowStart = now - RATE_WINDOW_MS;
        const timestamps = rateLimitStore.get(cardId) ?? [];
        const recent = timestamps.filter(t => t >= windowStart);

        if (recent.length >= RATE_LIMIT) {
            res.status(429).json({
                error: "Card details rate limit exceeded (5 requests/hour)",
                retryAfterSeconds: Math.ceil((recent[0] + RATE_WINDOW_MS - now) / 1000)
            });
            return;
        }

        recent.push(now);
        rateLimitStore.set(cardId, recent);
    }

    // Record nonce as used
    usedNonces.set(nonce, Date.now());

    next();
};

/**
 * Hash a nonce for audit logging (don't store raw nonces in logs)
 */
export const hashNonce = (nonce: string): string =>
    crypto.createHash("sha256").update(nonce).digest("hex").slice(0, 16);

// Export for testing
export const __test__ = { usedNonces, rateLimitStore, RATE_LIMIT, NONCE_TTL_MS };
