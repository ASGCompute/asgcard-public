/**
 * CryptoBot Crypto Pay API Client
 *
 * Uses the @CryptoBot (send.tg) API to create payment invoices
 * and verify webhook signatures.
 *
 * Docs: https://help.send.tg/crypto-pay-api
 */

import crypto from "node:crypto";
import { env } from "../../config/env";
import { appLogger } from "../../utils/logger";

const API_BASE = "https://pay.crypt.bot/api";

interface CreateInvoiceParams {
    amount: number;
    asset?: string;          // default "USDT"
    description?: string;
    payload?: string;        // up to 1024 chars, returned in webhook
    paid_btn_name?: string;  // "viewItem" | "openChannel" | "openBot" | "callback"
    paid_btn_url?: string;   // URL opened when user clicks "Return" after payment
}

interface CryptoBotInvoice {
    invoice_id: number;
    hash: string;
    currency_type: string;
    asset: string;
    amount: string;
    status: string;
    bot_invoice_url: string;    // this is the URL user opens to pay — now deprecated
    mini_app_invoice_url: string; // use this to open inline
    web_app_invoice_url: string;
    description?: string;
    payload?: string;
    created_at: string;
}

interface CryptoBotResponse {
    ok: boolean;
    result?: any;
    error?: { code: number; name: string };
}

export class CryptoBotClient {
    private token: string;

    constructor(token?: string) {
        this.token = token || env.CRYPTO_BOT_TOKEN || "";
        if (!this.token) {
            appLogger.warn("CryptoBot token not configured — payments will fail");
        }
    }

    /** Create a payment invoice via CryptoBot API */
    async createInvoice(params: CreateInvoiceParams): Promise<CryptoBotInvoice> {
        const body = {
            asset: params.asset || "USDT",
            amount: String(params.amount),
            description: params.description || "ASG Card Payment",
            payload: params.payload || "",
            paid_btn_name: params.paid_btn_name || "callback",
            paid_btn_url: params.paid_btn_url || "https://t.me/asgcardbot",
        };

        const res = await fetch(`${API_BASE}/createInvoice`, {
            method: "POST",
            headers: {
                "Crypto-Pay-API-Token": this.token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });

        const data: CryptoBotResponse = await res.json();

        if (!data.ok) {
            appLogger.error({ err: data.error }, "[CryptoBot] createInvoice failed");
            throw new Error(`CryptoBot error: ${data.error?.name || "unknown"}`);
        }

        appLogger.info({ invoiceId: data.result.invoice_id }, "[CryptoBot] Invoice created");
        return data.result as CryptoBotInvoice;
    }

    /** Verify the HMAC-SHA-256 signature on incoming webhooks */
    static verifySignature(token: string, body: string, signature: string): boolean {
        const secret = crypto.createHash("sha256").update(token).digest();
        const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
        return hmac === signature;
    }
}
