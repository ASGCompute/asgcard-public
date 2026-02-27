import { Connection, Keypair } from "@solana/web3.js";
import { ApiError, TimeoutError } from "./errors";
import type {
  ASGCardClientConfig,
  CardResult,
  CreateCardParams,
  FundCardParams,
  FundResult,
  HealthResponse,
  TierResponse
} from "./types";
import { handleX402Payment } from "./utils/x402";
import { decodeSolanaSecretKey } from "./utils/solana";

const DEFAULT_BASE_URL = "https://api.asgcard.dev";
const DEFAULT_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEFAULT_TIMEOUT = 60_000;

export class ASGCardClient {
  private readonly baseUrl: string;

  private readonly timeout: number;

  private readonly connection: Connection;

  private readonly keypair?: Keypair;

  private readonly walletAdapter?: ASGCardClientConfig["walletAdapter"];

  constructor(config: ASGCardClientConfig) {
    if (!config.privateKey && !config.walletAdapter) {
      throw new Error("Provide either privateKey or walletAdapter");
    }

    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;
    this.connection = new Connection(config.rpcUrl ?? DEFAULT_RPC_URL, "confirmed");

    if (config.privateKey) {
      this.keypair = Keypair.fromSecretKey(decodeSolanaSecretKey(config.privateKey));
    }

    this.walletAdapter = config.walletAdapter;
  }

  get address(): string {
    if (this.keypair) {
      return this.keypair.publicKey.toBase58();
    }

    return this.walletAdapter!.publicKey.toBase58();
  }

  async createCard(params: CreateCardParams): Promise<CardResult> {
    return this.requestWithX402<CardResult>(`/cards/create/tier/${params.amount}`, {
      method: "POST",
      body: JSON.stringify({
        nameOnCard: params.nameOnCard,
        email: params.email
      })
    });
  }

  async fundCard(params: FundCardParams): Promise<FundResult> {
    return this.requestWithX402<FundResult>(`/cards/fund/tier/${params.amount}`, {
      method: "POST",
      body: JSON.stringify({ cardId: params.cardId })
    });
  }

  async getTiers(): Promise<TierResponse> {
    return this.request<TierResponse>("/cards/tiers", { method: "GET" });
  }

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health", { method: "GET" });
  }

  private async requestWithX402<T>(path: string, init: RequestInit): Promise<T> {
    const first = await this.rawFetch(path, init);

    if (first.status !== 402) {
      return this.parseResponse<T>(first);
    }

    const challengePayload = await first.json();

    const paymentHeader = await handleX402Payment({
      connection: this.connection,
      challengePayload,
      keypair: this.keypair,
      walletAdapter: this.walletAdapter
    });

    const retry = await this.rawFetch(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Payment": paymentHeader,
        ...(init.headers ?? {})
      }
    });

    return this.parseResponse<T>(retry);
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.rawFetch(path, init);
    return this.parseResponse<T>(response);
  }

  private async rawFetch(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init.headers ?? {})
        },
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new TimeoutError();
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new ApiError(response.status, payload);
    }

    return payload as T;
  }
}
