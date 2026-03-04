import cors from "cors";
import express from "express";
import { paidRouter } from "./routes/paid";
import { publicRouter } from "./routes/public";
import { walletRouter } from "./routes/wallet";
import { webhookRouter } from "./routes/webhook";
import { opsRouter } from "./routes/ops";
import { env } from "./config/env";

export const createApp = () => {
  const app = express();

  app.use(cors());

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
    const { botRouter } = require("./modules/bot");
    app.use("/bot", botRouter);
    console.log("[APP] Telegram bot module enabled → /bot/*");
  }

  // ── Owner Portal (feature-flagged) ─────────────────────────
  if (env.OWNER_PORTAL_ENABLED === "true") {
    const { portalRouter } = require("./modules/portal");
    app.use("/portal", portalRouter);
    console.log("[APP] Owner portal module enabled → /portal/*");
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  return app;
};
