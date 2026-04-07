/**
 * @asgcard/mcp-server — Wallet-authenticated HTTP client
 *
 * Makes signed requests to the ASGCard API for management operations
 * (list, get, details, freeze, unfreeze) that require wallet authentication.
 *
 * Signing format:
 *   Message: "asgcard-auth:{timestamp}" (UTF-8)
 *   Signature: ed25519 detached, base64-encoded
 *   Headers: X-WALLET-ADDRESS, X-WALLET-SIGNATURE, X-WALLET-TIMESTAMP
 */

import { Keypair, StrKey } from "@stellar/stellar-sdk";
import nacl from "tweetnacl";

export interface WalletClientConfig {
  /** ASGCard API base URL */
  baseUrl: string;
  /** Stellar secret key (S...) for signing */
  privateKey: string;
  /** Request timeout in ms */
  timeout?: number;
}

export interface CardSummary {
  cardId: string;
  nameOnCard: string;
  balance: number;
  status: string;
  createdAt: string;
}

export interface CardDetails {
  cardNumber: string;
  expiryMonth: number;
  expiryYear: number;
  cvv: string;
  billingAddress: {
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
}

export class WalletClient {
  private readonly baseUrl: string;
  private readonly keypair: Keypair;
  private readonly timeout: number;

  constructor(config: WalletClientConfig) {
    this.baseUrl = config.baseUrl;
    this.keypair = Keypair.fromSecret(config.privateKey);
    this.timeout = config.timeout ?? 30_000;
  }

  /** Stellar public key (G...) */
  get address(): string {
    return this.keypair.publicKey();
  }

  /** List all cards for the authenticated wallet */
  async listCards(): Promise<{ cards: CardSummary[] }> {
    return this.authenticatedRequest<{ cards: CardSummary[] }>("GET", "/cards/");
  }

  /** Get a specific card's summary */
  async getCard(cardId: string): Promise<CardSummary> {
    return this.authenticatedRequest<CardSummary>("GET", `/cards/${cardId}`);
  }

  /** Get sensitive card details (PAN, CVV, expiry) */
  async getCardDetails(cardId: string): Promise<CardDetails> {
    return this.authenticatedRequest<CardDetails>("GET", `/cards/${cardId}/details`);
  }

  /** Freeze a card */
  async freezeCard(cardId: string): Promise<{ success: boolean; status: string }> {
    return this.authenticatedRequest<{ success: boolean; status: string }>(
      "POST",
      `/cards/${cardId}/freeze`
    );
  }

  /** Unfreeze a card */
  async unfreezeCard(cardId: string): Promise<{ success: boolean; status: string }> {
    return this.authenticatedRequest<{ success: boolean; status: string }>(
      "POST",
      `/cards/${cardId}/unfreeze`
    );
  }

  /** Get card transaction history from 4payments */
  async getTransactions(cardId: string, page = 1, limit = 20): Promise<{
    cardId: string;
    lastFour?: string;
    transactions: Array<{
      id: string;
      type: string;
      amount: number;
      currency: string;
      status: string;
      description?: string;
      merchantName?: string;
      createdAt: string;
    }>;
    pagination: { page: number; limit: number; total: number; pages: number };
  }> {
    return this.authenticatedRequest("GET", `/cards/${cardId}/transactions?page=${page}&limit=${limit}`);
  }

  /** Get live card balance from 4payments */
  async getBalance(cardId: string): Promise<{
    cardId: string;
    lastFour?: string;
    balance: number;
    currency: string;
    status?: string;
    source: string;
  }> {
    return this.authenticatedRequest("GET", `/cards/${cardId}/balance`);
  }

  // ── Portal / Telegram ────────────────────────────────────

  /** Generate a one-time Telegram deep-link token for wallet binding */
  async getTelegramLinkToken(): Promise<{ deepLink: string; expiresAt: string; message: string }> {
    return this.authenticatedRequest<{ deepLink: string; expiresAt: string; message: string }>(
      "POST",
      "/portal/telegram/link-token"
    );
  }

  /** Get current Telegram binding status for this wallet */
  async getTelegramStatus(): Promise<{ linked: boolean; telegramUserId?: number; linkedAt?: string }> {
    return this.authenticatedRequest<{ linked: boolean; telegramUserId?: number; linkedAt?: string }>(
      "GET",
      "/portal/telegram/status"
    );
  }

  /** Revoke Telegram binding — immediately stops all notifications */
  async revokeTelegram(): Promise<{ revoked: boolean; message: string }> {
    return this.authenticatedRequest<{ revoked: boolean; message: string }>(
      "POST",
      "/portal/telegram/revoke"
    );
  }

  // ── Auth signing ────────────────────────────────────────

  private signAuth(): { address: string; signature: string; timestamp: string } {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = new TextEncoder().encode(`asgcard-auth:${timestamp}`);

    // Get raw ed25519 private key bytes from Stellar keypair
    const rawSecret = this.keypair.rawSecretKey();
    const rawPublic = StrKey.decodeEd25519PublicKey(this.keypair.publicKey());

    // tweetnacl expects 64-byte secret (32-byte private + 32-byte public)
    const fullSecret = new Uint8Array(64);
    fullSecret.set(rawSecret, 0);
    fullSecret.set(rawPublic, 32);

    const signature = nacl.sign.detached(message, fullSecret);

    return {
      address: this.keypair.publicKey(),
      signature: Buffer.from(signature).toString("base64"),
      timestamp: String(timestamp),
    };
  }

  public async authenticatedRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const auth = this.signAuth();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-WALLET-ADDRESS": auth.address,
          "X-WALLET-SIGNATURE": auth.signature,
          "X-WALLET-TIMESTAMP": auth.timestamp,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          `API error ${response.status}: ${JSON.stringify(payload)}`
        );
      }

      return payload as T;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out after ${this.timeout}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
