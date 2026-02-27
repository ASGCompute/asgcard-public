import { facilitatorClient, FacilitatorError } from "./facilitatorClient";
import type { VerifyRequest } from "./facilitatorClient";

// ── Anti-replay store (interface for DB in PLAT-003) ───────

export interface TxHashStore {
    has(txHash: string): boolean;
    add(txHash: string): void;
}

class InMemoryTxHashStore implements TxHashStore {
    private used = new Set<string>();

    has(txHash: string): boolean {
        return this.used.has(txHash);
    }

    add(txHash: string): void {
        this.used.add(txHash);
    }
}

// ── Payment verification result ────────────────────────────

export interface PaymentVerifyResult {
    valid: boolean;
    settleId?: string;
    error?: string;
}

// ── PaymentService ─────────────────────────────────────────

export class PaymentService {
    private txHashStore: TxHashStore;

    constructor(txHashStore?: TxHashStore) {
        this.txHashStore = txHashStore ?? new InMemoryTxHashStore();
    }

    /**
     * Verify a payment proof via the facilitator.
     * FAIL-CLOSED: if facilitator is unreachable, reject the request.
     */
    async verifyAndAccept(proof: VerifyRequest): Promise<PaymentVerifyResult> {
        // Anti-replay check
        if (this.txHashStore.has(proof.txHash)) {
            return { valid: false, error: "Transaction hash already used (replay)" };
        }

        try {
            const result = await facilitatorClient.verify(proof);

            if (!result.valid) {
                return {
                    valid: false,
                    error: result.error ?? "Facilitator rejected payment"
                };
            }

            // Mark txHash as used (anti-replay)
            this.txHashStore.add(proof.txHash);

            // Enqueue settlement (async, fire-and-forget with error logging)
            if (result.settleId) {
                this.enqueueSettlement(result.settleId);
            }

            return { valid: true, settleId: result.settleId };
        } catch (error) {
            if (error instanceof FacilitatorError) {
                // FAIL-CLOSED: facilitator errors reject the request
                return {
                    valid: false,
                    error: `Payment verification failed: ${error.message}`
                };
            }
            return {
                valid: false,
                error: "Payment verification failed: internal error"
            };
        }
    }

    /**
     * Async settlement — fire-and-forget with logging.
     * In production, this should be a job queue (Bull/BullMQ).
     */
    private enqueueSettlement(settleId: string): void {
        // Intentionally not awaited — settlement is async per ADR-002
        facilitatorClient.settle(settleId).catch((error) => {
            // TODO [PAY-004]: Add alerting, mark as settle_failed in DB
            console.error(
                `[PaymentService] Settlement failed for ${settleId}:`,
                error instanceof Error ? error.message : String(error)
            );
        });
    }
}

// ── Singleton ──────────────────────────────────────────────
export const paymentService = new PaymentService();
