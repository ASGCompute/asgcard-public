/**
 * ASG Card Pricing
 *
 * Card creation: flat $10 (no load required)
 * Top-up: amount + 3.5%
 * Initial load on creation: optional, same 3.5% fee applies
 */

export const CARD_FEE = 10;           // $10 flat card issuance
export const TOPUP_RATE = 0.035;      // 3.5% on every top-up / initial load
export const MIN_AMOUNT = 5;          // Minimum top-up/load amount (when loading)
export const MAX_AMOUNT = 5000;

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/**
 * Total cost to create a card.
 * - amount = 0 → $10 (card fee only, no initial load)
 * - amount > 0 → $10 + amount + amount × 3.5% (card fee + load + fee on load)
 */
export const calcCreationCost = (amount: number): number =>
  amount <= 0
    ? CARD_FEE
    : roundCents(CARD_FEE + amount + amount * TOPUP_RATE);

/** Total cost to top up a card. */
export const calcFundingCost = (amount: number): number =>
  roundCents(amount + amount * TOPUP_RATE);

/**
 * Is this amount valid for a top-up / initial load?
 * Zero is valid for card creation (no load).
 */
export const isValidAmount = (amount: number): boolean =>
  Number.isFinite(amount) && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;

/**
 * Is this amount valid for card creation?
 * 0 = card-only, or MIN_AMOUNT..MAX_AMOUNT for loaded creation.
 */
export const isValidCreateAmount = (amount: number): boolean =>
  Number.isFinite(amount) && (amount === 0 || (amount >= MIN_AMOUNT && amount <= MAX_AMOUNT));

/**
 * Convert USD to Stellar USDC atomic units (7 decimal places).
 */
export const toAtomicUsdc = (usd: number): string =>
  Math.round(usd * 10_000_000).toString();
