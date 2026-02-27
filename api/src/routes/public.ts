import { Router } from "express";
import { env } from "../config/env";
import { CREATION_TIERS, FUNDING_TIERS } from "../config/pricing";

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
