/**
 * Onboard Routes — Lifecycle endpoints for new wallet onboarding.
 *
 * POST /onboard/register       — Register wallet + get TG deep-link
 * POST /onboard/submit-sponsor — Submit co-signed sponsorship XDR
 *
 * All routes require wallet authentication.
 *
 * @module routes/onboard
 */

import { Router } from "express";
import { requireWalletAuth } from "../middleware/walletAuth";
import { query } from "../db/db";
import { LinkService } from "../modules/portal/linkService";
import { SponsorshipService } from "../services/sponsorship";
import { AuditService } from "../modules/authz/auditService";
import { appLogger } from "../utils/logger";

export const onboardRouter = Router();

onboardRouter.use(requireWalletAuth);

/**
 * POST /onboard/register
 *
 * 1. Upsert wallet in wallets table
 * 2. Issue TG deep-link token
 * 3. Return link + status
 */
onboardRouter.post("/register", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const walletAddress = req.walletContext.address;
  const clientType = req.body?.clientType ?? "manual";

  try {
    // Upsert wallet (idempotent — safe to re-run)
    await query(
      `INSERT INTO wallets (wallet_address, client_type, ip_address)
      VALUES ($1, $2, $3)
      ON CONFLICT (wallet_address) DO UPDATE SET
        client_type = COALESCE(EXCLUDED.client_type, wallets.client_type),
        ip_address = EXCLUDED.ip_address`,
      [walletAddress, clientType, req.ip ?? null]
    );

    // Check current status
    const rows = await query<{ status: string }>(
      `SELECT status FROM wallets WHERE wallet_address = $1`,
      [walletAddress]
    );
    const status = rows[0]?.status ?? "pending_identity";

    // If already active, return status without new TG link
    if (status === "active") {
      res.json({
        registered: true,
        status: "active",
        message: "Wallet already active. Onboarding complete.",
      });
      return;
    }

    // If already has pending sponsor XDR, skip TG link
    if (status === "pending_sponsor" || status === "sponsoring") {
      const sponsorship = await query<{ sponsor_xdr: string }>(
        `SELECT sponsor_xdr FROM wallet_sponsorships WHERE wallet_address = $1 AND status = 'pending'`,
        [walletAddress]
      );

      res.json({
        registered: true,
        status,
        pendingXdr: sponsorship[0]?.sponsor_xdr ?? null,
        message: "Telegram already connected. Co-sign pending.",
      });
      return;
    }

    // Issue TG deep-link token for identity binding
    const tokenResult = await LinkService.issueToken(walletAddress, req.ip);

    // Log funnel event
    await query(
      `INSERT INTO onboard_events (wallet_address, step, metadata)
      VALUES ($1, 'register', $2)`,
      [walletAddress, JSON.stringify({ clientType })]
    );

    await AuditService.log({
      actorType: "wallet_owner",
      actorId: walletAddress,
      action: "onboard_register",
      decision: "allow",
      ipAddress: req.ip,
    });

    res.json({
      registered: true,
      status: "pending_identity",
      telegramLink: tokenResult.deepLink,
      expiresAt: tokenResult.expiresAt,
      message: "Open the Telegram link to connect your financial identity.",
    });
  } catch (error) {
    appLogger.error({ err: error }, "[ONBOARD] register error");
    res.status(500).json({ error: "Failed to register wallet" });
  }
});

/**
 * POST /onboard/submit-sponsor
 *
 * Accepts user co-signed XDR and submits to Horizon.
 */
onboardRouter.post("/submit-sponsor", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const walletAddress = req.walletContext.address;
  const signedXdr = req.body?.signedXdr;

  if (!signedXdr || typeof signedXdr !== "string") {
    res.status(400).json({ error: "Missing signedXdr in request body" });
    return;
  }

  try {
    const result = await SponsorshipService.submitSignedXdr(
      walletAddress,
      signedXdr,
      req.ip
    );

    if (result.success) {
      res.json({
        success: true,
        txHash: result.txHash,
        message: "Wallet activated on Stellar! USDC trustline established.",
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    appLogger.error({ err: error }, "[ONBOARD] submit-sponsor error");
    res.status(500).json({ error: "Failed to submit sponsored transaction" });
  }
});
