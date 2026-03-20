/**
 * Stripe Beta Session Service
 *
 * Manages the lifecycle of Stripe-edition beta sessions:
 *   - Create session (email → managed wallet + session key)
 *   - Validate session (session key → context)
 *   - Revoke sessions (by email — creating a new session revokes prior active ones)
 *
 * Managed wallets are real Stellar keypairs generated server-side.
 * The wallet address is used as the internal binding for cardService (unchanged).
 * The private key is encrypted at rest with AES-256-GCM using STRIPE_SESSIONS_KEY.
 * The session key is hashed with SHA-256 before storage.
 */
import crypto from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { query } from "../db/db";
import { appLogger } from "../utils/logger";

// ── Encryption helpers (same pattern as crypto.ts) ───────────
const CURRENT_VERSION = 0x01;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function encryptSecret(plaintext: string, key: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf-8")),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([
    Buffer.from([CURRENT_VERSION]),
    iv,
    authTag,
    encrypted,
  ]);
}

// ── Session key generation ───────────────────────────────────
function generateSessionKey(): string {
  return `sk_sess_${crypto.randomBytes(24).toString("base64url")}`;
}

function hashSessionKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateOwnerId(): string {
  return `owner_${crypto.randomBytes(8).toString("hex")}`;
}

function generateSessionId(): string {
  return `sess_${crypto.randomBytes(8).toString("hex")}`;
}

// ── Encryption key ──────────────────────────────────────────
let encKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (encKey) return encKey;
  const keyEnv = process.env.STRIPE_SESSIONS_KEY;
  if (!keyEnv) throw new Error("STRIPE_SESSIONS_KEY is required for Stripe beta sessions");
  const buf = Buffer.from(keyEnv, "base64");
  if (buf.length !== 32) {
    throw new Error(
      `STRIPE_SESSIONS_KEY must be exactly 32 bytes (got ${buf.length}). ` +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  encKey = buf;
  return encKey;
}

// ── Public API ──────────────────────────────────────────────

export interface SessionCreateResult {
  sessionId: string;
  ownerId: string;
  sessionKey: string;           // raw — returned once, never stored
  managedWalletAddress: string; // Stellar G... address
}

export interface SessionContext {
  sessionId: string;
  ownerId: string;
  email: string;
  managedWalletAddress: string;
}

/**
 * Create a new beta session for the given email.
 * Revokes any prior active sessions for this email.
 * Returns the raw session key once — caller must store it.
 */
export async function createSession(email: string): Promise<SessionCreateResult> {
  const key = getEncryptionKey();

  // Revoke prior active sessions for this email
  await query(
    `UPDATE stripe_beta_sessions SET status = 'revoked', revoked_at = NOW()
     WHERE email = $1 AND status = 'active'`,
    [email]
  );

  // Generate managed Stellar keypair
  const kp = Keypair.random();
  const walletAddress = kp.publicKey();
  const secretEncrypted = encryptSecret(kp.secret(), key);

  // Generate session credentials
  const sessionId = generateSessionId();
  const ownerId = generateOwnerId();
  const rawSessionKey = generateSessionKey();
  const sessionKeyHash = hashSessionKey(rawSessionKey);

  await query(
    `INSERT INTO stripe_beta_sessions
       (id, owner_id, email, managed_wallet, managed_secret, session_key_hash, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
    [
      sessionId,
      ownerId,
      email,
      walletAddress,
      secretEncrypted,
      sessionKeyHash,
    ]
  );

  appLogger.info(
    { sessionId, ownerId, wallet: walletAddress.substring(0, 8) + "..." },
    "[SESSION] Created beta session"
  );

  return {
    sessionId,
    ownerId,
    sessionKey: rawSessionKey,
    managedWalletAddress: walletAddress,
  };
}

/**
 * Validate a session key and return the session context.
 * Returns null if the session is invalid, revoked, or expired.
 */
export async function validateSession(rawSessionKey: string): Promise<SessionContext | null> {
  const hash = hashSessionKey(rawSessionKey);

  const rows = await query<{
    id: string;
    owner_id: string;
    email: string;
    managed_wallet: string;
    status: string;
    expires_at: string | null;
  }>(
    `SELECT id, owner_id, email, managed_wallet, status, expires_at
     FROM stripe_beta_sessions
     WHERE session_key_hash = $1`,
    [hash]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  if (row.status !== "active") return null;

  // Check expiry (if set)
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return null;
  }

  return {
    sessionId: row.id,
    ownerId: row.owner_id,
    email: row.email,
    managedWalletAddress: row.managed_wallet,
  };
}
