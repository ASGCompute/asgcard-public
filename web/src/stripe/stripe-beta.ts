/**
 * ASG Card × Stripe Machine Payments — Beta Landing Surface
 *
 * This is the entrypoint for stripe.asgcard.dev.
 * It renders the beta landing page with:
 * - Hero section explaining the Stripe edition
 * - 3-step flow overview
 * - Comparison of what's same vs different
 * - Link to Stellar edition
 * - Beta disclaimer
 * - Analytics events for beta funnel tracking
 */

import './stripe-beta.css';

// ── Analytics helper ────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'https://api.asgcard.dev';

async function trackBetaEvent(event: string, meta?: Record<string, unknown>) {
  try {
    await fetch(`${API_BASE}/telemetry/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: `stripe_beta:${event}`,
        referrer: document.referrer,
        ...meta
      })
    });
  } catch {
    // Non-blocking
  }
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('stripe-beta-app');
  if (!app) return;

  app.innerHTML = `
    <div class="sb-glow"></div>
    <div class="sb-container">

      <!-- Header -->
      <header class="sb-header sb-animate">
        <a href="/" class="sb-logo">
          <div class="sb-logo-icon">A</div>
          <span class="sb-logo-text">ASG Card</span>
        </a>
        <span class="sb-badge">Stripe Beta</span>
      </header>

      <!-- Hero -->
      <section class="sb-hero sb-animate sb-animate-delay-1">
        <div class="sb-hero-eyebrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          Stripe Machine Payments Protocol
        </div>
        <h1>ASG Card × Stripe<br/>Machine Payments</h1>
        <p>
          Same virtual card product. Same wallet ownership. Same lifecycle.
          Different payment rail — powered by Stripe MPP.
        </p>
        <button class="sb-cta-btn" id="sb-cta-start">
          Start Beta
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </section>

      <!-- 3-Step Flow -->
      <section class="sb-steps sb-animate sb-animate-delay-2">
        <div class="sb-step">
          <div class="sb-step-number">1</div>
          <h3>Identify Owner</h3>
          <p>Connect your Stellar wallet to establish card ownership identity</p>
        </div>
        <div class="sb-step">
          <div class="sb-step-number">2</div>
          <h3>Pay via Stripe</h3>
          <p>Complete payment through Stripe Machine Payments Protocol</p>
        </div>
        <div class="sb-step">
          <div class="sb-step-number">3</div>
          <h3>Receive Card</h3>
          <p>Get your virtual MasterCard — same issuer, same lifecycle</p>
        </div>
      </section>

      <!-- What's Same / What's Different -->
      <section class="sb-diff sb-animate sb-animate-delay-3">
        <h2>Stripe edition changes the payment rail, not the card product</h2>
        <div class="sb-diff-grid">
          <div class="sb-diff-item">
            <div class="sb-diff-icon same">✓</div>
            <div>
              <div class="sb-diff-label">Card Issuer</div>
              <div class="sb-diff-value">4payments (same)</div>
            </div>
          </div>
          <div class="sb-diff-item">
            <div class="sb-diff-icon diff">→</div>
            <div>
              <div class="sb-diff-label">Payment Rail</div>
              <div class="sb-diff-value">Stripe MPP (new)</div>
            </div>
          </div>
          <div class="sb-diff-item">
            <div class="sb-diff-icon same">✓</div>
            <div>
              <div class="sb-diff-label">Card Ownership</div>
              <div class="sb-diff-value">Wallet-based (same)</div>
            </div>
          </div>
          <div class="sb-diff-item">
            <div class="sb-diff-icon same">✓</div>
            <div>
              <div class="sb-diff-label">Card Management</div>
              <div class="sb-diff-value">Existing walletflow (same)</div>
            </div>
          </div>
          <div class="sb-diff-item">
            <div class="sb-diff-icon same">✓</div>
            <div>
              <div class="sb-diff-label">Card Network</div>
              <div class="sb-diff-value">MasterCard (same)</div>
            </div>
          </div>
          <div class="sb-diff-item">
            <div class="sb-diff-icon diff">→</div>
            <div>
              <div class="sb-diff-label">Payment Currency</div>
              <div class="sb-diff-value">USD via Stripe (new)</div>
            </div>
          </div>
        </div>
      </section>

      <!-- Stellar Edition Link -->
      <section class="sb-stellar-link sb-animate sb-animate-delay-4">
        <h3>Looking for the Stellar edition?</h3>
        <p>The original ASG Card flow with x402 payments on Stellar is still fully available.</p>
        <a href="https://asgcard.dev">
          Visit asgcard.dev
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M7 17L17 7M7 7h10v10"/>
          </svg>
        </a>
      </section>

      <!-- Disclaimer -->
      <footer class="sb-disclaimer sb-animate sb-animate-delay-5">
        <strong>Beta Disclaimer</strong> — This is a beta surface for testing
        Stripe Machine Payments Protocol integration with ASG Card.
        Card creation, funding, and management are subject to the same terms as the
        <a href="https://asgcard.dev">main ASG Card platform</a>.
        This beta may be limited or discontinued at any time.
        <br/>
        <span style="margin-top: 8px; display: inline-block;">
          Principle: <strong>Stripe pays, wallet owns.</strong>
        </span>
      </footer>

    </div>
  `;

  // ── CTA handler ─────────────────────────────────────────────
  const ctaBtn = document.getElementById('sb-cta-start');
  ctaBtn?.addEventListener('click', () => {
    trackBetaEvent('stripe_beta_start');
    // For now, scroll or show a message — full flow TBD
    alert(
      'Stripe MPP Beta — Coming Soon\\n\\n' +
      'This beta creates ASG Cards using Stripe Machine Payments Protocol.\\n' +
      'Full onboarding flow is being connected.\\n\\n' +
      'In the meantime, you can create cards via the Stellar edition at asgcard.dev'
    );
  });
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  render();
  trackBetaEvent('stripe_beta_page_view');
});
