/**
 * Payment Request Approval — Happy-Path Integration Test
 *
 * Tests the full lifecycle:
 *   create request → approve → complete → poll → completed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../src/db/db", () => ({
  query: vi.fn(),
}));

vi.mock("../src/utils/logger", () => ({
  appLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { query } from "../src/db/db";
const mockQuery = vi.mocked(query);

import {
  createPaymentRequest,
  getPaymentRequest,
  getPaymentRequestByToken,
  approvePaymentRequest,
  completePaymentRequest,
} from "../src/services/paymentRequestService";

describe("Payment Request — Happy Path E2E", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("create → approve → complete → poll → completed", async () => {
    // ── 1. Create payment request ──
    mockQuery.mockResolvedValueOnce([] as never); // INSERT

    const created = await createPaymentRequest({
      sessionId: "sess_abc123",
      ownerId: "owner_xyz",
      email: "owner@example.com",
      amountUsd: 25,
      description: "Create card for VM hosting agent",
      nameOnCard: "AI Agent Alpha",
      phone: "+1234567890",
    });

    expect(created.requestId).toMatch(/^pr_/);
    expect(created.approvalUrl).toContain("stripe.asgcard.dev/approve");
    expect(created.approvalUrl).toContain(created.requestId);
    expect(created.approvalToken).toBeTruthy();

    // Extract the token hash that was stored (first call, 9th param)
    const insertCall = mockQuery.mock.calls[0];
    const storedHash = insertCall[1]![8]; // approval_token_hash
    expect(storedHash).toBeTruthy();

    // ── 2. Approve the request ──
    // approvePaymentRequest queries UPDATE ... RETURNING id
    mockQuery.mockResolvedValueOnce([{ id: created.requestId }] as never);

    const approved = await approvePaymentRequest(
      created.requestId,
      created.approvalToken
    );
    expect(approved).toBe(true);

    // ── 3. Complete the request (simulating post-payment) ──
    mockQuery.mockResolvedValueOnce([] as never); // UPDATE

    await completePaymentRequest(
      created.requestId,
      "card_test_123",
      "pi_test_abc",
      {
        success: true,
        card: { cardId: "card_test_123", status: "active", balance: 25 },
        payment: { txHash: "pi_test_abc", amount: 25 },
      }
    );

    // Verify the UPDATE was called with completed status
    const completeCall = mockQuery.mock.calls[2];
    expect(completeCall[0]).toContain("status = 'completed'");
    expect(completeCall[1]).toContain("card_test_123"); // card_id
    expect(completeCall[1]).toContain("pi_test_abc"); // stripe_pi_id

    // ── 4. Poll → completed ──
    const completedRow = {
      id: created.requestId,
      session_id: "sess_abc123",
      owner_id: "owner_xyz",
      email: "owner@example.com",
      amount_usd: "25.00",
      description: "Create card for VM hosting agent",
      status: "completed",
      name_on_card: "AI Agent Alpha",
      phone: "+1234567890",
      approval_token_hash: storedHash,
      stripe_pi_id: "pi_test_abc",
      card_id: "card_test_123",
      result_json: {
        success: true,
        card: { cardId: "card_test_123", status: "active", balance: 25 },
        payment: { txHash: "pi_test_abc", amount: 25 },
      },
      created_at: new Date().toISOString(),
      approved_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    };

    mockQuery.mockResolvedValueOnce([completedRow] as never);

    const polled = await getPaymentRequest(created.requestId, "owner_xyz");
    expect(polled).not.toBeNull();
    expect(polled!.status).toBe("completed");
    expect(polled!.cardId).toBe("card_test_123");
    expect(polled!.resultJson).toMatchObject({
      success: true,
      card: { cardId: "card_test_123" },
    });
  });
});
