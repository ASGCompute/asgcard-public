const PRODUCTION_API_BASE_URL = 'https://api.asgcard.dev'

// ── Dynamic Pricing Model ──────────────────────────────────
// No more fixed tiers. Pricing is formula-based:
//   creation = amount + cardFee + amount × topUpPercent/100
//   funding  = amount + amount × topUpPercent/100

export interface DynamicPricingData {
  cardFee: number
  topUpPercent: number
  minAmount: number
  maxAmount: number
}

/** Calculate the total creation cost for a given amount. */
export const calcCreationCost = (amount: number, pricing: DynamicPricingData): number =>
  Math.round((amount + pricing.cardFee + amount * (pricing.topUpPercent / 100)) * 100) / 100

/** Calculate the total funding cost for a given amount. */
export const calcFundingCost = (amount: number, pricing: DynamicPricingData): number =>
  Math.round((amount + amount * (pricing.topUpPercent / 100)) * 100) / 100

// ── Defaults (fallback if API is unreachable) ─────────────
export const DEFAULT_PRICING: DynamicPricingData = {
  cardFee: 10,
  topUpPercent: 3.5,
  minAmount: 5,
  maxAmount: 5000,
}

// ── Tier display types (generated client-side from formulas) ──

export interface CreationTierPrice {
  loadAmount: number
  issuanceFee: number
  topUpFee: number
  serviceFee: number
  totalCost: number
}

export interface FundingTierPrice {
  fundAmount: number
  topUpFee: number
  serviceFee: number
  totalCost: number
}

export interface LivePricingData {
  creationTiers: CreationTierPrice[]
  fundingTiers: FundingTierPrice[]
  pricing: DynamicPricingData
}

const SAMPLE_AMOUNTS = [25, 50, 100, 250, 500, 1000]

const round2 = (n: number): number => Math.round(n * 100) / 100

function buildCreationTiers(p: DynamicPricingData): CreationTierPrice[] {
  return SAMPLE_AMOUNTS.map(amt => {
    const topUpFee = round2(amt * (p.topUpPercent / 100))
    return {
      loadAmount: amt,
      issuanceFee: p.cardFee,
      topUpFee,
      serviceFee: 0,
      totalCost: calcCreationCost(amt, p),
    }
  })
}

function buildFundingTiers(p: DynamicPricingData): FundingTierPrice[] {
  return SAMPLE_AMOUNTS.map(amt => {
    const topUpFee = round2(amt * (p.topUpPercent / 100))
    return {
      fundAmount: amt,
      topUpFee,
      serviceFee: 0,
      totalCost: calcFundingCost(amt, p),
    }
  })
}

// ── API fetching ──────────────────────────────────────────

interface PricingApiResponse {
  cardFee?: number
  topUpPercent?: number
  minAmount?: number
  maxAmount?: number
}

const normalizeBaseUrl = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')
const PRICING_REQUEST_TIMEOUT_MS = 3000

const getPricingCandidates = (): string[] => {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL
  const configuredPricingUrl = configuredBaseUrl
    ? `${normalizeBaseUrl(configuredBaseUrl)}/pricing`
    : null
  const candidates: string[] = []

  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  if (isLocal) {
    if (configuredPricingUrl) {
      candidates.push(configuredPricingUrl)
    } else {
      candidates.push('http://localhost:3000/pricing')
    }
  } else {
    candidates.push('/api/pricing')
    if (configuredPricingUrl) {
      candidates.push(configuredPricingUrl)
    } else {
      candidates.push(`${PRODUCTION_API_BASE_URL}/pricing`)
    }
  }

  return [...new Set(candidates)]
}

export const fetchLivePricingData = async (): Promise<LivePricingData | null> => {
  const candidates = getPricingCandidates()

  for (const endpoint of candidates) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), PRICING_REQUEST_TIMEOUT_MS)
      let response: Response
      try {
        response = await fetch(endpoint, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) continue

      const payload = (await response.json()) as PricingApiResponse

      const cardFee = payload.cardFee
      const topUpPercent = payload.topUpPercent
      const minAmount = payload.minAmount
      const maxAmount = payload.maxAmount

      if (
        typeof cardFee !== 'number' ||
        typeof topUpPercent !== 'number' ||
        typeof minAmount !== 'number' ||
        typeof maxAmount !== 'number'
      ) {
        continue
      }

      const pricing: DynamicPricingData = { cardFee, topUpPercent, minAmount, maxAmount }
      return {
        creationTiers: buildCreationTiers(pricing),
        fundingTiers: buildFundingTiers(pricing),
        pricing,
      }
    } catch {
      // Try next endpoint candidate.
    }
  }

  return null
}
