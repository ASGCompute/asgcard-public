/**
 * Sponsorship monitoring endpoint — /ops/sponsorship
 *
 * Returns real-time sponsorship metrics:
 * - Daily sponsorship count and budget remaining
 * - Treasury XLM balance
 * - Recent sponsorship events
 *
 * Protected by admin auth (same as /ops/* routes).
 *
 * @module routes/sponsorshipMonitor
 */

import { Router, type Request, type Response } from "express";
import { env } from "../config/env";
import { appLogger } from "../utils/logger";

const HORIZON_URL = env.STELLAR_HORIZON_URL ?? "https://horizon.stellar.org";

export const sponsorshipMonitorRouter = Router();

/**
 * GET /ops/sponsorship — Sponsorship dashboard metrics
 */
sponsorshipMonitorRouter.get("/sponsorship", async (_req: Request, res: Response) => {
  try {
    const metrics: Record<string, unknown> = {
      enabled: env.ONBOARDING_ENABLED === "true",
      treasuryConfigured: !!env.STELLAR_TREASURY_SECRET,
      keySource: env.STELLAR_TREASURY_SECRET
        ? (env.STELLAR_SETTLEMENT_SECRET === env.STELLAR_TREASURY_SECRET ? "settlement_fallback" : "dedicated_treasury")
        : "none",
      limits: {
        dailyBudget: parseInt(String(env.SPONSOR_DAILY_BUDGET ?? "100")),
        ipRateLimit: parseInt(String(env.SPONSOR_IP_RATE_LIMIT ?? "3")),
      },
    };

    // Get treasury balance if configured
    if (env.STELLAR_TREASURY_SECRET) {
      try {
        const { Keypair } = await import("@stellar/stellar-sdk");
        const kp = Keypair.fromSecret(env.STELLAR_TREASURY_SECRET);
        const treasuryAddress = kp.publicKey();

        const horizonRes = await fetch(`${HORIZON_URL}/accounts/${treasuryAddress}`, {
          signal: AbortSignal.timeout(5000),
        });

        if (horizonRes.ok) {
          const data = await horizonRes.json() as {
            balances: Array<{ asset_type: string; balance: string }>;
            num_sponsoring: number;
            num_sponsored: number;
          };

          const xlmBalance = data.balances.find(
            (b) => b.asset_type === "native"
          );

          metrics.treasury = {
            address: treasuryAddress,
            xlmBalance: xlmBalance ? parseFloat(xlmBalance.balance) : 0,
            numSponsoring: data.num_sponsoring ?? 0,
            numSponsored: data.num_sponsored ?? 0,
            estimatedCapacity: xlmBalance
              ? Math.floor(parseFloat(xlmBalance.balance) / 1.5) // ~1.5 XLM per sponsorship
              : 0,
          };

          // Alert thresholds
          const xlm = xlmBalance ? parseFloat(xlmBalance.balance) : 0;
          if (xlm < 10) {
            metrics.alert = "CRITICAL: Treasury below 10 XLM. Sponsorships will fail.";
          } else if (xlm < 50) {
            metrics.alert = "WARNING: Treasury below 50 XLM. Top up soon.";
          }
        } else if (horizonRes.status === 404) {
          metrics.treasury = {
            address: treasuryAddress,
            funded: false,
            alert: "Treasury account not funded on Stellar. Send XLM to activate.",
          };
        }
      } catch (err) {
        metrics.treasury = { error: "Failed to query Horizon", detail: String(err) };
      }
    }

    // Get today's sponsorship count from DB (if available)
    try {
      const { SponsorshipService } = await import("../services/sponsorship");
      const budgetOk = await SponsorshipService.checkDailyBudget();
      metrics.dailyBudgetAvailable = budgetOk;
    } catch {
      metrics.dailyBudgetAvailable = "unknown (service not loaded)";
    }

    res.json(metrics);
  } catch (error) {
    appLogger.error({ error }, "[OPS] Sponsorship metrics failed");
    res.status(500).json({ error: "Failed to fetch sponsorship metrics" });
  }
});
