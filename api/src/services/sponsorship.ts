/**
 * SponsorshipService — Treasury Sandwich for gasless wallet activation.
 *
 * Builds and submits sponsored transactions:
 *   BeginSponsoringFutureReserves (Treasury)
 *   CreateAccount (user, starting balance: 0)
 *   ChangeTrust (user, USDC)
 *   EndSponsoringFutureReserves (user)
 *
 * Treasury signs first, user co-signs, then submit to Horizon.
 *
 * @module services/sponsorship
 */

import {
  Keypair,
  TransactionBuilder,
  Networks,
  Operation,
  Asset,
  Horizon,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { query } from "../db/db";
import { env } from "../config/env";
import { AuditService } from "../modules/authz/auditService";
import { appLogger } from "../utils/logger";

// ── Constants ──────────────────────────────────────────────

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);
const XLM_RESERVED_PER_ACCOUNT = 1.5; // 1.0 base + 0.5 trustline

// ── Types ──────────────────────────────────────────────────

export interface SponsorshipResult {
  success: boolean;
  xdr?: string;
  error?: string;
}

export interface SubmitResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

// ── Service ────────────────────────────────────────────────

export class SponsorshipService {
  /**
   * Build a sponsored account activation XDR.
   * Signs with Treasury key. Returns XDR for user co-signing.
   *
   * Abuse gates checked before calling this method.
   */
  static async buildSponsoredXdr(
    userPublicKey: string,
    ip?: string
  ): Promise<SponsorshipResult> {
    if (!env.STELLAR_TREASURY_SECRET) {
      return { success: false, error: "Treasury not configured" };
    }

    try {
      const treasury = Keypair.fromSecret(env.STELLAR_TREASURY_SECRET);
      const horizon = new Horizon.Server(env.STELLAR_HORIZON_URL);

      // Load treasury account for sequence number
      const treasuryAccount = await horizon.loadAccount(treasury.publicKey());

      // Check if user account already exists
      try {
        await horizon.loadAccount(userPublicKey);
        return { success: false, error: "Account already exists on Stellar" };
      } catch (e: unknown) {
        // 404 = account doesn't exist, which is what we want
        if (!(e instanceof Error) || !e.message.includes("404")) {
          throw e; // Re-throw non-404 errors
        }
      }

      // Build the sponsored transaction (Treasury Sandwich)
      const tx = new TransactionBuilder(treasuryAccount, {
        fee: BASE_FEE,
        networkPassphrase: Networks.PUBLIC,
      })
        // 1. Treasury begins sponsoring
        .addOperation(
          Operation.beginSponsoringFutureReserves({
            sponsoredId: userPublicKey,
            source: treasury.publicKey(),
          })
        )
        // 2. Create the user account (starting balance: 0)
        .addOperation(
          Operation.createAccount({
            destination: userPublicKey,
            startingBalance: "0",
            source: treasury.publicKey(),
          })
        )
        // 3. Add USDC trustline (source: user — they trust USDC)
        .addOperation(
          Operation.changeTrust({
            asset: USDC_ASSET,
            source: userPublicKey,
          })
        )
        // 4. User ends sponsoring (confirms acceptance)
        .addOperation(
          Operation.endSponsoringFutureReserves({
            source: userPublicKey,
          })
        )
        .setTimeout(300) // 5 minutes
        .build();

      // Treasury signs first
      tx.sign(treasury);

      const xdr = tx.toXDR();

      // Store the sponsorship XDR
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
        [
          userPublicKey,
          xdr,
          ["CreateAccount", "ChangeTrust"],
          XLM_RESERVED_PER_ACCOUNT,
          ip ?? null,
        ]
      );

      // Update wallet status
      await query(
        `UPDATE wallets SET status = 'pending_sponsor' WHERE wallet_address = $1`,
        [userPublicKey]
      );

      // Log onboard event
      await query(
        `INSERT INTO onboard_events (wallet_address, step, metadata)
        VALUES ($1, 'sponsor_xdr_built', $2)`,
        [userPublicKey, JSON.stringify({ ops: ["CreateAccount", "ChangeTrust"] })]
      );

      await AuditService.log({
        actorType: "system",
        actorId: "sponsorship_service",
        action: "sponsor_xdr_built",
        resourceId: userPublicKey,
        decision: "allow",
        ipAddress: ip,
      });

      return { success: true, xdr };
    } catch (error) {
      appLogger.error({ err: error }, "[SPONSOR] Failed to build XDR");
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Submit a co-signed sponsored transaction to Horizon.
   */
  static async submitSignedXdr(
    walletAddress: string,
    signedXdr: string,
    ip?: string
  ): Promise<SubmitResult> {
    try {
      const horizon = new Horizon.Server(env.STELLAR_HORIZON_URL);

      // Validate: stored XDR must match the wallet
      const stored = await query<{ sponsor_xdr: string; status: string }>(
        `SELECT sponsor_xdr, status FROM wallet_sponsorships
        WHERE wallet_address = $1`,
        [walletAddress]
      );

      if (stored.length === 0) {
        return { success: false, error: "No pending sponsorship found" };
      }

      if (stored[0].status !== "pending") {
        return { success: false, error: `Sponsorship status is '${stored[0].status}', expected 'pending'` };
      }

      // Update status to 'submitted'
      await query(
        `UPDATE wallet_sponsorships SET status = 'submitted' WHERE wallet_address = $1`,
        [walletAddress]
      );
      await query(
        `UPDATE wallets SET status = 'sponsoring' WHERE wallet_address = $1`,
        [walletAddress]
      );

      // Submit to Horizon
      const tx = TransactionBuilder.fromXDR(signedXdr, Networks.PUBLIC);
      const result = await horizon.submitTransaction(tx);

      const txHash = (result as { hash?: string }).hash ?? "unknown";

      // Mark as confirmed
      await query(
        `UPDATE wallet_sponsorships
        SET status = 'confirmed', sponsor_tx_hash = $2, confirmed_at = now()
        WHERE wallet_address = $1`,
        [walletAddress, txHash]
      );
      await query(
        `UPDATE wallets SET status = 'active', sponsored_at = now() WHERE wallet_address = $1`,
        [walletAddress]
      );

      await query(
        `INSERT INTO onboard_events (wallet_address, step, metadata)
        VALUES ($1, 'sponsored', $2)`,
        [walletAddress, JSON.stringify({ txHash })]
      );

      await AuditService.log({
        actorType: "system",
        actorId: "sponsorship_service",
        action: "sponsor_confirmed",
        resourceId: walletAddress,
        decision: "allow",
        ipAddress: ip,
      });

      appLogger.info({ wallet: walletAddress, txHash }, "[SPONSOR] Account activated");

      return { success: true, txHash };
    } catch (error) {
      // Mark as failed
      await query(
        `UPDATE wallet_sponsorships
        SET status = 'failed', error = $2
        WHERE wallet_address = $1`,
        [walletAddress, (error as Error).message]
      ).catch(() => {});
      await query(
        `UPDATE wallets SET status = 'failed' WHERE wallet_address = $1`,
        [walletAddress]
      ).catch(() => {});

      appLogger.error({ err: error, wallet: walletAddress }, "[SPONSOR] Submit failed");
      return { success: false, error: (error as Error).message };
    }
  }

  // ── Abuse Prevention ────────────────────────────────────

  /**
   * Check if sponsorship is allowed for this IP.
   */
  static async checkIpRateLimit(ip: string): Promise<boolean> {
    const limit = env.SPONSOR_IP_RATE_LIMIT ?? 3;
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM wallet_sponsorships
      WHERE ip_address = $1 AND created_at > now() - interval '1 hour'`,
      [ip]
    );
    return Number(rows[0].count) < limit;
  }

  /**
   * Check if daily sponsorship budget is exceeded.
   */
  static async checkDailyBudget(): Promise<boolean> {
    const limit = env.SPONSOR_DAILY_BUDGET ?? 100;
    const rows = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM wallet_sponsorships
      WHERE created_at > now() - interval '24 hours'
        AND status IN ('pending', 'submitted', 'confirmed')`,
      []
    );
    return Number(rows[0].count) < limit;
  }
}
