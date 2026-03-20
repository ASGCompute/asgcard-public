/**
 * ASG Card × Stripe Machine Payments — Beta Surface
 *
 * Entrypoint for stripe.asgcard.dev
 * 3-step flow (Official MPP Protocol):
 *   1. Connect Stellar wallet (Freighter SEP-0043 signMessage)
 *   2. Submit card details → receive 402 (WWW-Authenticate: Payment) →
 *      Stripe.js payment → create SPT → build credential → retry with Authorization: Payment
 *   3. View card result
 *
 * Protocol: https://mpp.dev
 * No X-STRIPE-SPT headers. Official MPP transport only.
 */

import './stripe-beta.css';

// ── Config ──────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'https://api.asgcard.dev';

// ── Types ───────────────────────────────────────────────────────
interface WalletState {
  address: string;
  signMessage: (message: string) => Promise<string>;
}

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
let wallet: WalletState | null = null;
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

// ── Freighter Detection ─────────────────────────────────────────
interface FreighterAPI {
  requestAccess: () => Promise<string>;
  getPublicKey: () => Promise<string>;
  signMessage: (msg: string, opts: { networkPassphrase: string }) => Promise<{ signedMessage: string; signerAddress: string }>;
}

function getFreighter(): FreighterAPI | null {
  const w = window as unknown as Record<string, unknown>;
  if (w.freighterApi) return w.freighterApi as FreighterAPI;
  if (w.freighter) return w.freighter as FreighterAPI;
  return null;
}

// ── Wallet Auth Headers (Freighter SEP-0043) ────────────────────
async function buildAuthHeaders(): Promise<Record<string, string>> {
  if (!wallet) throw new Error('Wallet not connected');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `asgcard-auth:${timestamp}`;

  // Freighter signMessage applies SEP-0043:
  // SHA256("Stellar Signed Message:\n" + message) then ed25519 sign
  // Returns { signedMessage: base64 }
  const signature = await wallet.signMessage(message);

  return {
    'X-WALLET-ADDRESS': wallet.address,
    'X-WALLET-SIGNATURE': signature,
    'X-WALLET-TIMESTAMP': timestamp,
    'X-WALLET-AUTH-MODE': 'message',
  };
}

// ── MPP Credential Helpers (inline — browser can't import npm) ──

/**
 * Base64url encode a string (browser-compatible).
 */
function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64url decode a string (browser-compatible).
 */
function base64urlDecode(encoded: string): string {
  let padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4 !== 0) padded += '=';
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Parse the challenge from a WWW-Authenticate: Payment <base64url> header.
 */
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

/**
 * Build an Authorization: Payment <credential> header value.
 * Credential = base64url(JSON({challenge, payload: {spt}}))
 */
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
        <p>Same card product. Same wallet ownership. Different payment rail.</p>
      </section>

      <div class="sb-progress sb-animate sb-animate-delay-2">
        <div class="sb-step-indicator"><span>1</span> Connect Wallet</div>
        <div class="sb-step-divider"></div>
        <div class="sb-step-indicator"><span>2</span> Pay via Stripe</div>
        <div class="sb-step-divider"></div>
        <div class="sb-step-indicator"><span>3</span> Receive Card</div>
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

      <!-- Step 2: Card Details + Stripe Payment -->
      <section class="sb-step-panel" id="step-2">
        <h2>Create Your Card</h2>
        <p>Enter card details and complete payment via Stripe.</p>
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
            Continue to Payment
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </form>

        <!-- Stripe Payment Section (shown after 402 challenge) -->
        <div id="stripe-payment-section" style="display:none" class="sb-stripe-section">
          <h3>Complete Payment</h3>
          <p id="payment-info"></p>
          <div id="stripe-element-container" class="sb-stripe-element"></div>
          <div id="error-payment" style="display:none"></div>
          <button class="sb-cta-btn" id="btn-pay">
            Pay &amp; Create Card
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
          Principle: <strong>Stripe pays, wallet owns.</strong>
        </span>
      </footer>

    </div>
  `;

  $('btn-connect')?.addEventListener('click', handleConnect);
  $('card-form')?.addEventListener('submit', handleCardSubmit);
  $('btn-pay')?.addEventListener('click', handleStripePayment);
  setStep(1);
}

// ── Step 1: Wallet Connect ──────────────────────────────────────

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
        const result = await freighter.signMessage(msg, {
          networkPassphrase: 'Public Global Stellar Network ; September 2015'
        });
        return result.signedMessage;
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

// ── Step 2a: Card Form Submit → 402 MPP Challenge ───────────────
async function handleCardSubmit(e: Event) {
  e.preventDefault();
  if (!wallet) return;
  hideError('error-2');

  const amount = Number(($('f-amount') as HTMLInputElement)?.value);
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

    // Request without credential → expect 402 with WWW-Authenticate: Payment
    const res = await fetch(`${API_BASE}/stripe-beta/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ nameOnCard, email, phone: phone || undefined, amount }),
    });

    if (res.status === 402) {
      // Parse MPP challenge from WWW-Authenticate header
      const wwwAuth = res.headers.get('WWW-Authenticate');
      if (!wwwAuth) {
        showError('error-2', 'Server returned 402 but no WWW-Authenticate header. Contact support.');
        return;
      }

      const challenge = parseMppChallenge(wwwAuth);
      if (!challenge) {
        showError('error-2', 'Could not parse payment challenge. Contact support.');
        return;
      }

      // Also read the body for amount info (RFC 9457 Problem Details)
      const body = await res.json().catch(() => ({}));
      const amountCents = challenge.request
        ? parseInt(String((challenge.request as unknown as Record<string, string>).amount ?? 
            (typeof challenge.request === 'string' ? new URLSearchParams(challenge.request).get('amount') : '0')
          ), 10)
        : 0;

      currentChallenge = challenge;
      currentChallengeAmountCents = amountCents || (body as Record<string, unknown>).amount as number || 0;

      // We need the Stripe publishable key to show Elements.
      // It's available from the API's /pricing endpoint or from env.
      // For now, use a known key or fetch from the API config.
      await fetchPublishableKeyAndInitElements(challenge);

      trackEvent('402_challenge_received');
    } else if (res.status === 201) {
      const data = await res.json();
      showCardResult(data);
    } else {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError('error-2', err.error || `Request failed: ${res.status}`);
    }
  } catch (err) {
    showError('error-2', `Request failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Continue to Payment'; }
  }
}

// ── Fetch Stripe publishable key and init Elements ──────────────
async function fetchPublishableKeyAndInitElements(challenge: MppChallengeWire) {
  try {
    // Single source of truth: GET /stripe-beta/config
    const configRes = await fetch(`${API_BASE}/stripe-beta/config`);
    if (configRes.ok) {
      const config = await configRes.json();
      stripePublishableKey = config.stripePublishableKey || null;
    }

    if (!stripePublishableKey) {
      showError('error-2', 'Could not obtain Stripe configuration. Contact support.');
      return;
    }

    initStripeElements(challenge);
  } catch (err) {
    showError('error-2', `Failed to initialize payment: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Step 2b: Initialize Stripe.js Elements ──────────────────────
function initStripeElements(challenge: MppChallengeWire) {
  if (typeof Stripe === 'undefined') {
    showError('error-2', 'Stripe.js not loaded. Please refresh the page.');
    return;
  }

  if (!stripePublishableKey) {
    showError('error-2', 'Stripe publishable key not available.');
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

  // Show payment section, hide form
  const form = $('card-form') as HTMLFormElement | null;
  if (form) form.style.display = 'none';
  const paymentSection = $('stripe-payment-section');
  if (paymentSection) paymentSection.style.display = 'block';

  const info = $('payment-info');
  if (info) {
    const amountUsd = (currentChallengeAmountCents / 100).toFixed(2);
    const desc = challenge.description || 'ASG Card creation';
    info.textContent = `Payment of $${amountUsd} USD required for: ${desc}`;
  }
}

// ── Step 2c: Complete Payment → Create SPT → Build Credential → Retry ──
async function handleStripePayment() {
  if (!wallet || !savedFormData || !stripeInstance || !stripeElements || !currentChallenge) return;
  hideError('error-payment');

  const btn = $('btn-pay') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

  try {
    const stripe = stripeInstance as ReturnType<typeof Stripe>;
    const elements = stripeElements as ReturnType<ReturnType<typeof Stripe>['elements']>;

    // 1. Submit the Stripe Elements form to validate
    const { error: submitError } = await elements.submit();
    if (submitError) {
      showError('error-payment', submitError.message);
      return;
    }

    // 2. Create PaymentMethod from the Element
    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
      elements,
    });

    if (pmError || !paymentMethod) {
      showError('error-payment', pmError?.message || 'Failed to create payment method');
      return;
    }

    // 3. Create SPT via backend endpoint
    //    (SPT creation requires secret key, so must be server-side)
    const authHeaders = await buildAuthHeaders();
    const sptRes = await fetch(`${API_BASE}/stripe-beta/create-spt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({
        paymentMethod: paymentMethod.id,
        amount: currentChallengeAmountCents,
        currency: 'usd',
      }),
    });

    if (!sptRes.ok) {
      const err = await sptRes.json().catch(() => ({ error: 'SPT creation failed' }));
      showError('error-payment', err.error || 'Failed to create payment token');
      return;
    }

    const { spt } = await sptRes.json();
    if (!spt) {
      showError('error-payment', 'Server did not return SPT');
      return;
    }

    // 4. Build MPP credential: Authorization: Payment <base64url(JSON({challenge, payload: {spt}}))>
    const credential = buildMppCredential(currentChallenge, spt);

    // 5. Retry the card creation request with the credential
    const retryAuthHeaders = await buildAuthHeaders();
    const { amount, nameOnCard, email, phone } = savedFormData;

    const res = await fetch(`${API_BASE}/stripe-beta/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': credential,
        ...retryAuthHeaders,
      },
      body: JSON.stringify({ nameOnCard, email, phone: phone || undefined, amount }),
    });

    if (res.status === 201) {
      const data = await res.json();
      showCardResult(data);
      trackEvent('card_created');
    } else {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError('error-payment', err.error || err.detail || `Payment failed: ${res.status}`);
    }
  } catch (err) {
    showError('error-payment', `Payment failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Pay & Create Card'; }
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
