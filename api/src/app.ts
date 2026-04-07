import cors from "cors";
import express from "express";
import { paidRouter } from "./routes/paid";
import { publicRouter } from "./routes/public";
import { walletRouter } from "./routes/wallet";
import { webhookRouter } from "./routes/webhook";
import { opsRouter } from "./routes/ops";
import { env } from "./config/env";
import { httpLogger, appLogger } from "./utils/logger";

export const createApp = async () => {
  const app = express();

  app.use(cors());
  app.use(httpLogger);

  // Webhook route needs raw body for HMAC — mount BEFORE json parser
  app.use("/webhooks", express.raw({ type: "application/json" }), webhookRouter);

  // All other routes use json parser
  app.use(express.json());

  app.use(publicRouter);
  app.use("/cards", paidRouter);
  app.use("/cards", walletRouter);
  app.use("/ops", opsRouter);

  // ── Telegram Bot (feature-flagged) ─────────────────────────
  if (env.TG_BOT_ENABLED === "true") {
    const { botRouter } = await import("./modules/bot");
    app.use("/bot", botRouter);
    appLogger.info("[APP] Telegram bot module enabled → /bot/*");
  }

  // ── Owner Portal (feature-flagged) ─────────────────────────
  if (env.OWNER_PORTAL_ENABLED === "true") {
    const { portalRouter } = await import("./modules/portal");
    app.use("/portal", portalRouter);
    appLogger.info("[APP] Owner portal module enabled → /portal/*");
  }

  // ── Admin Bot (feature-flagged) ────────────────────────────
  if (env.ADMIN_BOT_ENABLED === "true") {
    const { adminRouter } = await import("./modules/admin");
    app.use("/admin", adminRouter);
    appLogger.info("[APP] Admin bot module enabled → /admin/*");
    // Note: startup notification removed — fires on every Vercel cold start
  }

  // ── Onboarding & Wallet Status (feature-flagged) ─────────
  if (env.ONBOARDING_ENABLED === "true") {
    const { onboardRouter } = await import("./routes/onboard");
    const { walletStatusRouter } = await import("./routes/walletStatus");
    const { sponsorshipMonitorRouter } = await import("./routes/sponsorshipMonitor");
    app.use("/onboard", onboardRouter);
    app.use("/wallet", walletStatusRouter);
    app.use("/ops", sponsorshipMonitorRouter);
    appLogger.info("[APP] Onboarding module enabled → /onboard/*, /wallet/*, /ops/sponsorship");
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  return app;
};
