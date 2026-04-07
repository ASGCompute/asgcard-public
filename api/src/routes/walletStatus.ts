/**
 * Wallet Status Routes — General-purpose wallet endpoints.
 *
 * GET /wallet/status    — Full lifecycle status
 * GET /wallet/balance   — USDC balance (server-side Horizon, 5s cache)
 * GET /wallet/fund-link — Generate fund.asgcard.dev URL
 *
 * All routes require wallet authentication.
 * Usable anytime post-onboarding.
 *
 * @module routes/walletStatus
 */

import { Router } from "express";
import { requireWalletAuth } from "../middleware/walletAuth";
import { query } from "../db/db";
import { env } from "../config/env";
import { appLogger } from "../utils/logger";

export const walletStatusRouter = Router();

walletStatusRouter.use(requireWalletAuth);

// ── Balance cache (5s TTL) ──────────────────────────────────

const balanceCache = new Map<string, { balance: number; fetchedAt: number }>();
const BALANCE_CACHE_TTL_MS = 5_000;

async function fetchUsdcBalance(address: string): Promise<number> {
  const cached = balanceCache.get(address);
  if (cached && Date.now() - cached.fetchedAt < BALANCE_CACHE_TTL_MS) {
    return cached.balance;
  }

  try {
    const res = await fetch(`${env.STELLAR_HORIZON_URL}/accounts/${address}`);
    if (!res.ok) {
      if (res.status === 404) return -1; // Account not found
      return -1;
    }
    const data = await res.json() as {
      balances: Array<{
        asset_type: string;
        asset_code?: string;
        asset_issuer?: string;
        balance: string;
      }>;
    };

    const usdc = data.balances.find(
      (b) =>
        b.asset_code === "USDC" &&
        b.asset_issuer === "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    );

    const balance = usdc ? parseFloat(usdc.balance) : 0;
    balanceCache.set(address, { balance, fetchedAt: Date.now() });
    return balance;
  } catch {
    return -1;
  }
}

/**
 * GET /wallet/status
 *
 * Returns full lifecycle:
 *   - onboarding status (pending_identity, pending_sponsor, active, etc.)
 *   - telegram binding status
 *   - pending sponsorship XDR (if any)
 *   - USDC balance
 */
walletStatusRouter.get("/status", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const walletAddress = req.walletContext.address;

  try {
    // Check wallet registry
    const walletRows = await query<{
      status: string;
      registered_at: string;
      sponsored_at: string | null;
      client_type: string | null;
    }>(
      `SELECT status, registered_at, sponsored_at, client_type
      FROM wallets WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (walletRows.length === 0) {
      res.json({
        registered: false,
        status: "not_registered",
        message: "Run: npx @asgcard/cli onboard",
      });
      return;
    }

    const wallet = walletRows[0];

    // Check TG binding
    const tgRows = await query<{
      telegram_user_id: string;
      linked_at: string;
    }>(
      `SELECT telegram_user_id, linked_at
      FROM owner_telegram_links
      WHERE owner_wallet = $1 AND status = 'active'
      LIMIT 1`,
      [walletAddress]
    );

    // Check pending sponsorship XDR
    let pendingXdr: string | null = null;
    if (wallet.status === "pending_sponsor") {
      const sponsorRows = await query<{ sponsor_xdr: string }>(
        `SELECT sponsor_xdr FROM wallet_sponsorships
        WHERE wallet_address = $1 AND status = 'pending'`,
        [walletAddress]
      );
      pendingXdr = sponsorRows[0]?.sponsor_xdr ?? null;
    }

    // Get USDC balance
    const balance = await fetchUsdcBalance(walletAddress);

    res.json({
      registered: true,
      status: wallet.status,
      registeredAt: wallet.registered_at,
      sponsoredAt: wallet.sponsored_at,
      clientType: wallet.client_type,
      telegram: tgRows.length > 0
        ? {
            linked: true,
            userId: Number(tgRows[0].telegram_user_id),
            linkedAt: tgRows[0].linked_at,
          }
        : { linked: false },
      balance: balance >= 0 ? balance : null,
      pendingXdr,
    });
  } catch (error) {
    appLogger.error({ err: error }, "[WALLET_STATUS] status error");
    res.status(500).json({ error: "Failed to get wallet status" });
  }
});

/**
 * GET /wallet/balance
 *
 * Server-side USDC balance with 5s cache.
 */
walletStatusRouter.get("/balance", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  try {
    const balance = await fetchUsdcBalance(req.walletContext.address);

    if (balance < 0) {
      res.json({
        address: req.walletContext.address,
        balance: null,
        error: "Could not fetch balance (account may not exist yet)",
      });
      return;
    }

    res.json({
      address: req.walletContext.address,
      balance,
      asset: "USDC",
      network: "stellar:pubnet",
    });
  } catch (error) {
    appLogger.error({ err: error }, "[WALLET_STATUS] balance error");
    res.status(500).json({ error: "Failed to get balance" });
  }
});

/**
 * GET /wallet/fund-link
 *
 * Generate a fund.asgcard.dev URL for this wallet.
 * Checks Horizon to verify the wallet exists and has USDC trustline.
 */
walletStatusRouter.get("/fund-link", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const walletAddress = req.walletContext.address;
  const agentName = (req.query.agentName as string) ?? "AI Agent";
  const amount = (req.query.amount as string) ?? "50";

  try {
    // Check Stellar Horizon: does the account exist & have USDC trustline?
    let accountExists = false;
    let hasUsdcTrustline = false;
    let xlmBalance: number | null = null;

    try {
      const horizonRes = await fetch(`${env.STELLAR_HORIZON_URL}/accounts/${walletAddress}`);
      if (horizonRes.ok) {
        accountExists = true;
        const accountData = await horizonRes.json() as {
          balances: Array<{
            asset_type: string;
            asset_code?: string;
            asset_issuer?: string;
            balance: string;
          }>;
        };

        hasUsdcTrustline = accountData.balances.some(
          (b) =>
            b.asset_code === "USDC" &&
            b.asset_issuer === "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
        );

        const xlm = accountData.balances.find((b) => b.asset_type === "native");
        xlmBalance = xlm ? parseFloat(xlm.balance) : 0;
      }
    } catch {
      // Horizon unreachable — generate link anyway with warning
    }

    const params = new URLSearchParams({
      agentName,
      toAddress: walletAddress,
      toAmount: amount,
      toToken: "USDC",
    });

    const fundUrl = `https://fund.asgcard.dev/?${params.toString()}`;

    if (!accountExists) {
      res.json({
        url: fundUrl,
        address: walletAddress,
        agentName,
        amount: Number(amount),
        token: "USDC",
        warning: "Account not activated on Stellar. USDC transfers will fail until the account is created and a USDC trustline is added.",
        action: "Complete onboarding: npx @asgcard/cli onboard",
        stellarStatus: {
          exists: false,
          hasTrustline: false,
          xlmBalance: null,
        },
      });
      return;
    }

    if (!hasUsdcTrustline) {
      res.json({
        url: fundUrl,
        address: walletAddress,
        agentName,
        amount: Number(amount),
        token: "USDC",
        warning: "Account exists but has no USDC trustline. USDC transfers will fail.",
        action: "Re-run onboarding to add USDC trustline: npx @asgcard/cli onboard",
        stellarStatus: {
          exists: true,
          hasTrustline: false,
          xlmBalance,
        },
      });
      return;
    }

    res.json({
      url: fundUrl,
      address: walletAddress,
      agentName,
      amount: Number(amount),
      token: "USDC",
      stellarStatus: {
        exists: true,
        hasTrustline: true,
        xlmBalance,
      },
    });
  } catch (error) {
    appLogger.error({ err: error }, "[WALLET_STATUS] fund-link error");
    res.status(500).json({ error: "Failed to generate fund link" });
  }
});
