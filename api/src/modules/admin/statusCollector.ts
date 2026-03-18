/**
 * Admin Status Collector — gathers system metrics for /status command.
 *
 * Data sources:
 * - Stellar Horizon API → Treasury USDC balance
 * - 4Payments API → Account balance
 * - PostgreSQL → Cards, clients, webhooks, revenue
 *
 * All queries are fail-safe: return null on error to avoid crashing /status.
 *
 * @module modules/admin/statusCollector
 */

import { env } from "../../config/env";
import { query } from "../../db/db";
import { getFourPaymentsClient } from "../../services/fourPaymentsClient";
import { appLogger } from "../../utils/logger";

// ── Types ──────────────────────────────────────────────────

export interface AdminStatus {
    finances: {
        treasuryUsdc: number | null;
        fourPaymentsBalance: number | null;
        totalRevenue: number | null;
        totalVolume: number | null;
        totalCardBalance: number | null;
    };
    clients: {
        total: number | null;
        linked: number | null;
        daaToday: number | null;
        daaYesterday: number | null;
        daa7d: number | null;
        maa: number | null;
    };
    cards: {
        total: number | null;
        active: number | null;
        frozen: number | null;
        last24h: number | null;
    };
    analytics: {
        installsToday: number | null;
        installs7d: number | null;
        installsTotal: number | null;
        visitsToday: number | null;
        agentVisitsToday: number | null;
        visits7d: number | null;
    };
    system: {
        uptimeSeconds: number;
        memoryMb: number;
        nodeVersion: string;
        webhooks24h: number | null;
        lastWebhookAgo: string | null;
        errors24h: number | null;
    };
}

// ── Collectors ─────────────────────────────────────────────

/**
 * Fetch Treasury USDC balance from Stellar Horizon API.
 * GET {HORIZON_URL}/accounts/{address}
 */
async function getTreasuryBalance(): Promise<number | null> {
    try {
        const url = `${env.STELLAR_HORIZON_URL}/accounts/${env.STELLAR_TREASURY_ADDRESS}`;
        const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) return null;

        const data = (await res.json()) as {
            balances: Array<{
                asset_type: string;
                asset_code?: string;
                asset_issuer?: string;
                balance: string;
            }>;
        };

        // Find USDC balance (classic or SAC)
        const usdc = data.balances.find(
            (b) =>
                b.asset_code === "USDC" &&
                (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12")
        );

        return usdc ? parseFloat(usdc.balance) : 0;
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] Treasury balance fetch failed");
        return null;
    }
}

/**
 * Fetch 4Payments account balance.
 */
async function get4PaymentsBalance(): Promise<number | null> {
    try {
        const fp = getFourPaymentsClient();
        const result = await fp.getAccountBalance();
        return result.balance;
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] 4Payments balance fetch failed");
        return null;
    }
}

/**
 * Card statistics from the cards table + revenue from payments table.
 */
async function getCardStats(): Promise<{
    total: number | null;
    active: number | null;
    frozen: number | null;
    last24h: number | null;
    uniqueWallets: number | null;
    totalVolume: number | null;
    totalRevenue: number | null;
    totalCardBalance: number | null;
}> {
    try {
        const rows = await query<{
            total: string;
            active: string;
            frozen: string;
            last24h: string;
            unique_wallets: string;
            total_card_balance: string;
        }>(`
            SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE status = 'active') as active,
                COUNT(*) FILTER (WHERE status = 'frozen') as frozen,
                COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as last24h,
                COUNT(DISTINCT wallet_address) as unique_wallets,
                COALESCE(SUM(balance), 0) as total_card_balance
            FROM cards
        `);

        // Revenue & Volume from payments (amount is in stroops: 1e7 = 1 USDC)
        const payRows = await query<{
            total_volume: string;
            total_revenue: string;
        }>(`
            SELECT
                COALESCE(SUM(amount::numeric / 10000000), 0) as total_volume,
                COALESCE(SUM(amount::numeric / 10000000 - tier_amount), 0) as total_revenue
            FROM payments
            WHERE status = 'settled'
        `);

        const r = rows[0];
        const p = payRows[0];
        return {
            total: parseInt(r.total, 10),
            active: parseInt(r.active, 10),
            frozen: parseInt(r.frozen, 10),
            last24h: parseInt(r.last24h, 10),
            uniqueWallets: parseInt(r.unique_wallets, 10),
            totalCardBalance: parseFloat(r.total_card_balance),
            totalVolume: parseFloat(p.total_volume),
            totalRevenue: parseFloat(p.total_revenue),
        };
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] Card stats query failed");
        return {
            total: null,
            active: null,
            frozen: null,
            last24h: null,
            uniqueWallets: null,
            totalVolume: null,
            totalRevenue: null,
            totalCardBalance: null,
        };
    }
}

/**
 * Linked Telegram accounts count.
 */
async function getLinkedAccounts(): Promise<number | null> {
    try {
        const rows = await query<{ count: string }>(
            `SELECT COUNT(*) as count FROM owner_telegram_links WHERE status = 'active'`
        );
        return parseInt(rows[0].count, 10);
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] Telegram bindings query failed");
        return null;
    }
}

/**
 * Webhook event stats from last 24 hours.
 */
async function getWebhookStats(): Promise<{
    count24h: number | null;
    lastAgo: string | null;
    errors24h: number | null;
}> {
    try {
        const rows = await query<{
            total: string;
            last_received: string | null;
        }>(`
            SELECT
                COUNT(*) FILTER (WHERE received_at >= NOW() - INTERVAL '24 hours') as total,
                MAX(received_at) as last_received
            FROM webhook_events
        `);

        const r = rows[0];
        const count24h = parseInt(r.total, 10);

        let lastAgo: string | null = null;
        if (r.last_received) {
            const diffMs = Date.now() - new Date(r.last_received).getTime();
            const mins = Math.floor(diffMs / 60000);
            if (mins < 60) {
                lastAgo = `${mins}m ago`;
            } else {
                const hours = Math.floor(mins / 60);
                lastAgo = `${hours}h ${mins % 60}m ago`;
            }
        }

        return { count24h, lastAgo, errors24h: 0 };
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] Webhook stats query failed");
        return { count24h: null, lastAgo: null, errors24h: null };
    }
}

/**
 * Daily Active Agents — unique wallets active today, yesterday, 7 days, 30 days.
 */
async function getDailyActiveAgents(): Promise<{
    today: number | null;
    yesterday: number | null;
    last7d: number | null;
    last30d: number | null;
}> {
    try {
        const rows = await query<{
            daa_today: string;
            daa_yesterday: string;
            daa_7d: string;
            daa_30d: string;
        }>(`
            SELECT
                COUNT(DISTINCT wallet_address) FILTER (WHERE request_date = CURRENT_DATE) as daa_today,
                COUNT(DISTINCT wallet_address) FILTER (WHERE request_date = CURRENT_DATE - 1) as daa_yesterday,
                COUNT(DISTINCT wallet_address) FILTER (WHERE request_date >= CURRENT_DATE - INTERVAL '7 days') as daa_7d,
                COUNT(DISTINCT wallet_address) FILTER (WHERE request_date >= CURRENT_DATE - INTERVAL '30 days') as daa_30d
            FROM api_activity
        `);
        return {
            today: parseInt(rows[0].daa_today, 10),
            yesterday: parseInt(rows[0].daa_yesterday, 10),
            last7d: parseInt(rows[0].daa_7d, 10),
            last30d: parseInt(rows[0].daa_30d, 10),
        };
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] DAA query failed");
        return { today: null, yesterday: null, last7d: null, last30d: null };
    }
}

/**
 * Install and visit analytics.
 */
async function getAnalytics(): Promise<{
    installsToday: number | null;
    installs7d: number | null;
    installsTotal: number | null;
    visitsToday: number | null;
    agentVisitsToday: number | null;
    visits7d: number | null;
}> {
    try {
        const rows = await query<{
            installs_today: string;
            installs_7d: string;
            installs_total: string;
            visits_today: string;
            agent_visits_today: string;
            visits_7d: string;
        }>(`
            SELECT
              (SELECT COUNT(*) FROM install_events WHERE created_at >= CURRENT_DATE)::text as installs_today,
              (SELECT COUNT(*) FROM install_events WHERE created_at >= now() - INTERVAL '7 days')::text as installs_7d,
              (SELECT COUNT(*) FROM install_events)::text as installs_total,
              (SELECT COUNT(*) FROM page_visits WHERE created_at >= CURRENT_DATE)::text as visits_today,
              (SELECT COUNT(*) FROM page_visits WHERE created_at >= CURRENT_DATE AND is_agent = true)::text as agent_visits_today,
              (SELECT COUNT(*) FROM page_visits WHERE created_at >= now() - INTERVAL '7 days')::text as visits_7d
        `);
        const r = rows[0];
        return {
            installsToday: parseInt(r.installs_today, 10),
            installs7d: parseInt(r.installs_7d, 10),
            installsTotal: parseInt(r.installs_total, 10),
            visitsToday: parseInt(r.visits_today, 10),
            agentVisitsToday: parseInt(r.agent_visits_today, 10),
            visits7d: parseInt(r.visits_7d, 10),
        };
    } catch (err) {
        appLogger.error({ err }, "[StatusCollector] Analytics query failed");
        return {
            installsToday: null, installs7d: null, installsTotal: null,
            visitsToday: null, agentVisitsToday: null, visits7d: null,
        };
    }
}

// ── Main Collector ─────────────────────────────────────────

/**
 * Collect all status data in parallel. Each source is independent
 * and fail-safe — a failed source returns null, doesn't block others.
 */
export async function collectStatus(): Promise<AdminStatus> {
    const [
        treasuryUsdc,
        fpBalance,
        cardStats,
        linkedAccounts,
        webhookStats,
        daa,
        analytics,
    ] = await Promise.all([
        getTreasuryBalance(),
        get4PaymentsBalance(),
        getCardStats(),
        getLinkedAccounts(),
        getWebhookStats(),
        getDailyActiveAgents(),
        getAnalytics(),
    ]);

    return {
        finances: {
            treasuryUsdc,
            fourPaymentsBalance: fpBalance,
            totalRevenue: cardStats.totalRevenue,
            totalVolume: cardStats.totalVolume,
            totalCardBalance: cardStats.totalCardBalance,
        },
        clients: {
            total: cardStats.uniqueWallets,
            linked: linkedAccounts,
            daaToday: daa.today,
            daaYesterday: daa.yesterday,
            daa7d: daa.last7d,
            maa: daa.last30d,
        },
        cards: {
            total: cardStats.total,
            active: cardStats.active,
            frozen: cardStats.frozen,
            last24h: cardStats.last24h,
        },
        analytics,
        system: {
            uptimeSeconds: process.uptime(),
            memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            nodeVersion: process.version,
            webhooks24h: webhookStats.count24h,
            lastWebhookAgo: webhookStats.lastAgo,
            errors24h: webhookStats.errors24h,
        },
    };
}

// ── Formatter ──────────────────────────────────────────────

function fmt(n: number | null, prefix = "$"): string {
    if (n === null) return "⚠️ N/A";
    if (prefix === "$") return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return n.toLocaleString("en-US");
}

function fmtNum(n: number | null): string {
    if (n === null) return "⚠️ N/A";
    return n.toLocaleString("en-US");
}

/**
 * Format collected status data as a Telegram HTML message.
 */
export function formatStatusMessage(s: AdminStatus): string {
    const hours = Math.floor(s.system.uptimeSeconds / 3600);
    const mins = Math.floor((s.system.uptimeSeconds % 3600) / 60);

    return (
        `📊 <b>ASG Card — System Status</b>\n\n` +

        `💰 <b>Finances</b>\n` +
        `├ Treasury: ${s.finances.treasuryUsdc !== null ? fmt(s.finances.treasuryUsdc, "$") + " USDC" : "⚠️ N/A"}\n` +
        `├ Issuer Acct: ${fmt(s.finances.fourPaymentsBalance)}\n` +
        `├ Card Balances: ${fmt(s.finances.totalCardBalance)}\n` +
        `├ Revenue (fees): ${fmt(s.finances.totalRevenue)}\n` +
        `└ Volume (paid): ${fmt(s.finances.totalVolume)}\n\n` +

        `👥 <b>Clients & Cards</b>\n` +
        `├ Wallets: ${fmtNum(s.clients.total)}\n` +
        `├ TG Linked: ${fmtNum(s.clients.linked)}\n` +
        `├ DAA (today): ${fmtNum(s.clients.daaToday)}\n` +
        `├ DAA (7d): ${fmtNum(s.clients.daa7d)}\n` +
        `├ MAA (30d): ${fmtNum(s.clients.maa)}\n` +
        `├ Cards total: ${fmtNum(s.cards.total)}\n` +
        `├ Active: ${fmtNum(s.cards.active)}\n` +
        `├ Frozen: ${fmtNum(s.cards.frozen)}\n` +
        `└ Cards 24h: +${fmtNum(s.cards.last24h)}\n\n` +

        `📈 <b>Analytics</b>\n` +
        `├ Installs today: ${fmtNum(s.analytics.installsToday)}\n` +
        `├ Installs 7d: ${fmtNum(s.analytics.installs7d)}\n` +
        `├ Installs total: ${fmtNum(s.analytics.installsTotal)}\n` +
        `├ Visits today: ${fmtNum(s.analytics.visitsToday)}\n` +
        `├ Agent visits: ${fmtNum(s.analytics.agentVisitsToday)}\n` +
        `└ Visits 7d: ${fmtNum(s.analytics.visits7d)}\n\n` +

        `🔗 <b>System</b>\n` +
        `├ Uptime: ${hours}h ${mins}m\n` +
        `├ Memory: ${s.system.memoryMb} MB\n` +
        `├ Node: ${s.system.nodeVersion}\n` +
        `├ Webhooks 24h: ${fmtNum(s.system.webhooks24h)}\n` +
        `├ Last webhook: ${s.system.lastWebhookAgo ?? "never"}\n` +
        `└ Errors 24h: ${fmtNum(s.system.errors24h)}`
    );
}

// ── Daily Report ───────────────────────────────────────────

function delta(today: number | null, yesterday: number | null): string {
    if (today === null || yesterday === null) return "";
    const diff = today - yesterday;
    if (diff === 0) return " (=)";
    return diff > 0 ? ` (+${diff} ↑)` : ` (${diff} ↓)`;
}

/**
 * Format a rich daily report for the admin. Includes trend deltas.
 */
export function formatDailyReport(s: AdminStatus): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    return (
        `📋 <b>Daily Ops Report</b>\n` +
        `📅 ${dateStr}\n\n` +

        `🤖 <b>Agent Activity</b>\n` +
        `├ DAA today: <b>${fmtNum(s.clients.daaToday)}</b>${delta(s.clients.daaToday, s.clients.daaYesterday)}\n` +
        `├ DAA yesterday: ${fmtNum(s.clients.daaYesterday)}\n` +
        `├ WAA (7d): ${fmtNum(s.clients.daa7d)}\n` +
        `└ MAA (30d): ${fmtNum(s.clients.maa)}\n\n` +

        `💰 <b>Finances</b>\n` +
        `├ Treasury: ${s.finances.treasuryUsdc !== null ? fmt(s.finances.treasuryUsdc, "$") + " USDC" : "⚠️ N/A"}\n` +
        `├ Issuer Acct: ${fmt(s.finances.fourPaymentsBalance)}\n` +
        `├ Card Balances: ${fmt(s.finances.totalCardBalance)}\n` +
        `├ Revenue (fees): ${fmt(s.finances.totalRevenue)}\n` +
        `└ Volume (paid): ${fmt(s.finances.totalVolume)}\n\n` +

        `💳 <b>Cards</b>\n` +
        `├ Total: ${fmtNum(s.cards.total)} (active: ${fmtNum(s.cards.active)})\n` +
        `├ New 24h: +${fmtNum(s.cards.last24h)}\n` +
        `└ Unique wallets: ${fmtNum(s.clients.total)}\n\n` +

        `📈 <b>Growth</b>\n` +
        `├ Installs today: <b>${fmtNum(s.analytics.installsToday)}</b>\n` +
        `├ Installs 7d: ${fmtNum(s.analytics.installs7d)}\n` +
        `├ Installs total: ${fmtNum(s.analytics.installsTotal)}\n` +
        `├ Visits today: ${fmtNum(s.analytics.visitsToday)}\n` +
        `├ Agent visits: ${fmtNum(s.analytics.agentVisitsToday)}\n` +
        `└ Visits 7d: ${fmtNum(s.analytics.visits7d)}\n\n` +

        `🔗 <b>System</b>\n` +
        `├ Webhooks 24h: ${fmtNum(s.system.webhooks24h)}\n` +
        `├ Errors 24h: ${fmtNum(s.system.errors24h)}\n` +
        `└ Last webhook: ${s.system.lastWebhookAgo ?? "never"}`
    );
}

/**
 * Collect and send the daily report to all admin chats.
 * Used by cron and /report command.
 */
export async function sendDailyReport(): Promise<void> {
    const { AdminBot } = await import("./adminBot");
    const status = await collectStatus();
    const message = formatDailyReport(status);
    await AdminBot.send(message);
}
