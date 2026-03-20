/**
 * Payment Request Service
 *
 * Manages the lifecycle of owner-approval payment requests:
 *   - Agent creates a request (POST /payment-requests)
 *   - Owner approves via one-time URL (GET/POST /approve/:id)
 *   - Agent polls for completion (GET /payment-requests/:id)
 *
 * Approval tokens are random 32-byte URL-safe strings, hashed before storage.
 * Requests expire after DEFAULT_TTL_MS (1 hour).
 */
import crypto from "node:crypto";
import { query } from "../db/db";
import { appLogger } from "../utils/logger";

// ── Constants ────────────────────────────────────────────────
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Helpers ──────────────────────────────────────────────────
function generateRequestId(): string {
  return `pr_${crypto.randomBytes(12).toString("base64url")}`;
}

function generateApprovalToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ── Types ────────────────────────────────────────────────────
export type PaymentRequestStatus =
  | "pending"
  | "approved"
  | "completed"
  | "failed"
  | "rejected"
  | "expired";

export interface PaymentRequest {
  id: string;
  sessionId: string;
  ownerId: string;
  email: string;
  amountUsd: number;
  description: string | null;
  status: PaymentRequestStatus;
  nameOnCard: string | null;
  phone: string | null;
  stripePiId: string | null;
  cardId: string | null;
  resultJson: Record<string, unknown> | null;
  createdAt: string;
  approvedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
}

export interface CreatePaymentRequestInput {
  sessionId: string;
  ownerId: string;
  email: string;
  amountUsd: number;
  description?: string;
  nameOnCard?: string;
  phone?: string;
}

export interface CreatePaymentRequestResult {
  requestId: string;
  approvalUrl: string;
  approvalToken: string; // raw — for the approval URL only
  expiresAt: string;
}

// ── Public API ───────────────────────────────────────────────

/**
 * Create a new payment request.
 * Returns the request ID and one-time approval URL.
 */
export async function createPaymentRequest(
  input: CreatePaymentRequestInput
): Promise<CreatePaymentRequestResult> {
  const requestId = generateRequestId();
  const approvalToken = generateApprovalToken();
  const tokenHash = hashToken(approvalToken);
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS).toISOString();

  await query(
    `INSERT INTO stripe_payment_requests
       (id, session_id, owner_id, email, amount_usd, description, name_on_card, phone,
        approval_token_hash, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)`,
    [
      requestId,
      input.sessionId,
      input.ownerId,
      input.email,
      input.amountUsd,
      input.description || null,
      input.nameOnCard || null,
      input.phone || null,
      tokenHash,
      expiresAt,
    ]
  );

  const approvalUrl = `https://stripe.asgcard.dev/approve?id=${requestId}&token=${approvalToken}`;

  appLogger.info(
    { requestId, ownerId: input.ownerId, amountUsd: input.amountUsd },
    "[PAYMENT-REQUEST] Created"
  );

  return { requestId, approvalUrl, approvalToken, expiresAt };
}

/**
 * Get a payment request by ID.
 * If ownerId is provided, enforces owner match.
 * Automatically marks expired requests.
 */
export async function getPaymentRequest(
  requestId: string,
  ownerId?: string
): Promise<PaymentRequest | null> {
  const rows = await query<{
    id: string;
    session_id: string;
    owner_id: string;
    email: string;
    amount_usd: string;
    description: string | null;
    status: PaymentRequestStatus;
    name_on_card: string | null;
    phone: string | null;
    approval_token_hash: string;
    stripe_pi_id: string | null;
    card_id: string | null;
    result_json: Record<string, unknown> | null;
    created_at: string;
    approved_at: string | null;
    completed_at: string | null;
    expires_at: string;
  }>(
    `SELECT * FROM stripe_payment_requests WHERE id = $1`,
    [requestId]
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  // Enforce owner match if requested
  if (ownerId && row.owner_id !== ownerId) return null;

  // Auto-expire
  if (row.status === "pending" && new Date(row.expires_at) < new Date()) {
    await query(
      `UPDATE stripe_payment_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
      [requestId]
    );
    row.status = "expired";
  }

  return mapRow(row);
}

/**
 * Get a payment request by ID + approval token (for owner approval page).
 * Does NOT require session auth — token is the auth.
 */
export async function getPaymentRequestByToken(
  requestId: string,
  approvalToken: string
): Promise<PaymentRequest | null> {
  const tokenHash = hashToken(approvalToken);

  const rows = await query<{
    id: string;
    session_id: string;
    owner_id: string;
    email: string;
    amount_usd: string;
    description: string | null;
    status: PaymentRequestStatus;
    name_on_card: string | null;
    phone: string | null;
    approval_token_hash: string;
    stripe_pi_id: string | null;
    card_id: string | null;
    result_json: Record<string, unknown> | null;
    created_at: string;
    approved_at: string | null;
    completed_at: string | null;
    expires_at: string;
  }>(
    `SELECT * FROM stripe_payment_requests WHERE id = $1 AND approval_token_hash = $2`,
    [requestId, tokenHash]
  );

  if (rows.length === 0) return null;
  const row = rows[0];

  // Auto-expire
  if (row.status === "pending" && new Date(row.expires_at) < new Date()) {
    await query(
      `UPDATE stripe_payment_requests SET status = 'expired' WHERE id = $1 AND status = 'pending'`,
      [requestId]
    );
    row.status = "expired";
  }

  return mapRow(row);
}

/**
 * Mark a payment request as approved.
 * Returns true if the transition was valid (pending → approved).
 */
export async function approvePaymentRequest(
  requestId: string,
  approvalToken: string
): Promise<boolean> {
  const tokenHash = hashToken(approvalToken);

  const result = await query(
    `UPDATE stripe_payment_requests
     SET status = 'approved', approved_at = NOW()
     WHERE id = $1 AND approval_token_hash = $2 AND status = 'pending'
       AND expires_at > NOW()
     RETURNING id`,
    [requestId, tokenHash]
  );

  if (result.length === 0) return false;

  appLogger.info({ requestId }, "[PAYMENT-REQUEST] Approved by owner");
  return true;
}

/**
 * Complete a payment request after successful card creation.
 */
export async function completePaymentRequest(
  requestId: string,
  cardId: string,
  stripePiId: string,
  resultJson: Record<string, unknown>
): Promise<void> {
  await query(
    `UPDATE stripe_payment_requests
     SET status = 'completed', completed_at = NOW(),
         card_id = $2, stripe_pi_id = $3, result_json = $4
     WHERE id = $1 AND status = 'approved'`,
    [requestId, cardId, stripePiId, JSON.stringify(resultJson)]
  );

  appLogger.info({ requestId, cardId }, "[PAYMENT-REQUEST] Completed");
}

/**
 * Mark a payment request as failed.
 */
export async function failPaymentRequest(
  requestId: string,
  error: string
): Promise<void> {
  await query(
    `UPDATE stripe_payment_requests
     SET status = 'failed', result_json = $2
     WHERE id = $1 AND status IN ('pending', 'approved')`,
    [requestId, JSON.stringify({ error })]
  );

  appLogger.warn({ requestId, error }, "[PAYMENT-REQUEST] Failed");
}

/**
 * Reject a payment request.
 */
export async function rejectPaymentRequest(
  requestId: string,
  approvalToken: string
): Promise<boolean> {
  const tokenHash = hashToken(approvalToken);

  const result = await query(
    `UPDATE stripe_payment_requests
     SET status = 'rejected'
     WHERE id = $1 AND approval_token_hash = $2 AND status = 'pending'
     RETURNING id`,
    [requestId, tokenHash]
  );

  if (result.length === 0) return false;

  appLogger.info({ requestId }, "[PAYMENT-REQUEST] Rejected by owner");
  return true;
}

// ── Row mapper ───────────────────────────────────────────────
function mapRow(row: Record<string, unknown>): PaymentRequest {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    ownerId: row.owner_id as string,
    email: row.email as string,
    amountUsd: parseFloat(row.amount_usd as string),
    description: (row.description as string) || null,
    status: row.status as PaymentRequestStatus,
    nameOnCard: (row.name_on_card as string) || null,
    phone: (row.phone as string) || null,
    stripePiId: (row.stripe_pi_id as string) || null,
    cardId: (row.card_id as string) || null,
    resultJson: (row.result_json as Record<string, unknown>) || null,
    createdAt: row.created_at as string,
    approvedAt: (row.approved_at as string) || null,
    completedAt: (row.completed_at as string) || null,
    expiresAt: row.expires_at as string,
  };
}
