/**
 * Runtime repository singletons.
 *
 * Controlled by REPO_MODE env var:
 *   - "inmemory" (default): all state in process memory (dev/test)
 *   - "postgres": all state in PostgreSQL (staging/production)
 *
 * Switching is one env var — no service/API contract changes.
 */
import { env } from "../config/env";
import { InMemoryCardRepository } from "./inMemoryCardRepo";
import { InMemoryPaymentRepository } from "./inMemoryPaymentRepo";
import { PostgresCardRepository } from "./pgCardRepo";
import { PostgresPaymentRepository } from "./pgPaymentRepo";
import { PostgresWebhookEventRepository } from "./pgWebhookEventRepo";
import type {
    CardRepository,
    PaymentRepository,
    WebhookEventRepository,
    WebhookEventRecord
} from "./types";

// ── In-memory webhook event store (for inmemory mode) ──────

class InMemoryWebhookEventRepository implements WebhookEventRepository {
    private events = new Map<string, WebhookEventRecord>();

    async store(
        event: Omit<WebhookEventRecord, "id" | "processedAt">
    ): Promise<WebhookEventRecord> {
        // Match Postgres ON CONFLICT (idempotency_key) DO NOTHING semantics
        const existing = this.events.get(event.idempotencyKey);
        if (existing) return existing;

        const record: WebhookEventRecord = {
            ...event,
            id: crypto.randomUUID(),
            processedAt: new Date().toISOString()
        };
        this.events.set(record.idempotencyKey, record);
        return record;
    }

    async findByIdempotencyKey(key: string): Promise<WebhookEventRecord | undefined> {
        return this.events.get(key);
    }
}

// ── Factory ────────────────────────────────────────────────

function createRepositories(): {
    card: CardRepository;
    payment: PaymentRepository;
    webhook: WebhookEventRepository;
} {
    if (env.REPO_MODE === "postgres") {
        console.log("[Repos] Using Postgres repositories");
        return {
            card: new PostgresCardRepository(),
            payment: new PostgresPaymentRepository(),
            webhook: new PostgresWebhookEventRepository()
        };
    }

    console.log("[Repos] Using in-memory repositories");
    return {
        card: new InMemoryCardRepository(),
        payment: new InMemoryPaymentRepository(),
        webhook: new InMemoryWebhookEventRepository()
    };
}

const repos = createRepositories();

export const cardRepository: CardRepository = repos.card;
export const paymentRepository: PaymentRepository = repos.payment;
export const webhookEventRepository: WebhookEventRepository = repos.webhook;
