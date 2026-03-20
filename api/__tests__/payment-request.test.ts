/**
 * Payment Request Approval — Integration Tests
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
  rejectPaymentRequest,
  completePaymentRequest,
} from "../src/services/paymentRequestService";

describe("paymentRequestService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createPaymentRequest", () => {
    it("should insert a new payment request and return approval URL", async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await createPaymentRequest({
        sessionId: "sess_abc",
        ownerId: "owner_123",
        email: "test@example.com",
        amountUsd: 25,
        description: "Test card",
      });

      expect(result.requestId).toMatch(/^pr_/);
      expect(result.approvalUrl).toContain("stripe.asgcard.dev/approve");
      expect(result.approvalUrl).toContain(result.requestId);
      expect(result.approvalToken).toBeTruthy();
      expect(result.expiresAt).toBeTruthy();

      // Should have called INSERT
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("INSERT INTO stripe_payment_requests");
    });
  });

  describe("getPaymentRequest", () => {
    const mockRow = {
      id: "pr_test",
      session_id: "sess_abc",
      owner_id: "owner_123",
      email: "test@example.com",
      amount_usd: "25.00",
      description: "Test card",
      status: "pending",
      name_on_card: "Test",
      phone: null,
      approval_token_hash: "abc",
      stripe_pi_id: null,
      card_id: null,
      result_json: null,
      created_at: new Date().toISOString(),
      approved_at: null,
      completed_at: null,
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    };

    it("should return the request if found", async () => {
      mockQuery.mockResolvedValueOnce([mockRow] as never);

      const result = await getPaymentRequest("pr_test");
      expect(result).not.toBeNull();
      expect(result!.id).toBe("pr_test");
      expect(result!.amountUsd).toBe(25);
      expect(result!.status).toBe("pending");
    });

    it("should return null if owner doesn't match", async () => {
      mockQuery.mockResolvedValueOnce([mockRow] as never);

      const result = await getPaymentRequest("pr_test", "owner_wrong");
      expect(result).toBeNull();
    });

    it("should return null if not found", async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await getPaymentRequest("pr_nonexistent");
      expect(result).toBeNull();
    });

    it("should auto-expire pending requests past expiry", async () => {
      const expiredRow = {
        ...mockRow,
        expires_at: new Date(Date.now() - 1000).toISOString(),
      };
      mockQuery.mockResolvedValueOnce([expiredRow] as never);
      mockQuery.mockResolvedValueOnce([] as never); // UPDATE

      const result = await getPaymentRequest("pr_test");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("expired");
    });
  });

  describe("approvePaymentRequest", () => {
    it("should return true on valid approval", async () => {
      mockQuery.mockResolvedValueOnce([{ id: "pr_test" }] as never);

      const result = await approvePaymentRequest("pr_test", "valid_token");
      expect(result).toBe(true);
    });

    it("should return false if request not found or already processed", async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await approvePaymentRequest("pr_test", "bad_token");
      expect(result).toBe(false);
    });
  });

  describe("rejectPaymentRequest", () => {
    it("should return true on valid rejection", async () => {
      mockQuery.mockResolvedValueOnce([{ id: "pr_test" }] as never);

      const result = await rejectPaymentRequest("pr_test", "valid_token");
      expect(result).toBe(true);
    });

    it("should return false if request not found", async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      const result = await rejectPaymentRequest("pr_test", "bad_token");
      expect(result).toBe(false);
    });
  });

  describe("completePaymentRequest", () => {
    it("should update status to completed with card details", async () => {
      mockQuery.mockResolvedValueOnce([] as never);

      await completePaymentRequest("pr_test", "card_123", "pi_abc", {
        success: true,
        card: { cardId: "card_123" },
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain("status = 'completed'");
    });
  });
});
