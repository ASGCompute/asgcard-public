/**
 * ASG Card Pricing
 *
 * Card issuance: $10
 * Top-up: +3.5%
 */

export const CARD_FEE = 10;           // $10 flat card issuance
export const TOPUP_RATE = 0.035;      // 3.5% on every top-up
export const MIN_AMOUNT = 5;
export const MAX_AMOUNT = 5000;

const roundCents = (n: number): number => Math.round(n * 100) / 100;

/** Total cost to create a card with initial load. */
export const calcCreationCost = (amount: number): number =>
  roundCents(amount + CARD_FEE + amount * TOPUP_RATE);

/** Total cost to top up a card. */
export const calcFundingCost = (amount: number): number =>
  roundCents(amount + amount * TOPUP_RATE);

/** Is this amount within allowed bounds? */
export const isValidAmount = (amount: number): boolean =>
  Number.isFinite(amount) && amount >= MIN_AMOUNT && amount <= MAX_AMOUNT;

/**
 * Convert USD to Stellar USDC atomic units (7 decimal places).
 */
export const toAtomicUsdc = (usd: number): string =>
  Math.round(usd * 10_000_000).toString();
