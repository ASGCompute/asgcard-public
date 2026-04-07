/**
 * @asgcard/mcp-server — Core MCP Server
 *
 * Exposes 18 tools for AI agents to manage ASGCard virtual cards:
 *   - get_wallet_status:   Read-only wallet status (address, balance, readiness)
 *   - create_card:         Create a virtual card (x402 autonomous payment)
 *   - fund_card:           Fund an existing card (x402 autonomous payment)
 *   - list_cards:          List all cards for the wallet
 *   - get_card:            Get card summary by ID
 *   - get_card_details:    Get sensitive card details (PAN, CVV, expiry)
 *   - freeze_card:         Freeze a card temporarily
 *   - unfreeze_card:       Unfreeze a frozen card
 *   - get_pricing:         Get pricing info
 *   - get_transactions:    Get card transaction history from 4payments
 *   - get_balance:         Get live card balance from 4payments
 *   - telegram_link:       Generate Telegram deep-link for notification binding
 *   - telegram_status:     Check Telegram connection status
 *   - telegram_revoke:     Disconnect Telegram notifications
 *   - get_onboard_status:  Check onboarding lifecycle status
 *   - connect_telegram:    Register wallet + get TG deep-link for identity binding
 *   - get_fund_link:       Generate fund.asgcard.dev URL for wallet funding
 *   - get_wallet_balance:  Get USDC balance (API-cached + Horizon fallback)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Keypair } from "@stellar/stellar-sdk";
import { ASGCardClient } from "@asgcard/sdk";
import { WalletClient } from "./wallet-client.js";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const HORIZON_URL = "https://horizon.stellar.org";
// Pricing constants (must match api/src/config/pricing.ts)
const CARD_FEE = 10;
const TOPUP_RATE = 0.035;
const PRICING_MIN = 5;
const PRICING_MAX = 5000;
const MIN_CREATE_COST = CARD_FEE; // $10 flat card creation (initial load optional)

async function getUsdcBalance(publicKey: string): Promise<number> {
  try {
    const res = await fetch(`${HORIZON_URL}/accounts/${publicKey}`);
    if (res.status === 404) return 0;
    if (!res.ok) return -1;
    const data = await res.json() as { balances: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> };
    const usdcBalance = data.balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );
    return usdcBalance ? parseFloat(usdcBalance.balance) : 0;
  } catch {
    return -1;
  }
}

function remediationError(what: string, why: string, fix: string): { content: { type: "text"; text: string }[]; isError: true } {
  return {
    content: [{ type: "text" as const, text: `ERROR: ${what}\nWhy: ${why}\nFix: ${fix}` }],
    isError: true,
  };
}

export interface ServerConfig {
  /** Stellar secret key (S...) */
  privateKey: string;
  /** ASGCard API base URL */
  apiUrl?: string;
  /** Soroban RPC URL */
  rpcUrl?: string;
}



export function createASGCardServer(config: ServerConfig): McpServer {
  const apiUrl = config.apiUrl ?? "https://api.asgcard.dev";

  // SDK client for x402-paid operations (create, fund, pricing, health)
  const sdkClient = new ASGCardClient({
    privateKey: config.privateKey,
    baseUrl: apiUrl,
    rpcUrl: config.rpcUrl,
  });

  // Wallet client for wallet-auth operations (list, get, details, freeze, unfreeze)
  const walletClient = new WalletClient({
    privateKey: config.privateKey,
    baseUrl: apiUrl,
  });

  const server = new McpServer({
    name: "asgcard",
    version: "0.6.1",
  });

  // ── Tool 0: get_wallet_status ─────────────────────────────

  server.tool(
    "get_wallet_status",
    "Check wallet readiness: returns public key, USDC balance on Stellar, whether balance is sufficient for card creation, and next-step guidance. Use this FIRST before any card operations to verify the wallet is funded.",
    {},
    async () => {
      try {
        const kp = Keypair.fromSecret(config.privateKey);
        const publicKey = kp.publicKey();
        const balance = await getUsdcBalance(publicKey);

        const isReady = balance >= MIN_CREATE_COST;

        const status: Record<string, unknown> = {
          publicKey,
          network: "stellar:pubnet",
          usdcBalance: balance === -1 ? "error_fetching" : balance.toFixed(2),
          minimumRequired: MIN_CREATE_COST,
          readyForCardCreation: isReady,
          depositAddress: publicKey,
          usdcAsset: `USDC:${USDC_ISSUER}`,
        };

        if (!isReady) {
          if (balance === -1) {
            status.nextStep = "Could not fetch balance from Stellar Horizon. Check network connectivity and try again.";
          } else if (balance === 0) {
            status.nextStep = `Wallet has zero USDC. Send at least $${MIN_CREATE_COST} USDC on Stellar to ${publicKey}. After funding, use create_card to issue your first virtual card.`;
          } else {
            status.nextStep = `Current balance $${balance.toFixed(2)} is below minimum card cost. Send more USDC to ${publicKey}.`;
          }
        } else {
          status.nextStep = "Wallet is funded and ready. Use get_pricing to see pricing, then create_card to issue a virtual card.";
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }],
        };
      } catch (error) {
        return remediationError(
          "Failed to check wallet status",
          error instanceof Error ? error.message : String(error),
          "Verify STELLAR_PRIVATE_KEY is a valid Stellar secret key (starts with S, 56 characters). Run: asgcard doctor"
        );
      }
    }
  );

  // ── Tool 1: create_card ───────────────────────────────────

  // @ts-expect-error — TS2589: MCP SDK server.tool() generic depth exceeds TS limit; runtime is correct
  server.tool(
    "create_card",
    "Create a new virtual debit card. Pays on-chain with USDC via x402 protocol — fully autonomous, no human intervention needed. Returns card details (PAN, CVV, expiry) in the response.",
    {
      amount: z
        .string()
        .describe("Card load amount in USD. Any amount from $5 to $5,000."),
      nameOnCard: z.string().min(1).describe("Name to print on the virtual card"),
      email: z.string().email().describe("Email address for card notifications"),
      phone: z.string().min(1).describe("Phone number for cardholder registration, e.g. +1234567890"),
    },
    async ({ amount, nameOnCard, email, phone }) => {
      try {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount < PRICING_MIN || numericAmount > PRICING_MAX) {
          return remediationError("Invalid amount", `Amount must be between $${PRICING_MIN} and $${PRICING_MAX}`, "Use get_pricing to see valid amounts.");
        }
        const result = await sdkClient.createCard({
          amount: numericAmount,
          nameOnCard,
          email,
          phone,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Insufficient") || msg.includes("balance")) {
          return remediationError(
            "Insufficient USDC balance for card creation",
            msg,
            "Use get_wallet_status to check your balance. Send USDC on Stellar to your wallet address, then retry."
          );
        }
        return remediationError("Card creation failed", msg, "Use get_wallet_status to verify wallet setup, then retry.");
      }
    }
  );

  // ── Tool 2: fund_card ─────────────────────────────────────

  server.tool(
    "fund_card",
    "Fund an existing card with additional USDC. Pays on-chain via x402 protocol — fully autonomous.",
    {
      amount: z
        .string()
        .describe("Fund amount in USD. Any amount from $5 to $5,000."),
      cardId: z.string().min(1).describe("The card ID to fund"),
    },
    async ({ amount, cardId }) => {
      try {
        const numericAmount = Number(amount);
        if (!Number.isFinite(numericAmount) || numericAmount < PRICING_MIN || numericAmount > PRICING_MAX) {
          return remediationError("Invalid amount", `Amount must be between $${PRICING_MIN} and $${PRICING_MAX}`, "Use get_pricing to see valid amounts.");
        }
        const result = await sdkClient.fundCard({
          amount: numericAmount,
          cardId,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("Insufficient") || msg.includes("balance")) {
          return remediationError(
            "Insufficient USDC balance for funding",
            msg,
            "Use get_wallet_status to check your balance. Send more USDC to your wallet, then retry."
          );
        }
        return remediationError("Card funding failed", msg, "Use get_wallet_status to verify wallet setup, then retry.");
      }
    }
  );

  // ── Tool 3: list_cards ────────────────────────────────────

  server.tool(
    "list_cards",
    "List all virtual cards associated with the configured wallet. Returns card IDs, names, balances, and statuses.",
    {},
    async () => {
      try {
        const result = await walletClient.listCards();

        if (!result.cards || result.cards.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No cards found. Use create_card to issue a new virtual card.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("401") || msg.includes("403")) {
          return remediationError("Authentication failed", msg, "Verify STELLAR_PRIVATE_KEY is correct. Run: asgcard doctor");
        }
        return remediationError("Failed to list cards", msg, "Check API connectivity. Run: asgcard health");
      }
    }
  );

  // ── Tool 4: get_card ──────────────────────────────────────

  server.tool(
    "get_card",
    "Get summary information for a specific card (balance, status, name). Does NOT return sensitive details like card number or CVV — use get_card_details for that.",
    {
      cardId: z.string().min(1).describe("The card ID to look up"),
    },
    async ({ cardId }) => {
      try {
        const result = await walletClient.getCard(cardId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return remediationError("Failed to get card", error instanceof Error ? error.message : String(error), "Verify the card ID is correct. Use list_cards to see available cards.");
      }
    }
  );

  // ── Tool 5: get_card_details ──────────────────────────────

  server.tool(
    "get_card_details",
    "Get sensitive card details: full card number (PAN), CVV, expiry date, and billing address. Use ONLY when you need to fill in a payment form. Prefer get_card or list_cards for balance checks.",
    {
      cardId: z.string().min(1).describe("The card ID to get details for"),
    },
    async ({ cardId }) => {
      try {
        const result = await walletClient.getCardDetails(cardId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("429")) {
          return remediationError("Rate limited", "Card details access is limited to 5 times per hour", "Wait and retry later. Use get_card for non-sensitive info.");
        }
        return remediationError("Failed to get card details", msg, "Verify card ID. Use list_cards to see available cards.");
      }
    }
  );

  // ── Tool 6: freeze_card ───────────────────────────────────

  server.tool(
    "freeze_card",
    "Temporarily freeze a card. The card cannot be used for purchases while frozen. Use unfreeze_card to re-enable it. This is reversible (unlike closing a card).",
    {
      cardId: z.string().min(1).describe("The card ID to freeze"),
    },
    async ({ cardId }) => {
      try {
        const result = await walletClient.freezeCard(cardId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return remediationError("Failed to freeze card", error instanceof Error ? error.message : String(error), "Verify card ID and that the card is currently active.");
      }
    }
  );

  // ── Tool 7: unfreeze_card ─────────────────────────────────

  server.tool(
    "unfreeze_card",
    "Unfreeze a previously frozen card, re-enabling it for purchases.",
    {
      cardId: z.string().min(1).describe("The card ID to unfreeze"),
    },
    async ({ cardId }) => {
      try {
        const result = await walletClient.unfreezeCard(cardId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return remediationError("Failed to unfreeze card", error instanceof Error ? error.message : String(error), "Verify card ID and that the card is currently frozen.");
      }
    }
  );

  // ── Tool 8: get_pricing ───────────────────────────────────

  server.tool(
    "get_pricing",
    "Get pricing info. Card issuance $10, top-up fee 3.5%. Any amount $5–$5,000.",
    {},
    async () => {
      try {
        const result = await sdkClient.getPricing();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return remediationError("Failed to get pricing", error instanceof Error ? error.message : String(error), "Check API connectivity. The pricing endpoint is public and requires no authentication.");
      }
    }
  );

  // ── Tool 9: get_transactions ────────────────────────────────

  server.tool(
    "get_transactions",
    "Get real transaction history for a card from 4payments. Shows all card activity including purchases, refunds, and top-ups. Requires card ID.",
    {
      cardId: z.string().describe("The card ID to get transactions for"),
      page: z.number().optional().default(1).describe("Page number (default: 1)"),
      limit: z.number().optional().default(20).describe("Results per page (max: 100, default: 20)"),
    },
    async ({ cardId, page, limit }) => {
      try {
        const result = await walletClient.getTransactions(cardId, page, Math.min(limit ?? 20, 100));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return remediationError("Failed to get transactions", error instanceof Error ? error.message : String(error), "Verify the card ID. Use list_cards to see available cards.");
      }
    }
  );

  // ── Tool 10: get_balance ────────────────────────────────────

  server.tool(
    "get_balance",
    "Get the live balance of a card directly from 4payments. Returns real-time balance, currency, and card status.",
    {
      cardId: z.string().describe("The card ID to get balance for"),
    },
    async ({ cardId }) => {
      try {
        const result = await walletClient.getBalance(cardId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return remediationError("Failed to get balance", error instanceof Error ? error.message : String(error), "Verify the card ID. Use list_cards to see available cards.");
      }
    }
  );

  // ── Tool 11: telegram_link ──────────────────────────────────

  server.tool(
    "telegram_link",
    "Generate a one-time Telegram deep-link URL to connect the wallet owner's Telegram account for real-time transaction notifications (charges, declines, refunds, top-ups). The link expires in 10 minutes. Send the returned URL to the wallet owner — when they click it, their Telegram is automatically bound to this wallet.",
    {},
    async () => {
      try {
        const result = await walletClient.getTelegramLinkToken();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("404")) {
          return remediationError("Portal API not available", "The Owner Portal is not enabled on the API server", "This feature requires OWNER_PORTAL_ENABLED=true on the API server.");
        }
        if (msg.includes("429")) {
          return remediationError("Rate limited", "Maximum 5 link tokens per hour", "Wait and retry later.");
        }
        return remediationError("Failed to generate Telegram link", msg, "Check API connectivity and wallet authentication.");
      }
    }
  );

  // ── Tool 12: telegram_status ────────────────────────────────

  server.tool(
    "telegram_status",
    "Check whether the wallet owner's Telegram account is currently connected for transaction notifications. Returns linked status, Telegram user ID, and link date.",
    {},
    async () => {
      try {
        const result = await walletClient.getTelegramStatus();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("404")) {
          return remediationError("Portal API not available", "The Owner Portal is not enabled on the API server", "This feature requires OWNER_PORTAL_ENABLED=true on the API server.");
        }
        return remediationError("Failed to check Telegram status", msg, "Check API connectivity and wallet authentication.");
      }
    }
  );

  // ── Tool 13: telegram_revoke ────────────────────────────────

  server.tool(
    "telegram_revoke",
    "Disconnect the wallet owner's Telegram account. Immediately stops all transaction notifications. The owner can re-link at any time using telegram_link.",
    {},
    async () => {
      try {
        const result = await walletClient.revokeTelegram();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("404")) {
          return remediationError("Portal API not available", "The Owner Portal is not enabled on the API server", "This feature requires OWNER_PORTAL_ENABLED=true on the API server.");
        }
        return remediationError("Failed to revoke Telegram", msg, "Check API connectivity and wallet authentication.");
      }
    }
  );

  // ═══════════════════════════════════════════════════════════
  // ONBOARDING TOOLS (v0.6.0 — queries /onboard/* and /wallet/*)
  // ═══════════════════════════════════════════════════════════

  // ── Tool 14: get_onboard_status ──────────────────────────────

  server.tool(
    "get_onboard_status",
    "Check onboarding lifecycle status: registration, Telegram identity binding, sponsorship status, USDC balance, and next recommended action. Use this to determine what steps remain in the onboarding pipeline.",
    {},
    async () => {
      try {
        const result = await walletClient.authenticatedRequest<{
          registered: boolean;
          status: string;
          registeredAt?: string;
          sponsoredAt?: string;
          clientType?: string;
          telegram?: { linked: boolean; userId?: number; linkedAt?: string };
          balance?: number | null;
          pendingXdr?: string | null;
          message?: string;
        }>("GET", "/wallet/status");

        // Add next-step guidance
        const enriched: Record<string, unknown> = { ...result };

        if (!result.registered) {
          enriched.nextStep = "Wallet not registered. Use connect_telegram tool to start onboarding.";
        } else if (result.status === "pending_identity") {
          enriched.nextStep = "Open the Telegram link to connect financial identity. Use connect_telegram if you don't have a link.";
        } else if (result.status === "pending_sponsor" && result.pendingXdr) {
          enriched.nextStep = "Sponsorship XDR ready. Co-sign the transaction with your wallet to activate the account.";
        } else if (result.status === "active") {
          if (result.balance !== null && result.balance !== undefined && result.balance < MIN_CREATE_COST) {
            enriched.nextStep = `Wallet active but balance ($${result.balance.toFixed(2)}) is below minimum. Use get_fund_link to get a funding page URL.`;
          } else {
            enriched.nextStep = "Fully onboarded and funded! Use create_card to issue a virtual card.";
          }
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }],
        };
      } catch (error) {
        return remediationError(
          "Failed to check onboard status",
          error instanceof Error ? error.message : String(error),
          "The API may be unreachable or onboarding may not be enabled. Try get_wallet_status for basic local check."
        );
      }
    }
  );

  // ── Tool 15: connect_telegram ─────────────────────────────────

  // @ts-expect-error — TS2589: MCP SDK server.tool() generic depth exceeds TS limit; runtime is correct
  server.tool(
    "connect_telegram",
    "Register wallet and get a Telegram deep-link for identity binding. The owner clicks this link in Telegram to connect their financial identity. Returns the deep-link URL and expiration time.",
    {
      clientType: z.string().optional().describe("The AI client type (codex, claude, cursor, gemini). Optional — helps with analytics."),
    },
    async ({ clientType }) => {
      try {
        const result = await walletClient.authenticatedRequest<{
          registered: boolean;
          status: string;
          telegramLink?: string;
          expiresAt?: string;
          pendingXdr?: string | null;
          message?: string;
        }>("POST", "/onboard/register", { clientType: clientType ?? "mcp" });

        const response: Record<string, unknown> = { ...result };

        if (result.telegramLink) {
          response.instructions = "Send this Telegram link to the wallet owner. They must click it within 10 minutes to bind their identity.";
        } else if (result.status === "active") {
          response.instructions = "Wallet is already fully onboarded. No action needed.";
        } else if (result.pendingXdr) {
          response.instructions = "Telegram already connected. Co-sign the pending sponsorship XDR to activate the account.";
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
        };
      } catch (error) {
        return remediationError(
          "Failed to register for onboarding",
          error instanceof Error ? error.message : String(error),
          "Ensure the API is reachable and ONBOARDING_ENABLED=true on the server."
        );
      }
    }
  );

  // ── Tool 16: get_fund_link ────────────────────────────────────

  server.tool(
    "get_fund_link",
    "Generate a fund.asgcard.dev URL that the wallet owner can use to fund the agent's wallet with USDC. Returns a shareable link with pre-filled agent name and amount.",
    {
      agentName: z.string().optional().describe("Name of the AI agent (shown on funding page). Default: 'AI Agent'"),
      amount: z.string().optional().describe("Suggested USDC amount. Default: '50'"),
    },
    async ({ agentName, amount }) => {
      try {
        const params = new URLSearchParams();
        if (agentName) params.set("agentName", agentName);
        if (amount) params.set("amount", amount);
        const qs = params.toString() ? `?${params.toString()}` : "";

        const result = await walletClient.authenticatedRequest<{
          url: string;
          address: string;
          agentName: string;
          amount: number;
          token: string;
        }>("GET", `/wallet/fund-link${qs}`);

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            ...result,
            instructions: "Share this URL with the wallet owner. They can fund the agent's wallet by sending USDC through this page.",
          }, null, 2) }],
        };
      } catch (error) {
        // Fallback: generate locally
        try {
          const kp = Keypair.fromSecret(config.privateKey);
          const fallbackParams = new URLSearchParams({
            agentName: agentName ?? "AI Agent",
            toAddress: kp.publicKey(),
            toAmount: amount ?? "50",
            toToken: "USDC",
          });
          const url = `https://fund.asgcard.dev/?${fallbackParams.toString()}`;

          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              url,
              address: kp.publicKey(),
              agentName: agentName ?? "AI Agent",
              amount: Number(amount ?? "50"),
              token: "USDC",
              source: "local_fallback",
              instructions: "Share this URL with the wallet owner. Generated locally because the API was unreachable.",
            }, null, 2) }],
          };
        } catch (fallbackError) {
          return remediationError(
            "Failed to generate fund link",
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
            "Verify the API is reachable or check your private key."
          );
        }
      }
    }
  );

  // ── Tool 17: get_wallet_balance ───────────────────────────────

  server.tool(
    "get_wallet_balance",
    "Get the current USDC balance from the API's server-side Horizon cache (faster, 5-second cache). Falls back to direct Horizon query if API is unavailable.",
    {},
    async () => {
      try {
        const result = await walletClient.authenticatedRequest<{
          address: string;
          balance: number | null;
          asset?: string;
          network?: string;
          error?: string;
        }>("GET", "/wallet/balance");

        if (result.balance === null) {
          // Account may not exist yet
          const kp = Keypair.fromSecret(config.privateKey);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              address: kp.publicKey(),
              balance: 0,
              funded: false,
              nextStep: `Send USDC on Stellar to ${kp.publicKey()} to fund this wallet.`,
            }, null, 2) }],
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            ...result,
            readyForCard: (result.balance ?? 0) >= MIN_CREATE_COST,
          }, null, 2) }],
        };
      } catch {
        // Fallback: direct Horizon
        try {
          const kp = Keypair.fromSecret(config.privateKey);
          const balance = await getUsdcBalance(kp.publicKey());

          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              address: kp.publicKey(),
              balance: balance >= 0 ? balance : null,
              asset: "USDC",
              network: "stellar:pubnet",
              source: "horizon_direct",
              readyForCard: balance >= MIN_CREATE_COST,
            }, null, 2) }],
          };
        } catch (error) {
          return remediationError(
            "Failed to get wallet balance",
            error instanceof Error ? error.message : String(error),
            "Check network connectivity or verify your private key."
          );
        }
      }
    }
  );

  return server;
}
