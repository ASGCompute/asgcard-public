/**
 * ASG Card — Payment Request Approval Page
 *
 * URL: stripe.asgcard.dev/approve?id=pr_xxx&token=tok_xxx
 *
 * Real MPP Flow:
 *   1. Fetch request details via GET /stripe-beta/approve/:id?token=
 *   2. Show amount, description, requester email
 *   3. Owner clicks Approve → POST /stripe-beta/approve/:id (token in body)
 *   4. POST /stripe-beta/approve/:id/complete WITHOUT credential → 402 challenge
 *   5. Parse amount from 402 WWW-Authenticate challenge (source of truth)
 *   6. Init Stripe Elements with challenge amount
 *   7. Owner pays → createPaymentMethod
 *   8. POST /approve/:id/create-spt → SPT
 *   9. Build MPP credential → retry /approve/:id/complete WITH Authorization: Payment
 *  10. Done → card created
 */

import './approve.css';

const API_BASE = 'https://api.asgcard.dev';

// ── Types ───────────────────────────────────────────────────
interface PaymentRequestInfo {
  requestId: string;
  status: string;
  amountUsd: number;
  description: string | null;
  email: string;
  nameOnCard: string | null;
  phone: string | null;
  createdAt: string;
  expiresAt: string;
}

interface MppChallengeWire {
  id: string;
  realm: string;
  method: string;
  intent: string;
  request: string | Record<string, string>;
  description?: string;
  expires?: string;
  hmac?: string;
}

declare const Stripe: (key: string) => {
  elements: (opts?: Record<string, unknown>) => {
    create: (type: string, opts?: Record<string, unknown>) => {
      mount: (selector: string) => void;
      unmount: () => void;
    };
    submit: () => Promise<{ error?: { message: string } }>;
  };
  createPaymentMethod: (opts: Record<string, unknown>) => Promise<{
    error?: { message: string };
    paymentMethod?: { id: string };
  }>;
};

// ── State ───────────────────────────────────────────────────
let requestId: string | null = null;
let approvalToken: string | null = null;
let requestInfo: PaymentRequestInfo | null = null;
let stripeInstance: ReturnType<typeof Stripe> | null = null;
let stripeElements: ReturnType<ReturnType<typeof Stripe>['elements']> | null = null;
let stripePublishableKey: string | null = null;
let currentChallenge: MppChallengeWire | null = null;
let currentChallengeAmountCents = 0;

// ── MPP Helpers (same as stripe-beta.ts) ────────────────────
function base64urlEncode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    return JSON.parse(base64urlDecode(match[1])) as MppChallengeWire;
  } catch { return null; }
}

function buildMppCredential(challenge: MppChallengeWire, sptId: string): string {
  const wire = { challenge, payload: { spt: sptId } };
  return `Payment ${base64urlEncode(JSON.stringify(wire))}`;
}

// ── UI Helpers ──────────────────────────────────────────────
const $ = (id: string) => document.getElementById(id);

function showError(msg: string) {
  const el = $('error-msg');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function hideError() {
  const el = $('error-msg');
  if (el) { el.style.display = 'none'; }
}

function hideAll() {
  ['step-loading', 'step-details', 'step-payment', 'step-done',
   'step-rejected', 'step-already-processed'].forEach(id => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });
}

function showStep(id: string) {
  hideAll();
  const el = $(id);
  if (el) el.style.display = 'block';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function timeRemaining(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const mins = Math.ceil(ms / 60000);
  return mins > 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
}

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  requestId = params.get('id');
  approvalToken = params.get('token') || params.get('amp;token');

  // Fallback to path parameters: /approve/:id/:token
  if (!requestId || !approvalToken) {
    const parts = window.location.pathname.split('/');
    if (parts[1] === 'approve' && parts.length >= 4) {
      requestId = parts[2];
      approvalToken = parts[3];
    }
  }

  const app = $('approve-app');
  if (!app) return;

  app.innerHTML = `
    <div class="ap-container">
      <header class="ap-header">
        <div class="ap-brand">
          <div class="ap-logo">A</div>
          <span class="ap-brand-name">ASG Card</span>
        </div>
        <p class="ap-subtitle">Payment approval request</p>
        <div class="ap-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          Secured by Stripe
        </div>
      </header>

      <div id="error-msg" class="ap-error" style="display:none"></div>

      <div id="step-loading" class="ap-card">
        <p class="ap-loading">Loading request details</p>
      </div>

      <div id="step-details" class="ap-card" style="display:none">
        <h2>Payment Request</h2>
        <div class="ap-info">
          <div class="ap-row"><span class="ap-label">Requested load</span><span id="info-amount" class="ap-value ap-amount"></span></div>
          <div class="ap-row"><span class="ap-label">Card creation fee</span><span id="info-card-fee" class="ap-value">$10.00</span></div>
          <div class="ap-row"><span class="ap-label">Top-up fee (3.5%)</span><span id="info-topup-fee" class="ap-value"></span></div>
          <div class="ap-row ap-row-total"><span class="ap-label">Total due</span><span id="info-total" class="ap-value ap-amount"></span></div>
          <div class="ap-row"><span class="ap-label">Description</span><span id="info-desc" class="ap-value"></span></div>
          <div class="ap-row"><span class="ap-label">Requester</span><span id="info-email" class="ap-value"></span></div>
          <div class="ap-row"><span class="ap-label">Card name</span><span id="info-name" class="ap-value"></span></div>
          <div class="ap-row"><span class="ap-label">Created</span><span id="info-created" class="ap-value"></span></div>
          <div class="ap-row"><span class="ap-label">Expires in</span><span id="info-expires" class="ap-value"></span></div>
        </div>
        <div class="ap-actions">
          <button id="btn-approve" class="ap-btn ap-btn-approve">Approve & Pay</button>
          <button id="btn-reject" class="ap-btn ap-btn-reject">Decline</button>
        </div>
      </div>

      <div id="step-payment" class="ap-card" style="display:none">
        <h2>Complete Payment</h2>
        <p id="payment-info" class="ap-payment-info"></p>
        <div id="stripe-element-container" class="ap-stripe-mount"></div>
        <div id="payment-error" class="ap-error" style="display:none"></div>
        <button id="btn-pay" class="ap-btn ap-btn-approve">Pay now</button>
      </div>

      <div id="step-done" class="ap-card" style="display:none">
        <div class="ap-success">
          <div class="ap-success-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <h2>Payment Complete</h2>
          <p id="done-msg">The virtual card has been created. The requesting agent will receive the card details automatically.</p>
          <p id="done-card-id" class="ap-card-id"></p>
        </div>
      </div>

      <div id="step-rejected" class="ap-card" style="display:none">
        <div class="ap-rejected">
          <div class="ap-rejected-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </div>
          <h2>Request Declined</h2>
          <p>This payment request has been declined. The requesting agent will be notified.</p>
        </div>
      </div>

      <div id="step-already-processed" class="ap-card" style="display:none">
        <div class="ap-info-box">
          <h2 id="already-title">Already Processed</h2>
          <p id="already-msg">This payment request has already been handled.</p>
        </div>
      </div>

      <div class="ap-footer">ASG Card &times; Stripe Machine Payments Protocol</div>
    </div>
  `;

  $('btn-approve')?.addEventListener('click', handleApprove);
  $('btn-reject')?.addEventListener('click', handleReject);
  $('btn-pay')?.addEventListener('click', handlePay);

  loadRequest();
});

// ── Load Request ────────────────────────────────────────────
async function loadRequest() {
  if (!requestId || !approvalToken) {
    showError('Invalid approval link. Missing request ID or token.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/stripe-beta/approve/${requestId}?token=${approvalToken}`);

    if (res.status === 403) {
      showError('Invalid or expired approval link.');
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError(err.error || 'Failed to load request');
      return;
    }

    requestInfo = await res.json();
    if (!requestInfo) return;

    if (requestInfo.status !== 'pending') {
      showNonPendingState(requestInfo.status);
      return;
    }

    // Populate details with pricing breakdown
    const set = (id: string, val: string) => { const el = $(id); if (el) el.textContent = val; };
    const loadAmount = requestInfo.amountUsd;
    const cardFee = 10;
    // Force redeploy to bust CDN cache for paymentMethodCreation fix (2)
    console.log("Approve page loaded.");
    const topupFee = loadAmount > 0 ? loadAmount * 0.035 : 0;
    const totalDue = loadAmount > 0 ? cardFee + loadAmount + topupFee : cardFee;
    set('info-amount', loadAmount > 0 ? `$${loadAmount.toFixed(2)} USD` : '$0.00 (card only)');
    set('info-card-fee', `$${cardFee.toFixed(2)}`);
    set('info-topup-fee', loadAmount > 0 ? `$${topupFee.toFixed(2)}` : '$0.00');
    set('info-total', `$${totalDue.toFixed(2)} USD`);
    set('info-desc', requestInfo.description || 'Card creation');
    set('info-email', requestInfo.email);
    set('info-name', requestInfo.nameOnCard || '—');
    set('info-created', formatDate(requestInfo.createdAt));
    set('info-expires', timeRemaining(requestInfo.expiresAt));

    showStep('step-details');

    // Pre-fetch Stripe publishable key
    const configRes = await fetch(`${API_BASE}/stripe-beta/config`);
    if (configRes.ok) {
      const config = await configRes.json();
      stripePublishableKey = config.stripePublishableKey || null;
    }
  } catch (err) {
    showError(`Failed to load request: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function showNonPendingState(status: string) {
  hideAll();
  if (status === 'approved' || status === 'completed') {
    showStep('step-already-processed');
    const set = (id: string, val: string) => { const el = $(id); if (el) el.textContent = val; };
    set('already-title', status === 'completed' ? 'Already Completed' : 'Already Approved');
    set('already-msg', status === 'completed'
      ? 'This payment request has been completed and the card was created.'
      : 'This payment request has been approved and is awaiting payment completion.');
  } else if (status === 'rejected') {
    showStep('step-rejected');
  } else if (status === 'expired') {
    showError('This payment request has expired.');
  } else {
    showError(`Request status: ${status}`);
  }
}

// ── Approve → 402 Challenge → Stripe Elements ───────────────
async function handleApprove() {
  if (!requestId || !approvalToken || !requestInfo) return;
  hideError();

  const btn = $('btn-approve') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Approving…'; }

  try {
    // Step 1: Approve the request
    const approveRes = await fetch(`${API_BASE}/stripe-beta/approve/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve', token: approvalToken }),
    });

    if (!approveRes.ok) {
      const err = await approveRes.json().catch(() => ({ error: `HTTP ${approveRes.status}` }));
      showError(err.error || 'Approval failed');
      if (btn) { btn.disabled = false; btn.textContent = 'Approve & Pay'; }
      return;
    }

    // Step 2: Trigger 402 challenge from /approve/:id/complete (no credential)
    if (btn) btn.textContent = 'Getting payment details...';

    const challengeRes = await fetch(`${API_BASE}/stripe-beta/approve/${requestId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: approvalToken,
        amount: requestInfo.amountUsd,
        nameOnCard: requestInfo.nameOnCard,
        email: requestInfo.email,
        phone: requestInfo.phone,
      }),
    });

    if (challengeRes.status !== 402) {
      const err = await challengeRes.json().catch(() => ({ error: `Unexpected ${challengeRes.status}` }));
      showError(err.error || 'Failed to initiate payment');
      if (btn) { btn.disabled = false; btn.textContent = 'Approve & Pay'; }
      return;
    }

    // Step 3: Parse the 402 WWW-Authenticate challenge
    const wwwAuth = challengeRes.headers.get('WWW-Authenticate');
    if (!wwwAuth) {
      showError('Server returned 402 but no payment challenge. Contact support.');
      if (btn) { btn.disabled = false; btn.textContent = 'Approve & Pay'; }
      return;
    }

    const challenge = parseMppChallenge(wwwAuth);
    if (!challenge) {
      showError('Could not parse payment challenge. Contact support.');
      if (btn) { btn.disabled = false; btn.textContent = 'Approve & Pay'; }
      return;
    }

    // Step 4: Extract amount from challenge (source of truth from backend)
    let amountCents = 0;
    if (challenge.request && typeof challenge.request === 'object') {
      amountCents = parseInt(String((challenge.request as Record<string, string>).amount || '0'), 10);
    } else if (typeof challenge.request === 'string') {
      const raw = new URLSearchParams(challenge.request).get('amount') || '0';
      amountCents = parseInt(raw.replace(/"/g, ''), 10);
    }

    if (amountCents <= 0) {
      showError('Invalid payment amount in challenge. Contact support.');
      if (btn) { btn.disabled = false; btn.textContent = 'Approve & Pay'; }
      return;
    }

    currentChallenge = challenge;
    currentChallengeAmountCents = amountCents;

    // Step 5: Init Stripe Elements with backend-provided amount
    await initStripePayment(challenge, amountCents);

  } catch (err) {
    showError(`Approval failed: ${err instanceof Error ? err.message : String(err)}`);
    if (btn) { btn.disabled = false; btn.textContent = '✅ Approve & Pay'; }
  }
}

// ── Reject ──────────────────────────────────────────────────
async function handleReject() {
  if (!requestId || !approvalToken) return;
  if (!confirm('Are you sure you want to reject this payment request?')) return;

  const btn = $('btn-reject') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Declining…'; }

  try {
    const res = await fetch(`${API_BASE}/stripe-beta/approve/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', token: approvalToken }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      showError(err.error || 'Rejection failed');
      if (btn) { btn.disabled = false; btn.textContent = 'Decline'; }
      return;
    }

    showStep('step-rejected');
  } catch (err) {
    showError(`Rejection failed: ${err instanceof Error ? err.message : String(err)}`);
    if (btn) { btn.disabled = false; btn.textContent = 'Decline'; }
  }
}

// ── Stripe Payment Init ─────────────────────────────────────
async function initStripePayment(challenge: MppChallengeWire, amountCents: number) {
  if (!stripePublishableKey) {
    showError('Stripe not configured. Please try again.');
    return;
  }
  if (typeof Stripe === 'undefined') {
    showError('Stripe.js not loaded. Please refresh.');
    return;
  }

  stripeInstance = Stripe(stripePublishableKey);
  stripeElements = stripeInstance.elements({
    mode: 'payment',
    amount: amountCents,
    currency: 'usd',
    paymentMethodCreation: 'manual',
  });

  const paymentElement = stripeElements.create('payment');
  paymentElement.mount('#stripe-element-container');

  const paymentInfo = $('payment-info');
  if (paymentInfo) {
    const desc = challenge.description || 'ASG Card creation';
    paymentInfo.textContent = `Payment of $${(amountCents / 100).toFixed(2)} USD required for: ${desc}`;
  }

  showStep('step-payment');
}

// ── Complete Payment (real MPP flow) ────────────────────────
async function handlePay() {
  if (!stripeInstance || !stripeElements || !requestId || !approvalToken ||
      !requestInfo || !currentChallenge) return;
  hideError();

  const btn = $('btn-pay') as HTMLButtonElement | null;
  if (btn) { btn.disabled = true; btn.textContent = 'Processing…'; }

  const showPayError = (msg: string) => {
    const el = $('payment-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
    if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
  };

  try {
    const stripe = stripeInstance;
    const elements = stripeElements;

    // 1. Submit Stripe Elements form
    const { error: submitError } = await elements.submit();
    if (submitError) { showPayError(submitError.message); return; }

    // 2. Create PaymentMethod
    const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({ elements });
    if (pmError || !paymentMethod) { showPayError(pmError?.message || 'Failed to create payment method'); return; }

    // 3. Create SPT via approval-scoped endpoint
    if (btn) btn.textContent = 'Creating payment token…';

    const sptRes = await fetch(`${API_BASE}/stripe-beta/approve/${requestId}/create-spt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: approvalToken,
        paymentMethod: paymentMethod.id,
        amount: currentChallengeAmountCents,
        currency: 'usd',
      }),
    });

    if (!sptRes.ok) {
      const err = await sptRes.json().catch(() => ({ error: 'SPT creation failed' }));
      showPayError(err.error || 'Failed to create payment token');
      return;
    }

    const { spt } = await sptRes.json();
    if (!spt) { showPayError('Server did not return payment token'); return; }

    // 4. Build MPP credential
    const credential = buildMppCredential(currentChallenge, spt);

    // 5. Retry /approve/:id/complete WITH the credential
    if (btn) btn.textContent = 'Creating card…';

    const completeRes = await fetch(`${API_BASE}/stripe-beta/approve/${requestId}/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': credential,
      },
      body: JSON.stringify({
        token: approvalToken,
        amount: requestInfo.amountUsd,
        nameOnCard: requestInfo.nameOnCard,
        email: requestInfo.email,
        phone: requestInfo.phone,
      }),
    });

    if (completeRes.status === 201) {
      const data = await completeRes.json();
      showStep('step-done');
      const doneMsg = $('done-msg');
      if (doneMsg) doneMsg.textContent = 'Payment successful! The card has been created and the agent will receive the details.';
      const cardIdEl = $('done-card-id');
      if (cardIdEl && data.card?.cardId) cardIdEl.textContent = `Card ID: ${data.card.cardId}`;
    } else {
      const err = await completeRes.json().catch(() => ({ error: `HTTP ${completeRes.status}` }));
      showPayError(err.error || err.detail || `Payment failed: ${completeRes.status}`);
    }
  } catch (err) {
    showPayError(`Payment failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
