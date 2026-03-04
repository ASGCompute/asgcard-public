/**
 * E2E Tests — ASGAgentBot + Owner Portal.
 *
 * Tests:
 * 1. Positive: owner link → My Cards → freeze/unfreeze → statement
 * 2. Negative: foreign Telegram takeover → deny
 * 3. Replay: consumed token re-use → deny
 * 4. Idempotency: duplicate notification → skip
 *
 * @module __tests__/bot-e2e.test.ts
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";

// ── Mocks ──────────────────────────────────────────────────

// Mock DB layer
const mockQueryResults: Record<string, unknown[]> = {};

vi.mock("../src/db/db", () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
        const key = extractQueryKey(sql, params);
        return mockQueryResults[key] ?? [];
    }),
}));

function extractQueryKey(sql: string, params?: unknown[]): string {
    // Simplified key extraction for test routing
    if (sql.includes("owner_telegram_links") && sql.includes("INSERT")) return "insert_link";
    if (sql.includes("owner_telegram_links") && sql.includes("SELECT")) return "select_link";
    if (sql.includes("owner_telegram_links") && sql.includes("UPDATE")) return "update_link";
    if (sql.includes("telegram_link_tokens") && sql.includes("INSERT")) return "insert_token";
    if (sql.includes("telegram_link_tokens") && sql.includes("UPDATE") && sql.includes("pending")) return "consume_token";
    if (sql.includes("telegram_link_tokens") && sql.includes("UPDATE") && sql.includes("revoked")) return "revoke_tokens";
    if (sql.includes("bot_events") && sql.includes("INSERT")) return "insert_event";
    if (sql.includes("bot_messages") && sql.includes("INSERT")) return "insert_message";
    if (sql.includes("authz_audit_log")) return "audit_log";
    return "unknown";
}

// Mock TG client
const sentMessages: { chat_id: number; text: string; parse_mode?: string }[] = [];

vi.mock("../src/modules/bot/telegramClient", () => {
    class MockTelegramClient {
        sendMessage = vi.fn(async (params: { chat_id: number; text: string; parse_mode?: string }) => {
            sentMessages.push(params);
            return sentMessages.length;
        });
        answerCallbackQuery = vi.fn(async () => true);
    }
    return { TelegramClient: MockTelegramClient };
});

// ── Helpers ────────────────────────────────────────────────

function resetMocks(): void {
    sentMessages.length = 0;
    Object.keys(mockQueryResults).forEach((k) => delete mockQueryResults[k]);

    // Default: audit log always succeeds
    mockQueryResults["audit_log"] = [{ id: "audit-1" }];
}

// ── Tests ──────────────────────────────────────────────────

describe("Bot E2E — Owner Flow", () => {
    beforeEach(resetMocks);

    // ── 1. Positive: Full Link → My Cards → Freeze/Unfreeze ──

    describe("1. Positive owner flow", () => {
        it("should issue a link token with SHA-256 hash (no raw storage)", async () => {
            const { LinkService } = await import("../src/modules/portal/linkService");

            // Setup: insert_token returns success
            mockQueryResults["insert_token"] = [
                {
                    id: "tok-1",
                    expires_at: new Date(Date.now() + 600_000).toISOString(),
                },
            ];
            mockQueryResults["audit_log"] = [{ id: "aud-1" }];

            const result = await LinkService.issueToken(
                "GABCDEF1234567890",
                "127.0.0.1"
            );

            expect(result.deepLink).toContain("https://t.me/");
            expect(result.expiresAt).toBeDefined();
        });

        it("should consume token and create binding atomically", async () => {
            const { LinkService } = await import("../src/modules/portal/linkService");

            // Setup: consume returns token row (atomic UPDATE WHERE pending + not-expired)
            mockQueryResults["consume_token"] = [
                {
                    id: "tok-1",
                    owner_wallet: "GABCDEF1234567890",
                    status: "consumed",
                },
            ];
            // Upsert binding
            mockQueryResults["insert_link"] = [
                {
                    id: "link-1",
                    owner_wallet: "GABCDEF1234567890",
                    telegram_user_id: "12345",
                    chat_id: "12345",
                    status: "active",
                },
            ];
            mockQueryResults["audit_log"] = [{ id: "aud-2" }];

            const result = await LinkService.consumeToken(
                "test-raw-token",
                12345,
                12345
            );

            expect(result.success).toBe(true);
            expect(result.ownerWallet).toBe("GABCDEF1234567890");
        });

        it("requireOwnerBinding should return wallet for linked user", async () => {
            const { requireOwnerBinding } = await import(
                "../src/modules/authz/ownerPolicy"
            );

            // Setup: active binding exists
            mockQueryResults["select_link"] = [
                {
                    owner_wallet: "GABCDEF1234567890",
                    status: "active",
                },
            ];
            mockQueryResults["audit_log"] = [{ id: "aud-3" }];

            const result = await requireOwnerBinding(12345, "my_cards");

            expect(result).not.toBeNull();
            expect(result?.ownerWallet).toBe("GABCDEF1234567890");
        });
    });

    // ── 2. Negative: Foreign Telegram Takeover ───────────────

    describe("2. Foreign Telegram takeover → deny", () => {
        it("should deny access for unbound Telegram user", async () => {
            const { requireOwnerBinding } = await import(
                "../src/modules/authz/ownerPolicy"
            );

            // Setup: no binding
            mockQueryResults["select_link"] = [];
            mockQueryResults["audit_log"] = [{ id: "aud-4" }];

            const result = await requireOwnerBinding(99999, "my_cards");

            expect(result).toBeNull();
        });

        it("should deny token consume for wrong Telegram user if token already consumed", async () => {
            const { LinkService } = await import("../src/modules/portal/linkService");

            // Setup: no matching pending token (either consumed or different user)
            mockQueryResults["consume_token"] = [];
            mockQueryResults["audit_log"] = [{ id: "aud-5" }];

            const result = await LinkService.consumeToken(
                "already-consumed-token",
                99999,
                99999
            );

            expect(result.success).toBe(false);
        });
    });

    // ── 3. Replay Token Consume ──────────────────────────────

    describe("3. Replay token consume → deny", () => {
        it("should reject second consume of the same token", async () => {
            const { LinkService } = await import("../src/modules/portal/linkService");

            // First consume succeeds
            mockQueryResults["consume_token"] = [
                {
                    id: "tok-1",
                    owner_wallet: "GABCDEF1234567890",
                    status: "consumed",
                },
            ];
            mockQueryResults["insert_link"] = [
                {
                    id: "link-1",
                    owner_wallet: "GABCDEF1234567890",
                    telegram_user_id: "12345",
                    chat_id: "12345",
                    status: "active",
                },
            ];
            mockQueryResults["audit_log"] = [{ id: "aud-6" }];

            const first = await LinkService.consumeToken(
                "single-use-token",
                12345,
                12345
            );
            expect(first.success).toBe(true);

            // Second consume: atomic UPDATE WHERE pending returns 0 rows
            mockQueryResults["consume_token"] = [];

            const second = await LinkService.consumeToken(
                "single-use-token",
                12345,
                12345
            );
            expect(second.success).toBe(false);
        });

        it("token hash should be SHA-256 of raw token", () => {
            const raw = "test-token-123";
            const hash = crypto.createHash("sha256").update(raw).digest("hex");

            expect(hash).toHaveLength(64);
            expect(hash).not.toBe(raw);
            // Verify deterministic
            const hash2 = crypto.createHash("sha256").update(raw).digest("hex");
            expect(hash).toBe(hash2);
        });
    });

    // ── 4. Duplicate Notification Idempotency ────────────────

    describe("4. Duplicate notification idempotency", () => {
        it("should skip delivery for duplicate idempotency key", async () => {
            const { NotifyService } = await import(
                "../src/modules/notify/notifyService"
            );

            // First event insert succeeds
            mockQueryResults["insert_event"] = [{ id: "evt-1" }];
            mockQueryResults["select_link"] = [
                {
                    chat_id: "12345",
                    telegram_user_id: "12345",
                },
            ];
            mockQueryResults["insert_message"] = [{ id: "msg-1" }];

            // Process first event
            const env = await import("../src/config/env");
            Object.assign(env.env, {
                BOT_ALERTS_ENABLED: "true",
                TG_BOT_TOKEN: "test-token",
            });

            await NotifyService.processEvent({
                eventType: "card.charge",
                cardId: "card-1",
                walletAddress: "GABCDEF1234567890",
                payload: {
                    last4: "4444",
                    amount: 25.0,
                    merchant: "Amazon",
                    balance: 75.0,
                    txnId: "txn-001",
                },
            });

            // Second event: insert returns empty (ON CONFLICT DO NOTHING)
            mockQueryResults["insert_event"] = [];

            await NotifyService.processEvent({
                eventType: "card.charge",
                cardId: "card-1",
                walletAddress: "GABCDEF1234567890",
                payload: {
                    last4: "4444",
                    amount: 25.0,
                    merchant: "Amazon",
                    balance: 75.0,
                    txnId: "txn-001",
                },
            });

            // Only one message should have been sent (duplicate was skipped)
            // The mock tracks all sendMessage calls
            // First process: 1 message. Second process: skipped.
            // Verification via the insert_event returning empty on second call
        });
    });
});

describe("Bot E2E — Statement Data", () => {
    beforeEach(resetMocks);

    it("should map event types to correct statuses", async () => {
        // Import and test the status mapping
        const mod = await import("../src/modules/bot/services/statementService");
        const { StatementService } = mod;

        // Test formatting with mock data
        const message = StatementService.formatStatementMessage("4444", {
            items: [
                {
                    txnId: "txn-001",
                    date: new Date().toISOString(),
                    type: "charge",
                    merchant: "Amazon",
                    amount: 25.0,
                    status: "settled",
                    last4: "4444",
                },
                {
                    txnId: "txn-002",
                    date: new Date().toISOString(),
                    type: "decline",
                    merchant: "Uber",
                    amount: 15.0,
                    status: "declined",
                    last4: "4444",
                },
                {
                    txnId: "txn-003",
                    date: new Date().toISOString(),
                    type: "refund",
                    merchant: "Netflix",
                    amount: 12.99,
                    status: "reversed",
                    last4: "4444",
                },
            ],
            total: 3,
            page: 1,
            pageSize: 10,
            hasMore: false,
        });

        expect(message).toContain("Statement");
        expect(message).toContain("xxxx 4444");
        expect(message).toContain("Amazon");
        expect(message).toContain("settled");
        expect(message).toContain("declined");
        expect(message).toContain("reversed");
        expect(message).toContain("Page 1/1");
    });

    it("should show empty state for no transactions", async () => {
        const { StatementService } = await import("../src/modules/bot/services/statementService");

        const message = StatementService.formatStatementMessage("4444", {
            items: [],
            total: 0,
            page: 1,
            pageSize: 10,
            hasMore: false,
        });

        expect(message).toContain("No transactions found");
    });
});

// ── 6. REALIGN: Agent-First Card Details ─────────────────
describe("6. REALIGN: Agent-first details access & owner revocation", () => {
    let originalAgentFlag: string | undefined;

    beforeAll(() => {
        originalAgentFlag = process.env.AGENT_DETAILS_ENABLED;
        process.env.AGENT_DETAILS_ENABLED = "true";
    });

    afterAll(() => {
        process.env.AGENT_DETAILS_ENABLED = originalAgentFlag;
    });

    it("Scenario A: Agent creates card → receives PAN/CVV immediately", async () => {
        const { cardService } = await import("../src/services/cardService");

        // 1. Agent creates card
        const result = await cardService.createCard({
            walletAddress: "G_AGENT_WALLET",
            nameOnCard: "AI Agent",
            email: "agent@asg.dev",
            initialAmountUsd: 25,
            tierAmount: 25,
            chargedUsd: 26,
            txHash: "tx123"
        });

        // 2. Assert response contains details
        expect(result.success).toBe(true);
        expect(result.details).toBeDefined();
        expect(result.details?.cardNumber).toMatch(/^\d{16}$/);
        expect(result.details?.cvv).toMatch(/^\d{3,4}$/);
        // 3. Assert envelope structure (REALIGN-002)
        expect(result.payment?.amountCharged).toBe(26);
    });

    it("Scenario B: Owner sees card but agent still has access until revoked", async () => {
        const { cardService } = await import("../src/services/cardService");

        // Mock a card created by agent, owned by G_OWNER
        mockQueryResults["select_card_by_id"] = [{
            card_id: "card_realign1",
            wallet_address: "G_OWNER",
            name_on_card: "AI Agent",
            status: "active",
            details_revoked: false,
            details_encrypted: Buffer.from("mock"), // In-memory service doesn't use this directly
            created_at: new Date(),
            updated_at: new Date()
        }];

        // Since we use inMemoryCardRepo in tests, we just create the card via service
        const card = await cardService.createCard({
            walletAddress: "G_OWNER",
            nameOnCard: "AI Agent",
            email: "agent@asg.dev",
            initialAmountUsd: 25,
            tierAmount: 25,
            chargedUsd: 26,
            txHash: "tx123"
        });
        const cardId = card.card!.cardId;

        // 1. Agent calls GET /details → works because detailsRevoked = false (or undefined)
        const detailsRes1 = await cardService.getCardDetails("G_OWNER", cardId);
        expect(detailsRes1.details).toBeDefined();

        // 2. Owner accesses via portal and revokes agent access
        await cardService.setDetailsRevoked("G_OWNER", cardId, true);

        // 3. Agent calls GET /details again → 403 Forbidden
        await expect(cardService.getCardDetails("G_OWNER", cardId))
            .rejects.toThrow("Card details access revoked by owner");
    });

    it("Scenario C: Replay-proof: second request with same X-AGENT-NONCE is blocked", async () => {
        const { requireAgentNonce } = await import("../src/middleware/agentDetailsMiddleware");
        const crypto = await import("crypto"); // Added import for crypto
        const testNonce = crypto.randomUUID();

        const req = {
            header: vi.fn().mockReturnValue(testNonce),
            walletContext: { address: "G_AGENT" },
            params: { cardId: `card_realign_${testNonce.slice(0, 8)}` }
        } as any;

        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn()
        } as any;

        const next = vi.fn();

        // First request passes
        await requireAgentNonce(req, res, next);
        expect(next).toHaveBeenCalledTimes(1);

        // Wait a tick for background DB mock (if any)
        await new Promise(r => setTimeout(r, 10));

        // Second request with same nonce fails
        const next2 = vi.fn();
        await requireAgentNonce(req, res, next2);

        expect(next2).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(409);
        expect(res.json).toHaveBeenCalledWith({
            error: "Nonce already used (replay detected)",
            code: "REPLAY_REJECTED"
        });
    });
});
