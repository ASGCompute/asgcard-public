/**
 * ASG Card × Stripe Machine Payments — Beta Surface
 *
 * Entrypoint for stripe.asgcard.dev
 * 3-step onboarding flow:
 *   1. Connect Stellar wallet (Freighter)
 *   2. Submit card details → receive 402 challenge → input SPT → retry
 *   3. View card result
 */

import './stripe-beta.css';

// ── Config ──────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'https://api.asgcard.dev';

// ── Types ───────────────────────────────────────────────────────
interface WalletState {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

interface CardResult {
  cardId: string;
  status: string;
  balance: number;
  cardNumber?: string;
  cvv?: string;
  expiryMonth?: string;
  expiryYear?: string;
}

// ── State ───────────────────────────────────────────────────────
let wallet: WalletState | null = null;
let currentStep = 0;

// ── Analytics ───────────────────────────────────────────────────
async function trackEvent(event: string) {
  try {
    await fetch(`${API_BASE}/telemetry/visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: `stripe_beta:${event}`, referrer: document.referrer })
    });
  } catch { /* non-blocking */ }
}

// ── Freighter Detection ─────────────────────────────────────────
function getFreighter(): { requestAccess: () => Promise<string>; getPublicKey: () => Promise<string>; signMessage: (msg: string, opts: { networkPassphrase: string }) => Promise<string> } | null {
  const w = window as unknown as Record<string, unknown>;
  if (w.freighterApi) return w.freighterApi as ReturnType<typeof getFreighter>;
  if (w.freighter) return w.freighter as ReturnType<typeof getFreighter>;
  return null;
}

// ── Wallet Auth Headers ─────────────────────────────────────────
async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (!wallet) throw new Error('Wallet not connected');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `asgcard-auth:${timestamp}`;
  const signature = await wallet.signMessage(message);
  return {
    'X-WALLET-ADDRESS': wallet.address,
    'X-WALLET-SIGNATURE': signature,
    'X-WALLET-TIMESTAMP': timestamp,
    'X-WALLET-AUTH-MODE': 'message',
  };
}

// ── UI Helpers ──────────────────────────────────────────────────
function $(id: string): HTMLElement | null { return document.getElementById(id); }

function setStep(step: number) {
  currentStep = step;
  for (let i = 1; i <= 3; i++) {
    const el = $(`step-${i}`);
    if (el) {
      el.classList.toggle('active', i === step);
      el.classList.toggle('completed', i < step);
    }
  }
  const indicators = document.querySelectorAll('.sb-step-indicator');
  indicators.forEach((el, idx) => {
    el.classList.toggle('active', idx + 1 === step);
    el.classList.toggle('completed', idx + 1 < step);
  });
}

function showError(containerId: string, message: string) {
  const el = $(containerId);
  if (el) {
    el.innerHTML = `<div class="sb-error">${message}</div>`;
    el.style.display = 'block';
  }
}

function hideError(containerId: string) {
  const el = $(containerId);
  if (el) el.style.display = 'none';
}

// ── Render ──────────────────────────────────────────────────────
function render() {
  const app = $('stripe-beta-app');
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
        <p>Same card product. Same wallet ownership. Different payment rail.</p>
      </section>

      <!-- Step Indicators -->
      <div class="sb-progress sb-animate sb-animate-delay-2">
        <div class="sb-step-indicator" id="ind-1"><span>1</span> Connect Wallet</div>
        <div class="sb-step-divider"></div>
        <div class="sb-step-indicator" id="ind-2"><span>2</span> Pay via Stripe</div>
        <div class="sb-step-divider"></div>
        <div class="sb-step-indicator" id="ind-3"><span>3</span> Receive Card</div>
      </div>

      <!-- Step 1: Wallet Connect -->
      <section class="sb-step-panel sb-animate sb-animate-delay-2" id="step-1">
        <h2>Connect Your Wallet</h2>
        <p>Connect your Stellar wallet to establish card ownership.</p>
        <div id="wallet-status"></div>
        <div id="error-1" style="display:none"></div>
        <button class="sb-cta-btn" id="btn-connect">
          Connect Freighter
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </section>

      <!-- Step 2: Card Details + Payment -->
      <section class="sb-step-panel" id="step-2">
        <h2>Create Your Card</h2>
        <p>Enter card details and complete payment via Stripe MPP.</p>
        <form id="card-form" class="sb-form">
          <div class="sb-field">
            <label for="f-amount">Amount ($)</label>
            <input type="number" id="f-amount" min="5" max="5000" value="25" required />
          </div>
          <div class="sb-field">
            <label for="f-name">Name on Card</label>
            <input type="text" id="f-name" placeholder="Your Name" required />
          </div>
          <div class="sb-field">
            <label for="f-email">Email</label>
            <input type="email" id="f-email" placeholder="you@example.com" required />
          </div>
          <div class="sb-field">
            <label for="f-phone">Phone (optional)</label>
            <input type="tel" id="f-phone" placeholder="+1234567890" />
          </div>
          <div id="error-2" style="display:none"></div>
          <button type="submit" class="sb-cta-btn" id="btn-submit">
            Create Card
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>

        <!-- SPT Input (shown after 402) -->
        <div id="spt-section" style="display:none" class="sb-spt-section">
          <h3>Payment Required</h3>
          <p id="spt-challenge-info"></p>
          <div class="sb-field">
            <label for="f-spt">Stripe Payment Token (SPT)</label>
            <input type="text" id="f-spt" placeholder="Paste your SPT token here" />
          </div>
          <div id="error-spt" style="display:none"></div>
          <button class="sb-cta-btn" id="btn-pay">
            Submit Payment
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </section>

      <!-- Step 3: Result -->
      <section class="sb-step-panel" id="step-3">
        <h2>Card Created!</h2>
        <div id="card-result" class="sb-card-result"></div>
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
        <br/>
        <span style="margin-top: 8px; display: inline-block;">
          Principle: <strong>Stripe pays, wallet owns.</strong>
        </span>
      </footer>

    </div>
  `;

  // ── Wire events ──
  $('btn-connect')?.addEventListener('click', handleConnect);
  $('card-form')?.addEventListener('submit', handleCardSubmit);
  $('btn-pay')?.addEventListener('click', handleSPTSubmit);

  setStep(1);
}

// ── Step 1: Wallet Connect ──────────────────────────────────────

// Saved form data for retry after SPT
let savedFormData: { amount: number; nameOnCard: string; email: string; phone: string } | null = null;

async function handleConnect() {
  const btn = $('btn-connect') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  hideError('error-1');

  const freighter = getFreighter();
  if (!freighter) {
    showError('error-1', 'Freighter wallet not detected. Please install <a href="https://freighter.app" target="_blank">Freighter</a>.');
    if (btn) btn.disabled = false;
    return;
  }

  try {
    await freighter.requestAccess();
    const pubKey = await freighter.getPublicKey();

    wallet = {
      address: pubKey,
      signMessage: async (msg: string) => {
        const signed = await freighter.signMessage(msg, {
          networkPassphrase: 'Public Global Stellar Network ; September 2015'
        });
        return signed;
      }
    };

    const statusEl = $('wallet-status');
    if (statusEl) {
      statusEl.innerHTML = `
        <div class="sb-wallet-connected">
          <span class="sb-wallet-dot"></span>
          Connected: <code>${pubKey.substring(0, 8)}...${pubKey.substring(pubKey.length - 4)}</code>
        </div>
      `;
    }

    trackEvent('wallet_connected');
    setStep(2);
  } catch (err) {
    showError('error-1', `Wallet connection failed: ${err instanceof Error ? err.message : String(err)}`);
    if (btn) btn.disabled = false;
  }
}

// ── Step 2: Card Form Submit ────────────────────────────────────
async function handleCardSubmit(e: Event) {
  e.preventDefault();
  if (!wallet) return;
  hideError('error-2');

  const amount = Number((($('f-amount') as HTMLInputElement)?.value));
  const nameOnCard = ($('f-name') as HTMLInputElement)?.value?.trim();
  const email = ($('f-email') as HTMLInputElement)?.value?.trim();
  const phone = ($('f-phone') as HTMLInputElement)?.value?.trim() || '';

  if (!nameOnCard || !email || amount < 5 || amount > 5000) {
    showError('error-2', 'Please fill in all required fields with valid values.');
    return;
  }

  savedFormData = { amount, nameOnCard, email, phone };

  const btn = $('btn-submit') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Requesting...'; }

  try {
    const authHeaders = await buildAuthHeaders();

    const res = await fetch(`${API_BASE}/stripe-beta/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ nameOnCard, email, phone: phone || undefined, amount }),
    });

    if (res.status === 402) {
      // Show SPT input
      const challenge = await res.json();
      const accepts = challenge.accepts?.[0];
      const info = $('spt-challenge-info');
      if (info && accepts) {
        const amountUsd = (Number(accepts.amount) / 100).toFixed(2);
        info.textContent = `Payment of $${amountUsd} USD required via Stripe MPP. Paste your SPT token below.`;
      }
      const sptSection = $('spt-section');
      if (sptSection) sptSection.style.display = 'block';
      const form = $('card-form') as HTMLFormElement | null;
      if (form) form.style.display = 'none';

      trackEvent('402_challenge_received');
    } else if (res.status === 201) {
      // Direct success (shouldn't happen without SPT, but handle gracefully)
      const data = await res.json();
      showCardResult(data);
    } else {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError('error-2', err.error || `Request failed: ${res.status}`);
    }
  } catch (err) {
    showError('error-2', `Request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Create Card'; }
  }
}

// ── Step 2b: SPT Submit ─────────────────────────────────────────
async function handleSPTSubmit() {
  if (!wallet || !savedFormData) return;
  hideError('error-spt');

  const sptToken = ($('f-spt') as HTMLInputElement)?.value?.trim();
  if (!sptToken) {
    showError('error-spt', 'Please enter your SPT token.');
    return;
  }

  const btn = $('btn-pay') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  try {
    const authHeaders = await buildAuthHeaders();
    const { amount, nameOnCard, email, phone } = savedFormData;

    // Encode SPT as base64 JSON credential
    const credential = btoa(JSON.stringify({ token: sptToken, amountCents: Math.round(amount * 100), currency: 'usd' }));

    const res = await fetch(`${API_BASE}/stripe-beta/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': credential,
        ...authHeaders,
      },
      body: JSON.stringify({ nameOnCard, email, phone: phone || undefined, amount }),
    });

    if (res.status === 201) {
      const data = await res.json();
      showCardResult(data);
      trackEvent('card_created');
    } else {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError('error-spt', err.error || `Payment failed: ${res.status}`);
    }
  } catch (err) {
    showError('error-spt', `Payment failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Submit Payment'; }
  }
}

// ── Step 3: Show Card Result ────────────────────────────────────
function showCardResult(data: Record<string, unknown>) {
  setStep(3);

  const card = data.card as CardResult | undefined;
  const details = data.detailsEnvelope as Record<string, unknown> | undefined;

  const resultEl = $('card-result');
  if (!resultEl) return;

  const maskPAN = (pan: string) => `•••• •••• •••• ${pan.slice(-4)}`;

  resultEl.innerHTML = `
    <div class="sb-card-display">
      <div class="sb-card-vis">
        <div class="sb-card-chip"></div>
        <div class="sb-card-pan">${details?.cardNumber ? maskPAN(String(details.cardNumber)) : '•••• •••• •••• ••••'}</div>
        <div class="sb-card-meta">
          <div>
            <span class="sb-card-label">Expiry</span>
            <span>${details?.expiryMonth ?? '••'}/${details?.expiryYear ?? '••'}</span>
          </div>
          <div>
            <span class="sb-card-label">CVV</span>
            <span>${details?.cvv ?? '•••'}</span>
          </div>
        </div>
        <div class="sb-card-badge">MasterCard</div>
      </div>
      <div class="sb-card-info">
        <div><strong>Card ID:</strong> <code>${card?.cardId ?? 'N/A'}</code></div>
        <div><strong>Status:</strong> ${card?.status ?? 'active'}</div>
        <div><strong>Balance:</strong> $${card?.balance ?? '0.00'}</div>
        <div><strong>Rail:</strong> Stripe MPP</div>
      </div>
      <div class="sb-card-warning">
        ⚠️ Save these details immediately. They are shown once for security.
      </div>
    </div>
  `;
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  render();
  trackEvent('page_view');
});
