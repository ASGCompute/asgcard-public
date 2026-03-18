import { Router } from "express";
import { env } from "../config/env";
import { CREATION_TIERS, FUNDING_TIERS } from "../config/pricing";
import { facilitatorClient } from "../services/facilitatorClient";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: env.API_VERSION
  });
});

publicRouter.get("/pricing", (_req, res) => {
  res.json({
    creation: {
      tiers: CREATION_TIERS.map((tier) => ({
        loadAmount: tier.loadAmount,
        totalCost: tier.totalCost,
        issuanceFee: tier.issuanceFee,
        topUpFee: tier.topUpFee,
        ourFee: tier.serviceFee,
        endpoint: tier.endpoint
      }))
    },
    funding: {
      tiers: FUNDING_TIERS.map((tier) => ({
        fundAmount: tier.fundAmount,
        totalCost: tier.totalCost,
        topUpFee: tier.topUpFee,
        ourFee: tier.serviceFee,
        endpoint: tier.endpoint
      }))
    }
  });
});

publicRouter.get("/cards/tiers", (_req, res) => {
  res.json({
    creation: CREATION_TIERS.map((tier) => ({
      loadAmount: tier.loadAmount,
      totalCost: tier.totalCost,
      endpoint: tier.endpoint,
      breakdown: {
        cardLoad: tier.loadAmount,
        issuanceFee: tier.issuanceFee,
        topUpFee: tier.topUpFee,
        ourFee: tier.serviceFee,
        buffer: 0
      }
    })),
    funding: FUNDING_TIERS.map((tier) => ({
      fundAmount: tier.fundAmount,
      totalCost: tier.totalCost,
      endpoint: tier.endpoint,
      breakdown: {
        fundAmount: tier.fundAmount,
        topUpFee: tier.topUpFee,
        ourFee: tier.serviceFee
      }
    }))
  });
});

publicRouter.get("/supported", async (_req, res) => {
  try {
    const upstream = await facilitatorClient.supported();
    res.json({
      facilitator: upstream,
      local: {
        x402Version: 2,
        scheme: "exact",
        network: env.STELLAR_NETWORK,
        asset: env.STELLAR_USDC_ASSET,
        payTo: env.STELLAR_TREASURY_ADDRESS,
      }
    });
  } catch (error) {
    // Even if facilitator is down, return local config
    res.json({
      facilitator: null,
      facilitatorError: error instanceof Error ? error.message : "unavailable",
      local: {
        x402Version: 2,
        scheme: "exact",
        network: env.STELLAR_NETWORK,
        asset: env.STELLAR_USDC_ASSET,
        payTo: env.STELLAR_TREASURY_ADDRESS,
      }
    });
  }
});

// ── Telemetry (fire-and-forget, no auth) ──────────────────────

const AGENT_UA_PATTERNS = [
  /claude/i, /cursor/i, /mcp/i, /gpt/i, /openai/i, /anthropic/i,
  /copilot/i, /asgcard/i, /bot/i, /agent/i
];

function isAgentUA(ua: string): boolean {
  return AGENT_UA_PATTERNS.some((p) => p.test(ua));
}

publicRouter.post("/telemetry/install", async (req, res) => {
  try {
    const { client, version, os } = req.body ?? {};
    if (!client) {
      res.status(400).json({ error: "client required" });
      return;
    }

    // Fire-and-forget write
    const { getPool } = await import("../db/db");
    try {
      const pool = getPool();
      pool.query(
        `INSERT INTO install_events (client_type, version, os) VALUES ($1, $2, $3)`,
        [String(client).slice(0, 50), String(version ?? "").slice(0, 20), String(os ?? "").slice(0, 20)]
      ).catch(() => {});
    } catch {
      // inmemory mode — skip
    }

    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // always return 200
  }
});

publicRouter.post("/telemetry/visit", async (req, res) => {
  try {
    const { page, referrer } = req.body ?? {};
    const ua = req.header("user-agent") ?? "";
    const agentDetected = isAgentUA(ua);

    // Fire-and-forget write
    const { getPool } = await import("../db/db");
    try {
      const pool = getPool();
      pool.query(
        `INSERT INTO page_visits (page, referrer, user_agent, is_agent) VALUES ($1, $2, $3, $4)`,
        [
          String(page ?? "unknown").slice(0, 100),
          String(referrer ?? "").slice(0, 500),
          ua.slice(0, 500),
          agentDetected
        ]
      ).catch(() => {});
    } catch {
      // inmemory mode — skip
    }

    res.json({ ok: true, isAgent: agentDetected });
  } catch {
    res.json({ ok: true });
  }
});
