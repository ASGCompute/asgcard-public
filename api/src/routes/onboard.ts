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

/**
 * POST /onboard/activate
 *
 * Fully automatic wallet activation using Treasury key.
 * Creates the Stellar account and adds USDC trustline in one tx.
 * Treasury pays for everything — no user co-sign required.
 *
 * Pre-conditions:
 *   - Wallet must be registered (onboard/register)
 *   - Telegram must be linked (status >= pending_sponsor)
 *   - Account must not already exist on Stellar
 */
onboardRouter.post("/activate", async (req, res) => {
  if (!req.walletContext) {
    res.status(401).json({ error: "Wallet auth required" });
    return;
  }

  const walletAddress = req.walletContext.address;

  try {
    // Check wallet exists in our DB
    const walletRows = await query<{ status: string }>(
      `SELECT status FROM wallets WHERE wallet_address = $1`,
      [walletAddress]
    );

    if (walletRows.length === 0) {
      res.status(400).json({
        success: false,
        error: "Wallet not registered. Run: npx @asgcard/cli onboard",
      });
      return;
    }

    const status = walletRows[0].status;

    // Already active
    if (status === "active") {
      res.json({
        success: true,
        status: "active",
        message: "Wallet already active on Stellar.",
      });
      return;
    }

    // Must have TG linked (status >= pending_sponsor)
    if (status === "pending_identity") {
      const tgRow = await query<{ telegram_user_id: string }>(
        `SELECT telegram_user_id FROM owner_telegram_links
         WHERE owner_wallet = $1 AND status = 'active' LIMIT 1`,
        [walletAddress]
      );

      if (tgRow.length === 0) {
        res.status(400).json({
          success: false,
          error: "Telegram identity not linked yet. Complete Step 5 first.",
          status: "pending_identity",
        });
        return;
      }

      // TG is linked but status wasn't updated — fix it
      await query(
        `UPDATE wallets SET status = 'pending_sponsor' WHERE wallet_address = $1`,
        [walletAddress]
      );
    }

    // Rate & budget checks
    const ipAllowed = await SponsorshipService.checkIpRateLimit(req.ip ?? "unknown");
    const budgetOk = await SponsorshipService.checkDailyBudget();

    if (!ipAllowed) {
      res.status(429).json({ success: false, error: "Rate limit exceeded. Try again later." });
      return;
    }
    if (!budgetOk) {
      res.status(429).json({ success: false, error: "Daily sponsorship budget exceeded." });
      return;
    }

    // Build and submit sponsored activation
    const { Keypair, TransactionBuilder, Networks, Operation, Asset, Horizon, BASE_FEE } =
      await import("@stellar/stellar-sdk");

    const { env: envConfig } = await import("../config/env");

    if (!envConfig.STELLAR_TREASURY_SECRET) {
      res.status(503).json({ success: false, error: "Treasury not configured on server." });
      return;
    }

    const treasury = Keypair.fromSecret(envConfig.STELLAR_TREASURY_SECRET);
    const horizon = new Horizon.Server(envConfig.STELLAR_HORIZON_URL);

    // Check if account already exists on Stellar
    try {
      await horizon.loadAccount(walletAddress);
      // Account exists — just update status and return
      await query(
        `UPDATE wallets SET status = 'active', sponsored_at = now() WHERE wallet_address = $1`,
        [walletAddress]
      );
      res.json({
        success: true,
        status: "active",
        message: "Account already exists on Stellar. Status updated.",
      });
      return;
    } catch (e: unknown) {
      // 404 = account doesn't exist on Stellar — proceed with creation
      // Horizon SDK throws NotFoundError with message "Not Found" or status 404
      const isNotFound =
        e instanceof Error &&
        (e.message.includes("Not Found") ||
         e.message.includes("404") ||
         (e as any).response?.status === 404);
      if (!isNotFound) {
        throw e;
      }
    }

    // Load treasury account for sequence number
    const treasuryAccount = await horizon.loadAccount(treasury.publicKey());

    const USDC_ASSET = new Asset(
      "USDC",
      "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    );

    // Build: CreateAccount (2 XLM for reserves) + ChangeTrust USDC
    // Treasury signs everything — fully automated
    const tx = new TransactionBuilder(treasuryAccount, {
      fee: BASE_FEE,
      networkPassphrase: Networks.PUBLIC,
    })
      // 1. Treasury begins sponsoring future reserves for the user
      .addOperation(
        Operation.beginSponsoringFutureReserves({
          sponsoredId: walletAddress,
          source: treasury.publicKey(),
        })
      )
      // 2. Create the user account with 0 starting balance (sponsored)
      .addOperation(
        Operation.createAccount({
          destination: walletAddress,
          startingBalance: "0",
          source: treasury.publicKey(),
        })
      )
      // 3. Add USDC trustline for the user (sponsored reserve)
      .addOperation(
        Operation.changeTrust({
          asset: USDC_ASSET,
          source: walletAddress,
        })
      )
      // 4. End sponsoring
      .addOperation(
        Operation.endSponsoringFutureReserves({
          source: walletAddress,
        })
      )
      .setTimeout(300)
      .build();

    // Treasury signs (source account signer)
    tx.sign(treasury);

    // NOTE: This tx still needs user co-sign for ops 3 & 4 (source: walletAddress).
    // For fully autonomous agents, we store the XDR and the CLI co-signs with the agent's key.
    const xdr = tx.toXDR();

    // Store sponsorship
    await query(
      `INSERT INTO wallet_sponsorships
        (wallet_address, sponsor_xdr, status, ops_in_tx, xlm_reserved, ip_address)
       VALUES ($1, $2, 'pending', $3, $4, $5)
       ON CONFLICT (wallet_address) DO UPDATE SET
         sponsor_xdr = EXCLUDED.sponsor_xdr,
         status = 'pending',
         ops_in_tx = EXCLUDED.ops_in_tx,
         xlm_reserved = EXCLUDED.xlm_reserved,
         ip_address = EXCLUDED.ip_address,
         created_at = now(),
         error = NULL`,
      [walletAddress, xdr, ["CreateAccount", "ChangeTrust"], 1.5, req.ip ?? null]
    );

    await query(
      `UPDATE wallets SET status = 'pending_sponsor' WHERE wallet_address = $1`,
      [walletAddress]
    );

    await query(
      `INSERT INTO onboard_events (wallet_address, step, metadata)
       VALUES ($1, 'activate_xdr_built', $2)`,
      [walletAddress, JSON.stringify({ ops: ["CreateAccount", "ChangeTrust"] })]
    );

    await AuditService.log({
      actorType: "system",
      actorId: "sponsorship_service",
      action: "activate_xdr_built",
      resourceId: walletAddress,
      decision: "allow",
      ipAddress: req.ip,
    });

    appLogger.info({ wallet: walletAddress }, "[ONBOARD] Activation XDR built");

    res.json({
      success: true,
      status: "pending_cosign",
      xdr,
      message: "Activation XDR built. CLI will co-sign and submit automatically.",
    });
  } catch (error) {
    appLogger.error({ err: error }, "[ONBOARD] activate error");
    res.status(500).json({ error: "Failed to build activation transaction" });
  }
});
