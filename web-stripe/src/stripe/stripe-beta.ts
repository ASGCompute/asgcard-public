/**
 * ASG Card × Stripe Machine Payments — Managed Identity Edition
 *
 * Entrypoint for stripe.asgcard.dev
 * 3-step flow (wallet-less):
 *   1. Enter email + card details → create managed session
 *   2. Submit card request → receive 402 (WWW-Authenticate: Payment) →
 *      Stripe.js payment → create SPT → build credential → retry with Authorization: Payment
 *   3. View card result + session key (for future API access)
 *
 * No Freighter. No Stellar wallet. No external wallet connection.
 * Card ownership is via ASG-managed identity (session key).
 */

import './stripe-beta.css';

// ── Config ──────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'https://api.asgcard.dev';

// ── Types ───────────────────────────────────────────────────────
interface MppChallengeWire {
  id: string;
  realm: string;
  method: string;
  intent: string;
  request: string;
  description?: string;
  expires?: string;
}

interface CardResult {
  cardId: string;
  status: string;
  balance: number;
}

// ── State ───────────────────────────────────────────────────────
let sessionKey: string | null = null;
let currentChallenge: MppChallengeWire | null = null;
let currentChallengeAmountCents: number = 0;
let stripeInstance: unknown = null;
let stripeElements: unknown = null;
let stripePublishableKey: string | null = null;

// ── Stripe.js Types (loaded via CDN) ────────────────────────────
declare const Stripe: (key: string) => {
  elements: (opts?: Record<string, unknown>) => {
    create: (type: string, opts?: Record<string, unknown>) => {
      mount: (selector: string) => void;
      unmount: () => void;
    };
    submit: () => Promise<{ error?: { message: string } }>;
  };
  createPaymentMethod: (opts: Record<string, unknown>) => Promise<{
    paymentMethod?: { id: string };
    error?: { message: string };
  }>;
};

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

// ── Session Auth Headers ────────────────────────────────────────
function buildSessionHeaders(): Record<string, string> {
  if (!sessionKey) throw new Error('No active session');
  return { 'X-STRIPE-SESSION': sessionKey };
}

// ── MPP Credential Helpers (inline — browser can't import npm) ──

function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(encoded: string): string {
  let padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) padded += '=';
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function parseMppChallenge(wwwAuth: string): MppChallengeWire | null {
  const match = wwwAuth.match(/^Payment\s+(.+)$/i);
  if (!match?.[1]) return null;
  try {
    const json = base64urlDecode(match[1]);
    return JSON.parse(json) as MppChallengeWire;
  } catch {
    return null;
  }
}

function buildMppCredential(challenge: MppChallengeWire, sptId: string): string {
  const wire = {
    challenge,
    payload: { spt: sptId },
  };
  const json = JSON.stringify(wire);
  return `Payment ${base64urlEncode(json)}`;
}

// ── UI Helpers ──────────────────────────────────────────────────
function $(id: string): HTMLElement | null { return document.getElementById(id); }

function setStep(step: number) {
  for (let i = 1; i <= 3; i++) {
    const el = $(`step-${i}`);
    if (el) {
      el.classList.toggle('active', i === step);
      el.classList.toggle('completed', i < step);
    }
  }
  document.querySelectorAll('.sb-step-indicator').forEach((el, idx) => {
    el.classList.toggle('active', idx + 1 === step);
    el.classList.toggle('completed', idx + 1 < step);
  });
}

function showError(containerId: string, message: string) {
  const el = $(containerId);
  if (el) { el.innerHTML = `<div class="sb-error">${message}</div>`; el.style.display = 'block'; }
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

      <header class="sb-header sb-animate">
        <a href="/" class="sb-logo">
          <div class="sb-logo-icon">A</div>
          <span class="sb-logo-text">ASG Card</span>
        </a>
        <span class="sb-badge">Stripe Beta</span>
      </header>

      <section class="sb-hero sb-animate sb-animate-delay-1">
        <div class="sb-hero-eyebrow">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          Stripe Machine Payments Protocol
        </div>
        <h1>ASG Card × Stripe<br/>Machine Payments</h1>
        <p>Virtual MasterCard for AI agents. Pay with Stripe. No wallet required.</p>
      </section>

      <div class="sb-progress sb-animate sb-animate-delay-2">
        <div class="sb-step-indicator"><span>1</span> Your Details</div>
        <div class="sb-step-divider"></div>
        <div class="sb-step-indicator"><span>2</span> Pay via Stripe</div>
        <div class="sb-step-divider"></div>
        <div class="sb-step-indicator"><span>3</span> Receive Card</div>
      </div>

      <!-- Step 1: Identity + Card Details -->
      <section class="sb-step-panel sb-animate sb-animate-delay-2" id="step-1">
        <h2>Create Your Card</h2>
        <p>Enter your details to create a virtual MasterCard.</p>
        <form id="card-form" class="sb-form">
          <div class="sb-field">
            <label for="f-email">Email</label>
            <input type="email" id="f-email" placeholder="you@example.com" required />
          </div>
          <div class="sb-field">
            <label for="f-name">Name on Card</label>
            <input type="text" id="f-name" placeholder="Your Name" required />
          </div>
          <div class="sb-field">
            <label for="f-phone">Phone</label>
            <input type="tel" id="f-phone" placeholder="+1234567890" required />
          </div>
          <div class="sb-field">
            <label for="f-amount">Amount ($)</label>
            <input type="number" id="f-amount" min="5" max="5000" value="25" required />
          </div>
          <div id="error-1" style="display:none"></div>
          <button type="submit" class="sb-cta-btn" id="btn-submit">
            Continue to Payment
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>
      </section>

      <!-- Step 2: Stripe Payment -->
      <section class="sb-step-panel" id="step-2">
        <h2>Complete Payment</h2>
        <p id="payment-info"></p>
        <div id="stripe-element-container" class="sb-stripe-element"></div>
        <div id="error-2" style="display:none"></div>
        <button class="sb-cta-btn" id="btn-pay">
          Pay &amp; Create Card
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </button>
      </section>

      <!-- Step 3: Result -->
      <section class="sb-step-panel" id="step-3">
        <h2>Card Created!</h2>
        <div id="card-result" class="sb-card-result"></div>
      </section>

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

      <footer class="sb-disclaimer sb-animate sb-animate-delay-5">
        <strong>Beta Disclaimer</strong> — This is a beta surface for testing
        Stripe Machine Payments Protocol integration with ASG Card.
        <br/>
        <span style="margin-top: 8px; display: inline-block;">
          No external wallet required. Card ownership via ASG-managed identity.
        </span>
      </footer>

    </div>
  `;

  $('card-form')?.addEventListener('submit', handleFormSubmit);
  $('btn-pay')?.addEventListener('click', handleStripePayment);
  setStep(1);
}

// ── Step 1: Form Submit → Create Session → 402 MPP Challenge ─────
let savedFormData: { amount: number; nameOnCard: string; email: string; phone: string } | null = null;

async function handleFormSubmit(e: Event) {
  e.preventDefault();
  hideError('error-1');

  const email = ($('f-email') as HTMLInputElement)?.value?.trim();
  const nameOnCard = ($('f-name') as HTMLInputElement)?.value?.trim();
  const phone = ($('f-phone') as HTMLInputElement)?.value?.trim() || '';
  const amount = Number(($('f-amount') as HTMLInputElement)?.value);

  if (!email || !nameOnCard || amount < 5 || amount > 5000) {
    showError('error-1', 'Please fill in all required fields with valid values.');
    return;
  }

  savedFormData = { amount, nameOnCard, email, phone };

  const btn = $('btn-submit') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Creating session...'; }

  try {
    // Step 1a: Create managed session
    const sessionRes = await fetch(`${API_BASE}/stripe-beta/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!sessionRes.ok) {
      const err = await sessionRes.json().catch(() => ({ error: `HTTP ${sessionRes.status}` }));
      showError('error-1', err.error || `Session creation failed: ${sessionRes.status}`);
      return;
    }

    const sessionData = await sessionRes.json();
    sessionKey = sessionData.sessionKey;

    if (!sessionKey) {
      showError('error-1', 'Server did not return a session key.');
      return;
    }

    trackEvent('session_created');

    // Step 1b: Request card creation → expect 402 with MPP challenge
    if (btn) btn.textContent = 'Requesting payment...';

    const res = await fetch(`${API_BASE}/stripe-beta/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildSessionHeaders(),
      },
      body: JSON.stringify({ nameOnCard, email, phone: phone || undefined, amount }),
    });

    if (res.status === 402) {
      const wwwAuth = res.headers.get('WWW-Authenticate');
      if (!wwwAuth) {
        showError('error-1', 'Server returned 402 but no WWW-Authenticate header. Contact support.');
        return;
      }

      const challenge = parseMppChallenge(wwwAuth);
      if (!challenge) {
        showError('error-1', 'Could not parse payment challenge. Contact support.');
        return;
      }

      const body = await res.json().catch(() => ({}));

      // challenge.request is { amount: "2500", currency: "usd" } (object, not URL string)
      let amountCents = 0;
      if (challenge.request && typeof challenge.request === 'object') {
        amountCents = parseInt(String((challenge.request as Record<string, string>).amount || '0'), 10);
      } else if (typeof challenge.request === 'string') {
        // Fallback for URL-encoded format: amount=2500&currency=usd
        const raw = new URLSearchParams(challenge.request).get('amount') || '0';
        amountCents = parseInt(raw.replace(/"/g, ''), 10);
      }
      if (!amountCents && (body as Record<string, unknown>).amount) {
        amountCents = Number((body as Record<string, unknown>).amount) || 0;
      }

      currentChallenge = challenge;
      currentChallengeAmountCents = amountCents;

      await fetchPublishableKeyAndInitElements(challenge);
      trackEvent('402_challenge_received');
    } else if (res.status === 201) {
      const data = await res.json();
      showCardResult(data);
    } else {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError('error-1', err.error || `Request failed: ${res.status}`);
    }
  } catch (err) {
    showError('error-1', `Request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continue to Payment'; }
  }
}

// ── Fetch Stripe publishable key and init Elements ──────────────
async function fetchPublishableKeyAndInitElements(challenge: MppChallengeWire) {
  try {
    const configRes = await fetch(`${API_BASE}/stripe-beta/config`);
    if (configRes.ok) {
      const config = await configRes.json();
      stripePublishableKey = config.stripePublishableKey || null;
    }

    if (!stripePublishableKey) {
      showError('error-1', 'Could not obtain Stripe configuration. Contact support.');
      return;
    }

    initStripeElements(challenge);
  } catch (err) {
    showError('error-1', `Failed to initialize payment: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Initialize Stripe.js Elements ──────────────────────────────
function initStripeElements(challenge: MppChallengeWire) {
  if (typeof Stripe === 'undefined') {
    showError('error-1', 'Stripe.js not loaded. Please refresh the page.');
    return;
  }

  if (!stripePublishableKey) {
    showError('error-1', 'Stripe publishable key not available.');
    return;
  }

  stripeInstance = Stripe(stripePublishableKey);
  const stripe = stripeInstance as ReturnType<typeof Stripe>;
  stripeElements = stripe.elements({
    mode: 'payment',
    amount: currentChallengeAmountCents,
    currency: 'usd',
  });

  const elements = stripeElements as ReturnType<ReturnType<typeof Stripe>['elements']>;
  const paymentElement = elements.create('payment');
  paymentElement.mount('#stripe-element-container');

  // Transition to step 2
  setStep(2);

  const info = $('payment-info');
  if (info) {
    const amountUsd = (currentChallengeAmountCents / 100).toFixed(2);
    const desc = challenge.description || 'ASG Card creation';
    info.textContent = `Payment of $${amountUsd} USD required for: ${desc}`;
  }
}

// ── Step 2: Complete Payment → Create SPT → Build Credential → Retry ──
async function handleStripePayment() {
  if (!sessionKey || !savedFormData || !stripeInstance || !stripeElements || !currentChallenge) return;
  hideError('error-2');

  const btn = $('btn-pay') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  try {
    const stripe = stripeInstance as ReturnType<typeof Stripe>;
    const elements = stripeElements as ReturnType<ReturnType<typeof Stripe>['elements']>;

    // 1. Submit the Stripe Elements form to validate
    const { error: submitError } = await elements.submit();
    if (submitError) {
      showError('error-2', submitError.message);
      return;
    }

    // 2. Create PaymentMethod from the Element
    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
      elements,
    });

    if (pmError || !paymentMethod) {
      showError('error-2', pmError?.message || 'Failed to create payment method');
      return;
    }

    // 3. Create SPT via backend endpoint (uses session auth)
    const sptRes = await fetch(`${API_BASE}/stripe-beta/create-spt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...buildSessionHeaders(),
      },
      body: JSON.stringify({
        paymentMethod: paymentMethod.id,
        amount: currentChallengeAmountCents,
        currency: 'usd',
      }),
    });

    if (!sptRes.ok) {
      const err = await sptRes.json().catch(() => ({ error: 'SPT creation failed' }));
      showError('error-2', err.error || 'Failed to create payment token');
      return;
    }

    const { spt } = await sptRes.json();
    if (!spt) {
      showError('error-2', 'Server did not return SPT');
      return;
    }

    // 4. Build MPP credential
    const credential = buildMppCredential(currentChallenge, spt);

    // 5. Retry the card creation request with the credential + session auth
    const { amount, nameOnCard, email, phone } = savedFormData;

    const res = await fetch(`${API_BASE}/stripe-beta/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': credential,
        ...buildSessionHeaders(),
      },
      body: JSON.stringify({ nameOnCard, email, phone: phone || undefined, amount }),
    });

    if (res.status === 201) {
      const data = await res.json();
      showCardResult(data);
      trackEvent('card_created');
    } else {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError('error-2', err.error || err.detail || `Payment failed: ${res.status}`);
    }
  } catch (err) {
    showError('error-2', `Payment failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Pay & Create Card'; }
  }
}

// ── Step 3: Show Card Result + Session Key ──────────────────────
function showCardResult(data: Record<string, unknown>) {
  setStep(3);

  const card = data.card as CardResult | undefined;
  const details = data.detailsEnvelope as Record<string, unknown> | undefined;

  const resultEl = $('card-result');
  if (!resultEl) return;

  const maskPAN = (pan: string) => `•••• •••• •••• ${pan.slice(-4)}`;

  // Build session key download blob
  const sessionBlob = sessionKey ? JSON.stringify({
    apiBase: API_BASE,
    sessionKey,
    cardId: card?.cardId,
    note: "Use X-STRIPE-SESSION header for API calls"
  }, null, 2) : '';

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

      ${sessionKey ? `
        <div class="sb-session-key-section">
          <h3>🔑 Your Session Key</h3>
          <p class="sb-session-warning">
            Save this key securely. It will <strong>not</strong> be shown again.
            Use it with <code>X-STRIPE-SESSION</code> header for API access.
          </p>
          <div class="sb-session-key-box">
            <code id="session-key-display">${sessionKey}</code>
            <button class="sb-copy-btn" id="btn-copy-key" title="Copy to clipboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
              </svg>
            </button>
          </div>
          <button class="sb-download-btn" id="btn-download-key">
            Download as JSON
          </button>
        </div>
      ` : ''}

      <div class="sb-card-warning">
        ⚠️ Save the card details and session key immediately. They are shown once for security.
      </div>
    </div>
  `;

  // Bind copy + download buttons
  $('btn-copy-key')?.addEventListener('click', () => {
    if (sessionKey) {
      navigator.clipboard.writeText(sessionKey).then(() => {
        const btn = $('btn-copy-key');
        if (btn) btn.innerHTML = '✓ Copied';
      });
    }
  });

  $('btn-download-key')?.addEventListener('click', () => {
    if (sessionBlob) {
      const blob = new Blob([sessionBlob], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asg-card-session-${card?.cardId || 'key'}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });
}

// ── Init ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  render();
  trackEvent('page_view');
});
