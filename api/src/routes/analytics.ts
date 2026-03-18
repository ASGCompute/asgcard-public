/**
 * Analytics Routes — public counters (no PII).
 *
 * GET /analytics/summary   — DAA, WAA, MAA, totals
 * GET /analytics/daa       — daily active agents history
 */
import { Router } from "express";
import { query } from "../db/db";
import { appLogger } from "../utils/logger";

export const analyticsRouter = Router();

// ── GET /analytics/summary ────────────────────────────────────
analyticsRouter.get("/summary", async (_req, res) => {
  try {
    // DAA (today)
    const [daaRow] = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT wallet_address)::text as count
       FROM api_activity WHERE request_date = CURRENT_DATE`
    );

    // WAA (last 7 days)
    const [waaRow] = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT wallet_address)::text as count
       FROM api_activity WHERE request_date >= CURRENT_DATE - INTERVAL '7 days'`
    );

    // MAA (last 30 days)
    const [maaRow] = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT wallet_address)::text as count
       FROM api_activity WHERE request_date >= CURRENT_DATE - INTERVAL '30 days'`
    );

    // Total unique agents (all time)
    const [totalAgentsRow] = await query<{ count: string }>(
      `SELECT COUNT(DISTINCT wallet_address)::text as count FROM api_activity`
    );

    // Total cards created
    const [totalCardsRow] = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM cards`
    );

    // Total API calls today
    const [totalCallsRow] = await query<{ total: string }>(
      `SELECT COALESCE(SUM(request_count), 0)::text as total
       FROM api_activity WHERE request_date = CURRENT_DATE`
    );

    // Installs last 7 days
    const [installs7dRow] = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM install_events WHERE created_at >= now() - INTERVAL '7 days'`
    );

    // Total installs
    const [totalInstallsRow] = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM install_events`
    );

    // Agent visits today
    const [agentVisitsRow] = await query<{ count: string }>(
      `SELECT COUNT(*)::text as count
       FROM page_visits WHERE is_agent = true AND created_at >= CURRENT_DATE`
    );

    res.json({
      timestamp: new Date().toISOString(),
      daa: Number(daaRow?.count ?? 0),
      waa: Number(waaRow?.count ?? 0),
      maa: Number(maaRow?.count ?? 0),
      totalAgents: Number(totalAgentsRow?.count ?? 0),
      totalCards: Number(totalCardsRow?.count ?? 0),
      totalApiCallsToday: Number(totalCallsRow?.total ?? 0),
      installs7d: Number(installs7dRow?.count ?? 0),
      totalInstalls: Number(totalInstallsRow?.count ?? 0),
      agentVisitsToday: Number(agentVisitsRow?.count ?? 0),
    });
  } catch (error) {
    appLogger.error({ err: error }, "[ANALYTICS] Summary failed");
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// ── GET /analytics/daa?days=30 ────────────────────────────────
analyticsRouter.get("/daa", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);

    const history = await query<{
      date: string;
      unique_agents: string;
      total_calls: string;
    }>(
      `SELECT
         request_date::text as date,
         COUNT(DISTINCT wallet_address)::text as unique_agents,
         SUM(request_count)::text as total_calls
       FROM api_activity
       WHERE request_date >= CURRENT_DATE - $1 * INTERVAL '1 day'
       GROUP BY request_date
       ORDER BY request_date DESC`,
      [days]
    );

    res.json({
      days,
      history: history.map((h) => ({
        date: h.date,
        uniqueAgents: Number(h.unique_agents),
        totalCalls: Number(h.total_calls),
      })),
    });
  } catch (error) {
    appLogger.error({ err: error }, "[ANALYTICS] DAA history failed");
    res.status(500).json({ error: "Failed to fetch DAA history" });
  }
});

// ── GET /analytics/installs?days=30 ───────────────────────────
analyticsRouter.get("/installs", async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 90);

    const byClient = await query<{
      client_type: string;
      count: string;
    }>(
      `SELECT client_type, COUNT(*)::text as count
       FROM install_events
       WHERE created_at >= now() - $1 * INTERVAL '1 day'
       GROUP BY client_type
       ORDER BY count DESC`,
      [days]
    );

    const byDay = await query<{
      date: string;
      count: string;
    }>(
      `SELECT created_at::date::text as date, COUNT(*)::text as count
       FROM install_events
       WHERE created_at >= now() - $1 * INTERVAL '1 day'
       GROUP BY created_at::date
       ORDER BY date DESC`,
      [days]
    );

    res.json({
      days,
      byClient: Object.fromEntries(byClient.map((r) => [r.client_type, Number(r.count)])),
      byDay: byDay.map((r) => ({ date: r.date, count: Number(r.count) })),
    });
  } catch (error) {
    appLogger.error({ err: error }, "[ANALYTICS] Installs failed");
    res.status(500).json({ error: "Failed to fetch install data" });
  }
});
