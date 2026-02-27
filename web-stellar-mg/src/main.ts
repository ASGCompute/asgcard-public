import './style.css'
import {
  fetchLivePricingData,
  type CreationTierPrice as CreationTier,
  type FundingTierPrice as FundingTier,
} from './lib/pricing'

// ============================================================
// Types
// ============================================================

// ============================================================
// Live Pricing — fetched from GET /pricing on load
// ============================================================

let creationTiers: CreationTier[] = []
let fundingTiers: FundingTier[] = []
let pricingLoaded = false

async function fetchLivePricing(): Promise<void> {
  const livePricingData = await fetchLivePricingData()
  if (!livePricingData) return

  creationTiers = livePricingData.creationTiers
  fundingTiers = livePricingData.fundingTiers
  pricingLoaded = true
}

// ============================================================
// Data
// ============================================================

const FEATURES = [
  {
    icon: '⚡',
    title: 'Sub-Second Issuance',
    description: 'Card details returned in the same HTTP response. No polling, no webhooks, no waiting.',
  },
  {
    icon: '🔐',
    title: 'x402 Protocol Native',
    description: 'Built on the HTTP 402 standard. Agents pay at the protocol layer — no middleware, no wrappers.',
  },
  {
    icon: '🤖',
    title: 'Agent-First API',
    description: 'Designed for autonomous agents. No human-in-the-loop. Deterministic, stateless, fast.',
  },
]

const STEPS = [
  { num: 1, title: 'Send a Request', desc: 'Your agent hits the create endpoint. No auth headers, no API key, no pre-registration needed.', hint: 'POST /cards/create/tier/:amount' },
  { num: 2, title: 'Pay with USDC', desc: 'The server responds 402 with payment details on Stellar. Your x402 client auto-pays the exact USDC amount.', hint: '402 → X-Payment → retry' },
  { num: 3, title: 'Receive Card Details', desc: 'Card number, CVV, expiry, and billing address returned instantly in the response body.', hint: '201 { cardNumber, cvv, expiry }' },
  { num: 4, title: 'Start Spending', desc: 'Fund more, freeze, unfreeze — all via simple wallet-signed API calls. Full lifecycle control.', hint: '/cards/:cardId/freeze · /cards/:cardId/unfreeze' },
]

// ============================================================
// Helpers
// ============================================================

function fmtUsd(n: number): string {
  return '$' + n.toFixed(2)
}

function loadingRow(cols: number): string {
  return `<tr><td colspan="${cols}" class="text-center py-8 text-white/30 text-sm">Loading from <code class="text-asg-purple/60 font-mono text-xs">GET /pricing</code>\u2026</td></tr>`
}

function unavailableRow(cols: number): string {
  return `<tr><td colspan="${cols}" class="text-center py-8 text-white/35 text-sm">Pricing is temporarily unavailable. Please refresh in a few seconds.</td></tr>`
}

// ============================================================
// Render helpers
// ============================================================

function renderFeatureCard(f: typeof FEATURES[number]): string {
  return `
    <div class="surface p-8">
      <div class="text-2xl mb-4">${f.icon}</div>
      <h3 class="text-lg font-semibold tracking-tight mb-2">${f.title}</h3>
      <p class="text-sm text-white/50 leading-relaxed">${f.description}</p>
    </div>
  `
}

const STEP_ICONS = [
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="hiw-icon"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15l3-3 3 3"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="hiw-icon"><circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 18V6"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="hiw-icon"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>`,
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round" class="hiw-icon"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></svg>`,
]

function renderStep(s: typeof STEPS[number], i: number): string {
  return `
    <div class="hiw-step">
      <div class="hiw-step-icon">${STEP_ICONS[i]}</div>
      <div class="hiw-step-body">
        <span class="hiw-step-num">${String(s.num).padStart(2, '0')}</span>
        <h4 class="hiw-step-title">${s.title}</h4>
        <p class="hiw-step-desc">${s.desc}</p>
      </div>
    </div>
  `
}

function renderCreationRow(t: CreationTier, highlight: boolean): string {
  const cls = highlight ? 'bg-asg-purple/[0.04]' : ''
  return `
    <tr class="${cls} border-b border-white/[0.04]">
      <td class="py-3 pl-4 pr-3 font-mono text-sm text-white/80">${fmtUsd(t.loadAmount)}</td>
      <td class="py-3 px-3 font-mono text-sm text-white/50">${fmtUsd(t.issuanceFee)}</td>
      <td class="py-3 px-3 font-mono text-sm text-white/50">${fmtUsd(t.topUpFee)}</td>
      <td class="py-3 px-3 font-mono text-sm text-white/50">${fmtUsd(t.serviceFee)}</td>
      <td class="py-3 pl-3 pr-4 font-mono text-sm font-semibold text-white/90">${fmtUsd(t.totalCost)}</td>
    </tr>
  `
}

function renderFundingRow(t: FundingTier, highlight: boolean): string {
  const cls = highlight ? 'bg-asg-purple/[0.04]' : ''
  return `
    <tr class="${cls} border-b border-white/[0.04]">
      <td class="py-3 pl-4 pr-3 font-mono text-sm text-white/80">${fmtUsd(t.fundAmount)}</td>
      <td class="py-3 px-3 font-mono text-sm text-white/50">${fmtUsd(t.topUpFee)}</td>
      <td class="py-3 px-3 font-mono text-sm text-white/50">${fmtUsd(t.serviceFee)}</td>
      <td class="py-3 pl-3 pr-4 font-mono text-sm font-semibold text-white/90">${fmtUsd(t.totalCost)}</td>
    </tr>
  `
}

function renderCreationRows(): string {
  if (!creationTiers.length) return loadingRow(5)
  return creationTiers.map((t, i) => renderCreationRow(t, i === 2)).join('')
}

function renderFundingRows(): string {
  if (!fundingTiers.length) return loadingRow(4)
  return fundingTiers.map((t, i) => renderFundingRow(t, i === 2)).join('')
}

// ============================================================
// Render page
// ============================================================

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="min-h-screen">

    <!-- ─── Header ─── -->
    <header class="fixed top-0 left-0 right-0 z-50 transition-[background-color,border-color] duration-300 border-b border-transparent" id="header">
      <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <a href="/" class="flex items-center gap-2.5">
          <img src="/logo-mark.svg" alt="" class="w-7 h-7" aria-hidden="true" />
          <span class="font-semibold text-[15px] tracking-tight text-white/90">ASG Card</span>
        </a>

        <nav class="hidden md:flex items-center gap-8" aria-label="Main navigation">
          <a href="#features" class="nav-link">Features</a>
          <a href="#how-it-works" class="nav-link">How it Works</a>
          <a href="#pricing" class="nav-link">Pricing</a>
          <a href="/docs" class="nav-link">Docs</a>
        </nav>

        <div class="flex items-center gap-3">
          <a href="/docs#sdk-quick-start" class="hidden sm:inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-white/[0.06] border border-white/[0.08] text-white/70 hover:bg-white/[0.1] hover:text-white transition-colors">
            Get Started
          </a>
          <!-- Mobile hamburger -->
          <button id="mobile-menu-btn" class="md:hidden flex flex-col items-center justify-center w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.06] gap-[5px] transition-colors hover:bg-white/[0.08]" aria-label="Toggle mobile menu" aria-expanded="false" aria-controls="mobile-nav">
            <span class="block w-4 h-[1.5px] bg-white/60 rounded-full transition-transform" id="burger-top"></span>
            <span class="block w-4 h-[1.5px] bg-white/60 rounded-full transition-opacity" id="burger-mid"></span>
            <span class="block w-4 h-[1.5px] bg-white/60 rounded-full transition-transform" id="burger-bot"></span>
          </button>
        </div>
      </div>

      <!-- Mobile nav panel -->
      <div id="mobile-nav" class="md:hidden overflow-hidden transition-[max-height,opacity] duration-300 max-h-0 opacity-0 bg-asg-black/95 backdrop-blur-xl border-b border-white/[0.04]">
        <nav class="max-w-6xl mx-auto px-6 py-5 flex flex-col gap-3" aria-label="Mobile navigation">
          <a href="#features" class="mobile-nav-link text-[15px] py-2.5 text-white/50 hover:text-white transition-colors">Features</a>
          <a href="#how-it-works" class="mobile-nav-link text-[15px] py-2.5 text-white/50 hover:text-white transition-colors">How it Works</a>
          <a href="#pricing" class="mobile-nav-link text-[15px] py-2.5 text-white/50 hover:text-white transition-colors">Pricing</a>
          <a href="/docs" class="mobile-nav-link text-[15px] py-2.5 text-white/50 hover:text-white transition-colors">Docs</a>
          <a href="/docs#sdk-quick-start" class="btn-primary text-center text-sm mt-2">Get Started</a>
        </nav>
      </div>
    </header>

    <main class="relative z-10" id="main-content">

      <!-- ═══════════════ HERO ═══════════════ -->
      <section class="min-h-[100dvh] flex items-center pt-16">
        <div class="max-w-6xl mx-auto px-6 w-full grid lg:grid-cols-2 gap-16 lg:gap-20 items-center py-20 lg:py-0">

          <!-- Left: Copy -->
          <div class="space-y-7 animate-slide-up">
            <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06] text-xs font-medium text-asg-green tracking-wide">
              <span class="w-1.5 h-1.5 rounded-full bg-asg-green"></span>
              Powered by x402 on Stellar
            </div>

            <h1 class="text-4xl sm:text-5xl lg:text-[3.5rem] font-bold leading-[1.08] tracking-[-0.03em] text-white">
              Virtual Cards<br>for <span class="text-asg-purple">AI Agents.</span>
            </h1>

            <p class="text-base sm:text-lg text-white/45 max-w-lg leading-relaxed">
              Give your AI agent a spending card. Issues virtual debit cards on demand — paid with USDC on Stellar via x402.
              <span class="text-white/65">Card details in seconds.</span>
            </p>



            <div class="pt-1">
              <a href="/docs" class="btn-secondary w-full sm:w-auto text-center">View Docs</a>
            </div>

            <!-- Easy Install -->
            <div class="hero-install">
              <span class="hero-install-label">Easy Install</span>
              <div class="hero-install-cmd">
                <code id="install-cmd">npm install @asgcard/sdk</code>
                <button class="hero-copy-btn" id="copy-install-btn" aria-label="Copy install command" type="button">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                </button>
              </div>
            </div>
          </div>

          <!-- Right: Card Visual -->
          <div class="flex justify-center lg:justify-end animate-slide-up" style="animation-delay: 0.1s">
            <div class="card-3d-wrapper w-full max-w-md">
              <div class="card-3d rounded-2xl overflow-hidden">
                <div class="relative w-full aspect-[1.586/1] bg-gradient-to-br from-[#111113] via-[#0e0e10] to-[#09090b] border border-white/[0.08] rounded-2xl p-7 sm:p-8 flex flex-col justify-between shadow-2xl">
                  <!-- Top row -->
                  <div class="flex items-start justify-between">
                    <div>
                      <div class="text-[10px] font-medium text-white/20 uppercase tracking-widest mb-1">Virtual Card</div>
                      <div class="text-sm font-semibold text-white/70 tracking-tight">ASG Card</div>
                    </div>
                    <div class="flex items-center gap-2">
                      <img src="/stellar-logo-lockup.svg" alt="Stellar logo" class="h-3.5 w-auto max-w-[78px] opacity-90" />
                    </div>
                  </div>
                  <!-- Chip -->
                  <div class="my-auto">
                    <div class="w-11 h-8 rounded-md bg-gradient-to-br from-yellow-600/20 to-yellow-500/5 border border-yellow-500/15"></div>
                  </div>
                  <!-- Bottom row -->
                  <div class="space-y-3">
                    <div class="font-mono text-lg sm:text-xl text-white/60 tracking-[0.15em]">4111 \u2022\u2022\u2022\u2022 \u2022\u2022\u2022\u2022 4444</div>
                    <div class="flex items-center justify-between">
                      <div>
                        <div class="text-[10px] text-white/15 uppercase tracking-wider">Expires</div>
                        <div class="font-mono text-xs text-white/40">12/28</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-white/15 uppercase tracking-wider">CVV</div>
                        <div class="font-mono text-xs text-white/40">\u2022\u2022\u2022</div>
                      </div>
                      <div>
                        <div class="text-[10px] text-white/15 uppercase tracking-wider">Balance</div>
                        <div class="font-mono text-xs text-asg-green/70 font-semibold">$50.00</div>
                      </div>
                      <div class="text-right">
                        <span class="text-white/15 font-bold text-base italic tracking-tight">VISA</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══════════════ TRUST BAR ═══════════════ -->
      <section class="border-y border-white/[0.04]">
        <div class="max-w-6xl mx-auto px-6 py-12">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div class="text-center">
              <div class="text-2xl font-bold text-white/80">x402</div>
              <div class="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Protocol</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-white/80">Stellar</div>
              <div class="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Mainnet</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-white/80">USDC</div>
              <div class="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Payments</div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-bold text-white/80">&lt;1s</div>
              <div class="text-[11px] text-white/30 mt-1 uppercase tracking-wider">Issuance</div>
            </div>
          </div>
        </div>
      </section>

      <!-- ═══════════════ FEATURES ═══════════════ -->
      <section id="features" class="py-24 md:py-32">
        <div class="max-w-6xl mx-auto px-6">
          <div class="text-center max-w-xl mx-auto mb-16">
            <span class="section-label">Features</span>
            <h2 class="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">Built for autonomous agents</h2>
            <p class="text-white/40 text-base mt-4">Streamlined card infrastructure. Get started in minutes.</p>
          </div>

          <div class="grid md:grid-cols-3 gap-5">
            ${FEATURES.map(renderFeatureCard).join('')}
          </div>
        </div>
      </section>

      <!-- ═══════════════ HOW IT WORKS ═══════════════ -->
      <section id="how-it-works" class="hiw-section">
        <div class="hiw-container">
          <div class="hiw-header">
            <span class="hiw-label">How it works</span>
            <h2 class="hiw-heading">Get a card in seconds, <span class="hiw-heading-muted">not days.</span></h2>
            <p class="hiw-subheading">From first request to first purchase — we've reduced the entire flow to four deterministic steps.</p>
          </div>
          <div class="hiw-grid">
            ${STEPS.map((s, i) => renderStep(s, i)).join('')}
          </div>
        </div>
      </section>

      <!-- ═══════════════ PRICING ═══════════════ -->
      <section id="pricing" class="py-24 md:py-32 border-t border-white/[0.04]">
        <div class="max-w-6xl mx-auto px-6">
          <div class="text-center max-w-xl mx-auto mb-16">
            <span class="section-label">Pricing</span>
            <h2 class="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">Transparent, tier-based</h2>
            <p class="text-white/40 text-base mt-4">No subscriptions. Pay only for what you use.</p>
          </div>

          <div class="grid lg:grid-cols-2 gap-6 max-w-5xl mx-auto">

            <!-- Create Card -->
            <div class="surface p-6 sm:p-8 overflow-x-auto">
              <div class="flex items-center gap-3 mb-1">
                <h3 class="text-lg font-semibold tracking-tight">Create Card</h3>
                <span class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-asg-purple/10 text-asg-purple border border-asg-purple/20">One-time</span>
              </div>
              <p class="text-white/30 text-sm mb-6">via <code class="text-asg-purple/60 font-mono text-xs">POST /cards/create/tier/:amount</code></p>
              <table class="w-full text-left" id="creation-table">
                <thead>
                  <tr class="border-b border-white/[0.08] text-[11px] text-white/30 uppercase tracking-wider">
                    <th class="pb-3 pl-4 pr-3 font-medium">Load</th>
                    <th class="pb-3 px-3 font-medium">Issuance</th>
                    <th class="pb-3 px-3 font-medium">Top-up</th>
                    <th class="pb-3 px-3 font-medium">Service</th>
                    <th class="pb-3 pl-3 pr-4 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody id="creation-tbody">
                  ${renderCreationRows()}
                </tbody>
              </table>
            </div>

            <!-- Fund Card -->
            <div class="surface p-6 sm:p-8 overflow-x-auto">
              <div class="flex items-center gap-3 mb-1">
                <h3 class="text-lg font-semibold tracking-tight">Fund Card</h3>
                <span class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-asg-green/10 text-asg-green border border-asg-green/20">Reload</span>
              </div>
              <p class="text-white/30 text-sm mb-6">via <code class="text-asg-green/60 font-mono text-xs">POST /cards/fund/tier/:amount</code></p>
              <table class="w-full text-left" id="funding-table">
                <thead>
                  <tr class="border-b border-white/[0.08] text-[11px] text-white/30 uppercase tracking-wider">
                    <th class="pb-3 pl-4 pr-3 font-medium">Amount</th>
                    <th class="pb-3 px-3 font-medium">Top-up</th>
                    <th class="pb-3 px-3 font-medium">Service</th>
                    <th class="pb-3 pl-3 pr-4 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody id="funding-tbody">
                  ${renderFundingRows()}
                </tbody>
              </table>
            </div>

          </div>
        </div>
      </section>

      <!-- ═══════════════ CTA ═══════════════ -->
      <section class="py-24 md:py-32 border-t border-white/[0.04]">
        <div class="max-w-2xl mx-auto px-6 text-center">
          <h2 class="text-3xl sm:text-4xl font-bold tracking-tight leading-tight mb-5">Ready to give your<br>agent a card?</h2>
          <p class="text-white/40 text-base mb-10 max-w-lg mx-auto">Join developers using ASG Card to pay for SaaS, infrastructure, and services autonomously on-chain.</p>
          <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a href="/docs#sdk-quick-start" class="btn-primary text-base px-8 py-3.5 w-full sm:w-auto">Get Started</a>
            <a href="/docs" class="btn-secondary text-base px-8 py-3.5 w-full sm:w-auto">Read the Docs</a>
          </div>
        </div>
      </section>

    </main>

    <!-- ─── Footer ─── -->
    <footer class="border-t border-white/[0.04] py-8">
      <div class="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <img src="/logo-mark.svg" alt="" class="w-5 h-5" aria-hidden="true" />
          <span class="text-sm text-white/30">ASG Card</span>
        </div>
        <div class="flex items-center gap-6 text-xs text-white/25">
          <a href="/docs" class="hover:text-white/50 transition-colors">Docs</a>
          <a href="https://x.com/asgcards" target="_blank" rel="noopener noreferrer" class="hover:text-white/50 transition-colors">X</a>
          <a href="https://opencard.dev" target="_blank" rel="noopener noreferrer" class="hover:text-white/50 transition-colors">OpenCard.dev</a>
          <span>&copy; 2026 Autonomous Service Group</span>
        </div>
      </div>
    </footer>
  </div>
`

// ============================================================
// Interactivity
// ============================================================

// Header: subtle bg on scroll
const header = document.getElementById('header')
window.addEventListener('scroll', () => {
  if (window.scrollY > 20) {
    header?.classList.add('bg-asg-black/80', 'backdrop-blur-lg', 'border-white/[0.04]')
    header?.classList.remove('border-transparent')
  } else {
    header?.classList.remove('bg-asg-black/80', 'backdrop-blur-lg', 'border-white/[0.04]')
    header?.classList.add('border-transparent')
  }
}, { passive: true })

// ── Mobile menu ──
const menuBtn = document.getElementById('mobile-menu-btn')
const mobileNav = document.getElementById('mobile-nav')
const burgerTop = document.getElementById('burger-top')
const burgerMid = document.getElementById('burger-mid')
const burgerBot = document.getElementById('burger-bot')
let menuOpen = false

function setMobileMenu(open: boolean) {
  menuOpen = open
  menuBtn?.setAttribute('aria-expanded', String(open))
  if (open) {
    mobileNav?.classList.remove('max-h-0', 'opacity-0')
    mobileNav?.classList.add('max-h-96', 'opacity-100')
    burgerTop?.style.setProperty('transform', 'translateY(3.25px) rotate(45deg)')
    burgerMid?.style.setProperty('opacity', '0')
    burgerBot?.style.setProperty('transform', 'translateY(-3.25px) rotate(-45deg)')
  } else {
    mobileNav?.classList.remove('max-h-96', 'opacity-100')
    mobileNav?.classList.add('max-h-0', 'opacity-0')
    burgerTop?.style.setProperty('transform', 'none')
    burgerMid?.style.setProperty('opacity', '1')
    burgerBot?.style.setProperty('transform', 'none')
  }
}

menuBtn?.addEventListener('click', () => setMobileMenu(!menuOpen))

mobileNav?.querySelectorAll('.mobile-nav-link').forEach((link) => {
  link.addEventListener('click', () => setMobileMenu(false))
})

// ── Copy install command ──
const copyBtn = document.getElementById('copy-install-btn') as HTMLButtonElement | null
const installCmd = document.getElementById('install-cmd') as HTMLElement | null

copyBtn?.addEventListener('click', () => {
  const text = installCmd?.textContent ?? ''
  navigator.clipboard.writeText(text).then(() => {
    const original = copyBtn.innerHTML
    copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#14F195" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 6L9 17l-5-5"/></svg>'
    setTimeout(() => { copyBtn.innerHTML = original }, 1500)
  })
})

// ── Card hover tilt ──
const card3d = document.querySelector('.card-3d') as HTMLElement | null
const cardWrapper = document.querySelector('.card-3d-wrapper') as HTMLElement | null

cardWrapper?.addEventListener('mousemove', (e: MouseEvent) => {
  if (!card3d) return
  const rect = cardWrapper.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  const rotateX = (0.5 - y) * 16
  const rotateY = (x - 0.5) * 16
  card3d.style.transform = `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`
})

cardWrapper?.addEventListener('mouseleave', () => {
  if (!card3d) return
  card3d.style.transform = 'rotateX(6deg) rotateY(-4deg)'
})

// ── Fetch live pricing and update tables ──
fetchLivePricing().then(() => {
  const creationTbody = document.getElementById('creation-tbody')
  const fundingTbody = document.getElementById('funding-tbody')

  if (!pricingLoaded) {
    if (creationTbody) creationTbody.innerHTML = unavailableRow(5)
    if (fundingTbody) fundingTbody.innerHTML = unavailableRow(4)
    return
  }

  if (creationTbody) creationTbody.innerHTML = renderCreationRows()
  if (fundingTbody) fundingTbody.innerHTML = renderFundingRows()
})
