import { env } from "../config/env";

// ── Types ──────────────────────────────────────────────────

export interface VerifyRequest {
    txHash: string;
    payTo: string;
    asset: string;
    amount: string;
    network: string;
}

export interface VerifyResponse {
    valid: boolean;
    settleId?: string;
    error?: string;
}

export interface SettleResponse {
    settled: boolean;
    error?: string;
}

export class FacilitatorError extends Error {
    constructor(
        message: string,
        public readonly statusCode?: number,
        public readonly retryable: boolean = false
    ) {
        super(message);
        this.name = "FacilitatorError";
    }
}

// ── Retry helper ───────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async <T>(
    fn: () => Promise<T>,
    maxRetries: number,
    backoffMs: number[]
): Promise<T> => {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (error instanceof FacilitatorError && !error.retryable) {
                throw error;
            }

            if (attempt < maxRetries) {
                const delay = backoffMs[attempt] ?? backoffMs[backoffMs.length - 1] ?? 1000;
                await sleep(delay);
            }
        }
    }

    throw lastError ?? new FacilitatorError("Max retries exceeded", undefined, false);
};

// ── FacilitatorClient ──────────────────────────────────────

export class FacilitatorClient {
    private baseUrl: string;
    private apiKey: string;
    private timeoutMs: number;
    private maxRetries: number;

    constructor(config?: {
        baseUrl?: string;
        apiKey?: string;
        timeoutMs?: number;
        maxRetries?: number;
    }) {
        this.baseUrl = config?.baseUrl ?? env.FACILITATOR_URL;
        this.apiKey = config?.apiKey ?? env.FACILITATOR_API_KEY;
        this.timeoutMs = config?.timeoutMs ?? env.FACILITATOR_TIMEOUT_MS;
        this.maxRetries = config?.maxRetries ?? env.FACILITATOR_MAX_RETRIES;
    }

    async verify(request: VerifyRequest): Promise<VerifyResponse> {
        return withRetry(
            () => this.doVerify(request),
            this.maxRetries,
            [1000, 3000]  // 1s, 3s backoff per ADR-002
        );
    }

    async settle(settleId: string): Promise<SettleResponse> {
        return withRetry(
            () => this.doSettle(settleId),
            5,  // settle has more retries per ADR-002
            [2000, 4000, 8000, 16000, 30000]
        );
    }

    private async doVerify(request: VerifyRequest): Promise<VerifyResponse> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
            const response = await fetch(`${this.baseUrl}/verify`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`,
                    "X-Facilitator-Version": "1"
                },
                body: JSON.stringify(request),
                signal: controller.signal
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new FacilitatorError(
                    `Facilitator verify failed: ${response.status} ${body}`,
                    response.status,
                    response.status >= 500  // Server errors are retryable
                );
            }

            return (await response.json()) as VerifyResponse;
        } catch (error) {
            if (error instanceof FacilitatorError) throw error;

            if (error instanceof Error && error.name === "AbortError") {
                throw new FacilitatorError(
                    `Facilitator verify timeout after ${this.timeoutMs}ms`,
                    undefined,
                    true  // Timeouts are retryable
                );
            }

            throw new FacilitatorError(
                `Facilitator verify network error: ${error instanceof Error ? error.message : String(error)}`,
                undefined,
                true  // Network errors are retryable
            );
        } finally {
            clearTimeout(timeout);
        }
    }

    private async doSettle(settleId: string): Promise<SettleResponse> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s for settle

        try {
            const response = await fetch(`${this.baseUrl}/settle`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.apiKey}`,
                    "X-Facilitator-Version": "1"
                },
                body: JSON.stringify({ settleId }),
                signal: controller.signal
            });

            if (!response.ok) {
                const body = await response.text().catch(() => "");
                throw new FacilitatorError(
                    `Facilitator settle failed: ${response.status} ${body}`,
                    response.status,
                    response.status >= 500
                );
            }

            return (await response.json()) as SettleResponse;
        } catch (error) {
            if (error instanceof FacilitatorError) throw error;

            if (error instanceof Error && error.name === "AbortError") {
                throw new FacilitatorError(
                    "Facilitator settle timeout after 10000ms",
                    undefined,
                    true
                );
            }

            throw new FacilitatorError(
                `Facilitator settle network error: ${error instanceof Error ? error.message : String(error)}`,
                undefined,
                true
            );
        } finally {
            clearTimeout(timeout);
        }
    }
}

// ── Singleton ──────────────────────────────────────────────
export const facilitatorClient = new FacilitatorClient();
