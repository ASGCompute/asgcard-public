import cors from "cors";
import express from "express";
import { paidRouter } from "./routes/paid";
import { publicRouter } from "./routes/public";
import { walletRouter } from "./routes/wallet";

export const createApp = () => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use(publicRouter);
  app.use("/cards", paidRouter);
  app.use("/cards", walletRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not Found" });
  });

  return app;
};
