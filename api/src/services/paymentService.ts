import { facilitatorClient, FacilitatorError } from "./facilitatorClient";
import type { VerifyRequest } from "./facilitatorClient";
import type { TierAmount } from "../types/domain";
import type { PaymentRepository } from "../repositories/types";
import { paymentRepository } from "../repositories/runtime";

// ── Payment verification result ────────────────────────────

export interface PaymentVerifyResult {
    valid: boolean;
    settleId?: string;
    error?: string;
}

export interface VerifyPaymentInput extends VerifyRequest {
    payer: string;
    tierAmount: TierAmount;
}

// ── PaymentService ─────────────────────────────────────────

export class PaymentService {
    private readonly paymentRepo: PaymentRepository;

    constructor(repo: PaymentRepository = paymentRepository) {
        this.paymentRepo = repo;
    }

    /**
     * Verify a payment proof via the facilitator.
     * FAIL-CLOSED: if facilitator is unreachable, reject the request.
     */
    async verifyAndAccept(proof: VerifyPaymentInput): Promise<PaymentVerifyResult> {
        // Anti-replay check
        const existing = await this.paymentRepo.findByTxHash(proof.txHash);
        if (existing) {
            return { valid: false, error: "Transaction hash already used (replay)" };
        }

        try {
            const result = await facilitatorClient.verify({
                txHash: proof.txHash,
                payTo: proof.payTo,
                asset: proof.asset,
                amount: proof.amount,
                network: proof.network
            });

            if (!result.valid) {
                await this.paymentRepo.recordPayment({
                    txHash: proof.txHash,
                    payer: proof.payer,
                    amount: proof.amount,
                    tierAmount: proof.tierAmount,
                    status: "verify_failed",
                    settleId: result.settleId
                });
                return {
                    valid: false,
                    error: result.error ?? "Facilitator rejected payment"
                };
            }

            await this.paymentRepo.recordPayment({
                txHash: proof.txHash,
                payer: proof.payer,
                amount: proof.amount,
                tierAmount: proof.tierAmount,
                status: "verified",
                settleId: result.settleId
            });

            // Enqueue settlement (async, fire-and-forget with error logging)
            if (result.settleId) {
                this.enqueueSettlement(proof.txHash, result.settleId);
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
    private enqueueSettlement(txHash: string, settleId: string): void {
        // Intentionally not awaited — settlement is async per ADR-002
        facilitatorClient
            .settle(settleId)
            .then((result) => {
                if (result.settled) {
                    return this.paymentRepo.markSettled(txHash, settleId);
                }

                return this.paymentRepo.markFailed(txHash, "settle_failed");
            })
            .catch((error) => {
                void this.paymentRepo.markFailed(txHash, "settle_failed");
                console.error(
                    `[PaymentService] Settlement failed for ${settleId}:`,
                    error instanceof Error ? error.message : String(error)
                );
            });
    }
}

// ── Singleton ──────────────────────────────────────────────
export const paymentService = new PaymentService();
