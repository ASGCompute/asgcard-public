/**
 * Activity Service — DAA (Daily Active Agents) tracking.
 *
 * Fire-and-forget, fail-open. Never blocks the payment flow.
 * Calls the upsert_api_activity(wallet) DB function.
 */
import { getPool } from "../db/db";
import { appLogger } from "../utils/logger";

/**
 * Track a wallet as active for DAA.
 * Non-blocking, fail-open — swallows all errors.
 */
export function trackActivity(walletAddress: string): void {
  writeActivity(walletAddress).catch((err) => {
    appLogger.error(
      `[activity:fail-open] ${(err as Error).message ?? err}`
    );
  });
}

async function writeActivity(walletAddress: string): Promise<void> {
  try {
    let pool;
    try {
      pool = getPool();
    } catch {
      return; // inmemory mode — skip
    }

    await pool.query(`SELECT upsert_api_activity($1)`, [walletAddress]);
  } catch {
    return; // fail-open
  }
}
