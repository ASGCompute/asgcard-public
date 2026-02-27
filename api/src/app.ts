import cors from "cors";
import express from "express";
import { paidRouter } from "./routes/paid";
import { publicRouter } from "./routes/public";
import { walletRouter } from "./routes/wallet";
import { webhookRouter } from "./routes/webhook";

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

  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  return app;
};
