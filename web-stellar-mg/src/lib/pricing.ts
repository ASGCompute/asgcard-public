// Reused for rollout speed. Switch to dedicated Stellar API host when available.
const PRODUCTION_API_BASE_URL = 'https://api.asgcard.dev'

export interface CreationTierPrice {
  loadAmount: number
  issuanceFee: number
  topUpFee: number
  serviceFee: number
  totalCost: number
  endpoint: string
}

export interface FundingTierPrice {
  fundAmount: number
  topUpFee: number
  serviceFee: number
  totalCost: number
  endpoint: string
}

export interface LivePricingData {
  creationTiers: CreationTierPrice[]
  fundingTiers: FundingTierPrice[]
}

// ── Dynamic Pricing Model ──────────────────────────────────
// API returns flat: { cardFee, topUpPercent, minAmount, maxAmount }
// Tiers are computed client-side from: creation = amount + cardFee + amount × topUpPercent/100

interface PricingApiResponse {
  cardFee?: number
  topUpPercent?: number
  minAmount?: number
  maxAmount?: number
}

const SAMPLE_AMOUNTS = [25, 50, 100, 250, 500, 1000]

const round2 = (n: number): number => Math.round(n * 100) / 100

function buildCreationTiers(cardFee: number, topUpPercent: number): CreationTierPrice[] {
  return SAMPLE_AMOUNTS.map(amt => {
    const topUpFee = round2(amt * (topUpPercent / 100))
    const totalCost = round2(amt + cardFee + topUpFee)
    return {
      loadAmount: amt,
      issuanceFee: cardFee,
      topUpFee,
      serviceFee: 0,
      totalCost,
      endpoint: `/cards/create/tier/${amt}`,
    }
  })
}

function buildFundingTiers(topUpPercent: number): FundingTierPrice[] {
  return SAMPLE_AMOUNTS.map(amt => {
    const topUpFee = round2(amt * (topUpPercent / 100))
    const totalCost = round2(amt + topUpFee)
    return {
      fundAmount: amt,
      topUpFee,
      serviceFee: 0,
      totalCost,
      endpoint: `/cards/fund/tier/${amt}`,
    }
  })
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
    // Local development: prefer explicitly configured API origin, otherwise localhost API.
    if (configuredPricingUrl) {
      candidates.push(configuredPricingUrl)
    } else {
      candidates.push('http://localhost:3000/pricing')
    }
  } else {
    // In production / deployed previews, prefer same-origin rewrite first.
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
          headers: {
            Accept: 'application/json',
          },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeoutId)
      }

      if (!response.ok) continue

      const payload = (await response.json()) as PricingApiResponse

      const cardFee = payload.cardFee
      const topUpPercent = payload.topUpPercent

      if (typeof cardFee !== 'number' || typeof topUpPercent !== 'number') {
        continue
      }

      const creationTiers = buildCreationTiers(cardFee, topUpPercent)
      const fundingTiers = buildFundingTiers(topUpPercent)

      if (creationTiers.length === 0 && fundingTiers.length === 0) {
        continue
      }

      return { creationTiers, fundingTiers }
    } catch {
      // Try next endpoint candidate.
    }
  }

  return null
}
