import { Router } from "express";
import { requireWalletAuth } from "../middleware/walletAuth";
import { cardService, HttpError } from "../services/cardService";

export const walletRouter = Router();

walletRouter.use(requireWalletAuth);

walletRouter.get("/", (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const cards = cardService.listCards(req.walletContext.address);
  res.json({ cards });
});

walletRouter.get("/:cardId", (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  try {
    const result = cardService.getCard(req.walletContext.address, req.params.cardId);
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

walletRouter.get("/:cardId/details", (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  try {
    const result = cardService.getCardDetails(req.walletContext.address, req.params.cardId);
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

walletRouter.post("/:cardId/freeze", (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  try {
    const result = cardService.setCardStatus(
      req.walletContext.address,
      req.params.cardId,
      "frozen"
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

walletRouter.post("/:cardId/unfreeze", (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  try {
    const result = cardService.setCardStatus(
      req.walletContext.address,
      req.params.cardId,
      "active"
    );
    res.json(result);
  } catch (error) {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});
