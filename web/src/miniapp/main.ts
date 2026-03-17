import './style.css';

// ── Telegram WebApp types ──────────────────────────────────
declare global {
    interface Window { Telegram: { WebApp: any } }
}
const tg = window.Telegram?.WebApp;

// ── Types ──────────────────────────────────────────────────
interface Card {
    cardId: string;
    nameOnCard: string;
    lastFour: string;
    balance: number;
    status: string;
}

interface CardReveal {
    cardNumber: string;
    expiryMonth: number;
    expiryYear: number;
    cvv: string;
    billingAddress?: { street: string; city: string; state: string; zip: string; country: string };
}

interface FundTier {
    fundAmount: number;
    topUpFee: number;
    serviceFee: number;
    totalCost: number;
    endpoint: string;
}

interface CardTier {
    id: string;
    name: string;
    category: string;
    price: number;
    badge: string;
    tagline: string;
    cardClass: string;
    cardLabel: string;
    features: { icon: string; title: string; desc: string }[];
    cta: string;
    instant: boolean;
}

// ── State ──────────────────────────────────────────────────
const state = {
    screen: 'loading' as string,
    initData: '',
    walletAddress: '',
    cards: [] as Card[],
    selectedCard: null as Card | null,
    cardReveal: null as CardReveal | null,
    fundTiers: [] as FundTier[],
    profile: null as { email?: string, phone?: string } | null,
    selectedTier: null as CardTier | null,
    pendingIntentId: null as string | null,
    loading: false,
    toastMsg: '',
    error: '',
};

const API = import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.trim() + '/api/miniapp' : '/api/miniapp';

// ── Rendering Engine (preserves focused inputs) ────────────
let _prevScreen = '';

function render() {
    const app = document.getElementById('app');
    if (!app) return;

    const screens: Record<string, () => string> = {
        loading: screenLoading,
        onboarding: screenOnboarding,
        kyc: screenKYC,
        'select-card': screenSelectCard,
        'card-tier-detail': screenCardTierDetail,
        cards: screenCards,
        'card-detail': screenCardDetail,
        fund: screenFund,
        reveal: screenReveal,
        agent: screenAgent,
    };

    // Save focused input values before re-render
    const focusedEl = document.activeElement as HTMLInputElement | null;
    const focusedId = focusedEl?.id;
    const savedInputs: Record<string, string> = {};
    app.querySelectorAll('input').forEach(inp => {
        if (inp.id) savedInputs[inp.id] = inp.value;
    });

    const noNav = ['onboarding', 'loading', 'kyc', 'select-card', 'card-tier-detail'];
    const renderer = screens[state.screen] || screenCards;

    // Add transition class on screen change
    const isScreenChange = _prevScreen !== state.screen;
    _prevScreen = state.screen;

    app.innerHTML = renderer() + (noNav.includes(state.screen) ? '' : navBar());

    // Restore input values and focus
    for (const [id, val] of Object.entries(savedInputs)) {
        const inp = document.getElementById(id) as HTMLInputElement | null;
        if (inp) inp.value = val;
    }
    if (focusedId) {
        const el = document.getElementById(focusedId) as HTMLInputElement | null;
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = el.value.length; }
    }

    // Screen transition animation (double-rAF to ensure class is applied after paint)
    if (isScreenChange) {
        const screenEl = app.querySelector('.screen');
        if (screenEl) {
            requestAnimationFrame(() => {
                screenEl.classList.add('screen-enter');
            });
        }
    }

    if (state.toastMsg) {
        const existing = document.querySelector('.toast');
        if (!existing) {
            const t = document.createElement('div');
            t.className = 'toast';
            t.textContent = state.toastMsg;
            document.body.appendChild(t);
            setTimeout(() => { t.remove(); state.toastMsg = ''; }, 2500);
        }
    }

    bindEvents();
}

function bindEvents() {
    // Nav
    document.querySelectorAll('[data-nav]').forEach(el => {
        el.addEventListener('click', () => navigate(el.getAttribute('data-nav')!));
    });
    // Actions
    document.querySelectorAll('[data-action]').forEach(el => {
        const action = el.getAttribute('data-action')!;
        const param = el.getAttribute('data-param') || '';
        el.addEventListener('click', () => handleAction(action, param));
    });
}

function navigate(screen: string) {
    state.screen = screen;
    state.error = '';
    if (screen === 'cards') loadCards();
    else render();
}

// ── Progress Bar Component ─────────────────────────────────
function progressBar(step: number): string {
    const labels = ['Wallet', 'Verify', 'Choose Card'];
    const dots = labels.map((l, i) => {
        const status = i < step ? 'done' : i === step ? 'active' : '';
        return `<div class="progress-step ${status}">
            <div class="progress-dot">${i < step ? '✓' : i + 1}</div>
            <div class="progress-label">${l}</div>
        </div>`;
    }).join('<div class="progress-line"></div>');
    return `<div class="progress-bar">${dots}</div>`;
}

// ── Screens ────────────────────────────────────────────────

function screenLoading(): string {
    return `<div class="screen" style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
        <div style="text-align:center;"><span class="spinner" style="width:32px;height:32px;border-width:3px;"></span><p style="margin-top:16px;color:var(--hint);">Loading ASG Card…</p></div>
    </div>`;
}

function screenOnboarding(): string {
    return `<div class="screen onboard-screen">
        ${progressBar(0)}
        <div class="wallet-illustration">
            <div class="card-inserted">
                <div class="chip"></div>
                <div class="logo">ASG</div>
            </div>
            <div class="wallet-pocket"></div>
        </div>
        <div class="onboard-glass">
            <div class="pill-badge">
                <span class="pill-icon">✜</span> 
                <span style="opacity: 0.9">Zero Fees</span> 
                <span class="pill-icon">✜</span>
            </div>
            <div class="stepper">
                <div class="stepper-item">
                    <div class="stepper-circle">1</div>
                    <div class="stepper-content">
                        <h4>Create Smart Wallet</h4>
                        <p>Deploy an Account Abstraction wallet with sponsored gas</p>
                    </div>
                </div>
                <div class="stepper-item">
                    <div class="stepper-circle">2</div>
                    <div class="stepper-content">
                        <h4>Verify Identity</h4>
                        <p>Light KYC — just your email and phone number</p>
                    </div>
                </div>
                <div class="stepper-item">
                    <div class="stepper-circle">3</div>
                    <div class="stepper-content">
                        <h4>Choose Your Card</h4>
                        <p>Pick from Virtual, Stellar Platinum, or Special Edition</p>
                    </div>
                </div>
            </div>
            <button class="btn btn-gold" data-action="createWallet" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? '<span class="spinner"></span>&nbsp;&nbsp;Creating…' : 'Create Smart Wallet'}
            </button>
            ${state.error ? '<p style="color:var(--danger);text-align:center;margin-top:12px;font-size:14px;">' + escapeHtml(state.error) + '</p>' : ''}
        </div>
    </div>`;
}

function screenKYC(): string {
    return `<div class="screen onboard-screen">
        ${progressBar(1)}
        <div class="wallet-illustration" style="margin-top: 24px; margin-bottom: 16px;">
            <div class="card-inserted" style="transform: scale(0.8);">
                <div class="chip"></div>
                <div class="logo">ASG</div>
            </div>
            <div class="wallet-pocket" style="transform: scale(0.8); margin-top: -60px;"></div>
        </div>
        <div class="onboard-glass" style="padding: 32px 24px;">
            <div style="margin-bottom: 24px; text-align: center;">
                <h2 style="font-size:24px; font-weight:600; margin-bottom: 8px;">Verify Identity</h2>
                <p style="color:var(--hint); font-size:14px;">Provide your basic details to activate your virtual card.</p>
            </div>
            
            <div style="margin-bottom: 16px;">
                <label style="display:block; color:var(--hint); font-size:12px; margin-bottom:8px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Email Address</label>
                <input type="email" id="kyc-email" class="input-premium" placeholder="name@example.com" value="${state.profile?.email || ''}" />
            </div>
            
            <div style="margin-bottom: 24px;">
                <label style="display:block; color:var(--hint); font-size:12px; margin-bottom:8px; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Phone Number</label>
                <input type="tel" id="kyc-phone" class="input-premium" placeholder="+1 234 567 8900" value="${state.profile?.phone || ''}" />
            </div>

            <button class="btn btn-gold" data-action="submitKyc" ${state.loading ? 'disabled' : ''}>
                ${state.loading ? '<span class="spinner"></span>&nbsp;&nbsp;Saving…' : 'Continue'}
            </button>
            <button class="btn btn-secondary" data-action="goSelectCard" style="margin-top:12px;" ${state.loading ? 'disabled' : ''}>Skip for now</button>
            
            ${state.error ? '<p style="color:var(--danger);text-align:center;margin-top:16px;font-size:14px;">' + escapeHtml(state.error) + '</p>' : ''}
        </div>
    </div>`;
}

function screenCards(): string {
    if (state.loading) return screenLoading();
    
    let kycWidget = '';
    if (state.walletAddress && (!state.profile?.email || !state.profile?.phone)) {
        kycWidget = `<div class="kyc-widget" data-action="goKyc">
            <div class="kyc-widget-icon">🛡️</div>
            <div class="kyc-widget-content">
                <div class="kyc-widget-title">Verify Your Identity</div>
                <div class="kyc-widget-desc">Complete light KYC to unlock all features.</div>
            </div>
            <div class="kyc-widget-arrow">→</div>
        </div>`;
    }

    if (state.cards.length === 0) {
        return `<div class="screen">
            ${kycWidget}
            <div class="empty-state" style="${kycWidget ? 'margin-top: 20px;' : ''}">
                <div class="empty-state-icon">💳</div>
                <div class="empty-state-title">No Cards Yet</div>
                <div class="empty-state-desc">Choose a card plan to get started with ASG Card.</div>
                <button class="btn btn-gold" data-action="goSelectCard" style="margin-bottom: 12px;">Get a Card</button>
                <button class="btn btn-secondary" data-action="reload">Refresh</button>
            </div>
        </div>`;
    }

    const totalBalance = state.cards.reduce((s, c) => s + c.balance, 0);
    const cardItems = state.cards.map(c => {
        const icon = c.status === 'frozen' ? '❄️' : '💳';
        const badge = c.status === 'frozen' ? '<span class="badge badge-frozen">Frozen</span>' : '<span class="badge badge-active">Active</span>';
        return `<div class="list-item" data-action="selectCard" data-param="${c.cardId}">
            <div class="list-item-icon" style="background:var(--surface);">${icon}</div>
            <div class="list-item-body">
                <div class="list-item-title">ASG Card •••• ${c.lastFour}</div>
                <div class="list-item-subtitle">${badge}</div>
            </div>
            <div class="list-item-right balance">$${c.balance.toFixed(2)}</div>
        </div>`;
    }).join('');

    return `<div class="screen" style="padding-bottom:80px;">
        ${kycWidget}
        <div class="detail-balance" style="${kycWidget ? 'margin-top: 24px;' : 'margin-top: 8px;'}">
            <div class="label">Total Balance</div>
            <div class="amount">$${totalBalance.toFixed(2)}</div>
        </div>
        <div class="section-title">My Cards</div>
        <div class="list-group">${cardItems}</div>
        <button class="btn btn-secondary" data-action="goSelectCard" style="margin-top: 20px;">+ Get Another Card</button>
    </div>`;
}

function screenCardDetail(): string {
    const c = state.selectedCard;
    if (!c) return screenCards();

    const isFrozen = c.status === 'frozen';
    const badge = isFrozen ? '<span class="badge badge-frozen">Frozen</span>' : '<span class="badge badge-active">Active</span>';

    return `<div class="screen" style="padding-bottom:80px;">
        <div class="card-standalone">
            <div class="chip"></div>
            <div class="logo">ASG</div>
            <div class="number">•••• •••• •••• ${c.lastFour}</div>
            <div class="details">
                <div><div class="label">Name</div><div class="value">${c.nameOnCard}</div></div>
            </div>
        </div>
        <div class="detail-balance">
            <div class="label">Available Balance ${badge}</div>
            <div class="amount">$${c.balance.toFixed(2)}</div>
        </div>

        <div class="detail-actions">
            <div class="detail-action-btn" data-action="goFund" data-param="${c.cardId}">
                <div class="detail-action-icon">💰</div>Fund
            </div>
            <div class="detail-action-btn" data-action="goReveal" data-param="${c.cardId}">
                <div class="detail-action-icon">👁</div>Reveal
            </div>
            <div class="detail-action-btn" data-action="${isFrozen ? 'unfreezeCard' : 'freezeCard'}" data-param="${c.cardId}">
                <div class="detail-action-icon">${isFrozen ? '🔥' : '❄️'}</div>${isFrozen ? 'Unfreeze' : 'Freeze'}
            </div>
            <div class="detail-action-btn" data-action="goAgent">
                <div class="detail-action-icon">🧠</div>Agent
            </div>
        </div>

        <button class="btn btn-secondary" data-action="backCards" style="margin-top:12px;">← Back to Cards</button>
    </div>`;
}

function screenFund(): string {
    const c = state.selectedCard;
    if (!c) return screenCards();

    if (state.loading) {
        return `<div class="screen"><div style="text-align:center;margin-top:60px;"><span class="spinner" style="width:28px;height:28px;"></span><p style="margin-top:12px;color:var(--hint);">Loading tiers…</p></div></div>`;
    }

    const tiers = state.fundTiers.map(t => {
        return `<div class="fund-tier" data-action="fundCard" data-param="${t.fundAmount}">
            <div><div class="fund-tier-amount">$${t.fundAmount.toFixed(0)}</div><div class="fund-tier-cost">Fee: $${(t.totalCost - t.fundAmount).toFixed(2)}</div></div>
            <div style="text-align:right;"><div style="font-weight:600;">$${t.totalCost.toFixed(2)}</div><div style="font-size:12px;color:var(--hint);">Total USDC</div></div>
        </div>`;
    }).join('');

    return `<div class="screen" style="padding-bottom:80px;">
        <div class="detail-balance">
            <div class="label">Fund Card •••• ${c.lastFour}</div>
            <div class="amount" style="font-size:32px;">$${c.balance.toFixed(2)}</div>
        </div>
        <div class="section-title">Select Amount</div>
        ${tiers || '<p style="color:var(--hint);text-align:center;padding:20px;">No funding tiers available.</p>'}
        <p style="font-size:12px;color:var(--hint);text-align:center;margin-top:16px;">Payment via USDC on Stellar</p>
        <button class="btn btn-secondary" data-action="backDetail" style="margin-top:16px;">← Back</button>
    </div>`;
}

function screenReveal(): string {
    const c = state.selectedCard;
    if (!c) return screenCards();

    if (state.loading) {
        return `<div class="screen"><div style="text-align:center;margin-top:60px;"><span class="spinner" style="width:28px;height:28px;"></span><p style="margin-top:12px;color:var(--hint);">Fetching card details…</p></div></div>`;
    }

    const d = state.cardReveal;
    if (!d) {
        return `<div class="screen"><div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Unavailable</div><div class="empty-state-desc">${state.error || 'Card details could not be loaded.'}</div></div><button class="btn btn-secondary" data-action="backDetail">← Back</button></div>`;
    }

    const num = String(d.cardNumber).replace(/(.{4})/g, '$1 ').trim();
    const exp = String(d.expiryMonth).padStart(2, '0') + '/' + String(d.expiryYear).slice(-2);
    const addr = d.billingAddress;

    return `<div class="screen" style="padding-bottom:80px;">
        <div class="card-standalone" style="height:190px; margin-bottom: 24px;">
            <div class="chip"></div>
            <div class="logo">ASG</div>
            <div class="number" style="font-size:20px;">${num}</div>
            <div class="details">
                <div style="margin-right:16px;"><div class="label">Expiry</div><div class="value">${exp}</div></div>
                <div><div class="label">CVV</div><div class="value">${d.cvv}</div></div>
            </div>
        </div>
        <div class="section-title">Billing Address</div>
        <div class="reveal-card">
            ${addr ? `<div class="reveal-row"><span class="reveal-label">Street</span><span class="reveal-value" style="font-family:inherit;font-size:13px;text-align:right;letter-spacing:0;">${addr.street}</span></div>
            <div class="reveal-row"><span class="reveal-label">City</span><span class="reveal-value" style="font-family:inherit;font-size:13px;text-align:right;letter-spacing:0;">${addr.city}, ${addr.state} ${addr.zip}</span></div>
            <div class="reveal-row" style="border:none;padding-bottom:0px;"><span class="reveal-label">Country</span><span class="reveal-value" style="font-family:inherit;font-size:13px;text-align:right;letter-spacing:0;">${addr.country}</span></div>` : ''}
        </div>
        <p style="font-size:12px;color:var(--danger);text-align:center;margin:16px 0;">⚠️ Keep this information private.</p>
        <button class="btn btn-secondary" data-action="backDetail">← Back</button>
    </div>`;
}

function screenAgent(): string {
    const c = state.selectedCard;
    const cardInfo = c ? `Card •••• ${c.lastFour}` : 'your card';

    return `<div class="screen" style="padding-bottom:80px;">
        <div class="detail-balance" style="margin-top:16px; padding: 32px 24px;">
            <div style="font-size:48px; margin-bottom:16px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5));">🧠</div>
            <div class="amount" style="font-size:26px; margin-bottom:8px;">Agent Handoff</div>
            <p style="color:var(--hint);font-size:14px;line-height:1.5;text-transform:none;letter-spacing:normal;">Give ${cardInfo} to your AI agent so it can make autonomous payments with zero gas fees.</p>
        </div>
        <div class="list-group">
            <div class="list-item" style="cursor:default;">
                <div class="list-item-icon" style="background:var(--surface);">1</div>
                <div class="list-item-body"><div class="list-item-title">Connect the Skill</div><div class="list-item-subtitle">Install the x402-payments-skill on your agent.</div></div>
            </div>
            <div class="list-item" style="cursor:default;">
                <div class="list-item-icon" style="background:var(--surface);">2</div>
                <div class="list-item-body"><div class="list-item-title">Provide Wallet</div><div class="list-item-subtitle">Share the wallet: ${state.walletAddress ? state.walletAddress.slice(0, 10) + '…' + state.walletAddress.slice(-6) : 'Link first'}</div></div>
            </div>
            <div class="list-item" style="cursor:default;">
                <div class="list-item-icon" style="background:var(--surface);">3</div>
                <div class="list-item-body"><div class="list-item-title">Done!</div><div class="list-item-subtitle">The agent will use your ASG Card for all x402 payments.</div></div>
            </div>
        </div>
        <a href="https://github.com/asgcompute/x402-payments-skill" target="_blank" class="btn btn-primary" style="margin-top:24px;display:block;">View x402 Skill on GitHub</a>
        <button class="btn btn-secondary" data-action="backCards" style="margin-top:10px;">← Back</button>
    </div>`;
}

// ── Card Tier Data ─────────────────────────────────────────

const CARD_TIERS: CardTier[] = [
    {
        id: 'virtual',
        name: 'Virtual Card',
        category: 'Virtual Cards',
        price: 10,
        badge: 'VISA Platinum',
        tagline: 'A sleek virtual card, ready to tap and pay instantly.',
        cardClass: 'card-visual-gold',
        cardLabel: 'Virtual Card',
        features: [
            { icon: '📱', title: 'Apple Pay & Google Pay', desc: 'Shop on the go with Apple Pay and Google Pay for quick and safe payments.' },
            { icon: '🏧', title: 'ATM Withdrawals', desc: 'Take out cash from any ATM worldwide, no matter the currency!' },
            { icon: '🌍', title: '195+ Countries', desc: 'Use one card to spend wherever you want in any currency.' },
        ],
        cta: 'Get this card',
        instant: true,
    },
    {
        id: 'stellar',
        name: 'Stellar Platinum',
        category: 'Premium Cards',
        price: 50,
        badge: 'VISA Platinum',
        tagline: '24k premium card — earn rewards in Stellar (XLM).',
        cardClass: 'card-visual-stellar',
        cardLabel: 'Stellar Platinum',
        features: [
            { icon: '✦', title: 'Stellar Rewards', desc: 'Earn 5% cashback in XLM on all card spend.' },
            { icon: '👑', title: 'VIP Concierge', desc: 'Exclusive access to ASG senior support team.' },
            { icon: '📈', title: 'Staking Boost', desc: 'Earn 1x bonus points on your staked XLM balance.' },
        ],
        cta: 'Get this card',
        instant: true,
    },
    {
        id: 'locked',
        name: 'Locked Card',
        category: 'Special Cards',
        price: 500,
        badge: 'Special Edition',
        tagline: 'Not all cards are public. Enter your code to unlock.',
        cardClass: 'card-visual-locked',
        cardLabel: '🔒 LOCKED CARD',
        features: [
            { icon: '🔐', title: 'Exclusive Access', desc: 'Available only to invited members with a valid unlock code.' },
            { icon: '💎', title: 'Premium Limits', desc: 'Higher spending limits and priority processing.' },
            { icon: '⚡', title: 'Early Access', desc: 'Be first to access new ASG features and products.' },
        ],
        cta: 'Apply',
        instant: false,
    },
];

function screenSelectCard(): string {
    return `<div class="screen" style="padding-bottom: 40px;">
        ${progressBar(2)}
        <h2 style="font-size: 28px; font-weight: 700; margin-bottom: 32px; padding-top: 8px;">Select your card</h2>
        
        <div class="card-tier-section-label">Virtual Cards</div>
        ${CARD_TIERS.filter(t => t.category === 'Virtual Cards').map(t => renderTierItem(t)).join('')}
        
        <div class="card-tier-section-label" style="margin-top: 24px;">Premium Cards</div>
        ${CARD_TIERS.filter(t => t.category === 'Premium Cards').map(t => renderTierItem(t)).join('')}
        
        <div class="card-tier-section-label" style="margin-top: 24px;">Special Cards</div>
        ${CARD_TIERS.filter(t => t.category === 'Special Cards').map(t => renderTierItem(t)).join('')}
        
        <button class="btn btn-secondary" data-action="backCards" style="margin-top: 32px;">Skip for now</button>
    </div>`;
}

function renderTierItem(t: CardTier): string {
    return `<div class="card-tier-item" data-action="viewTier" data-param="${t.id}">
        <div class="card-tier-mini ${t.cardClass}">
            <div class="card-tier-mini-label">${t.cardLabel}</div>
        </div>
        <div class="card-tier-info">
            <div class="card-tier-name">${t.name}</div>
            <div class="card-tier-badge">${t.badge}</div>
        </div>
        <div class="card-tier-price">$${t.price}/card ›</div>
    </div>`;
}

function screenCardTierDetail(): string {
    const t = state.selectedTier;
    if (!t) return screenSelectCard();

    const featuresHtml = t.features.map((f: any) => `
        <div class="tier-feature">
            <div class="tier-feature-icon">${f.icon}</div>
            <div class="tier-feature-body">
                <div class="tier-feature-title">${f.title}</div>
                <div class="tier-feature-desc">${f.desc}</div>
            </div>
        </div>`).join('');

    const isLocked = t.id === 'locked';
    const unlockInput = isLocked ? `
        <div style="margin-top: 24px; margin-bottom: 8px;">
            <div class="input-premium" style="display:flex; align-items:center; gap: 12px; padding: 12px 16px;">
                <input type="text" id="unlock-code" placeholder="Unlock code" style="flex:1; background:transparent; border:none; color:var(--text); font-size:16px; outline:none; font-family:inherit;" />
            </div>
        </div>` : '';

    const ctaBtn = isLocked
        ? `<button class="btn" style="background: rgba(255,255,255,0.08); color: var(--hint); margin-top: 16px;" data-action="applyLockedCard" ${state.loading ? 'disabled' : ''}>${state.loading ? '<span class="spinner"></span>&nbsp;&nbsp;Applying…' : 'Apply'}</button>`
        : `<button class="btn btn-gold" data-action="orderCard" data-param="${t.id}" ${state.loading ? 'disabled' : ''}>${state.loading ? '<span class="spinner"></span>&nbsp;&nbsp;Processing…' : t.cta}</button>`;

    // Make dots clickable
    const dotsHtml = CARD_TIERS.map(ct =>
        `<span class="tier-dot ${ct.id === t.id ? 'active' : ''}" data-action="viewTier" data-param="${ct.id}" style="cursor:pointer;"></span>`
    ).join('');

    return `<div class="screen" style="padding-bottom: 40px;">
        <button class="btn-back" data-action="backSelectCard">←</button>
        
        <div class="card-tier-hero ${t.cardClass}">
            <div class="card-tier-hero-label">${t.cardLabel}</div>
            <div class="card-tier-hero-number">•••• •••• •••• ••••</div>
            ${t.id === 'stellar' ? '<div class="card-tier-hero-badge">✦</div>' : ''}
            ${t.id !== 'locked' ? '<div class="card-tier-hero-visa">VISA<br><small>Platinum</small></div>' : ''}
        </div>
        
        <div class="tier-dots">${dotsHtml}</div>
        
        <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 4px;">${t.id === 'locked' ? 'Unlock your special card' : t.name}</h2>
        <p style="color: var(--hint); font-size: 14px; margin-bottom: 24px; line-height:1.5;">${t.tagline}</p>
        
        ${!isLocked ? '<div style="font-size:13px; color:var(--hint); margin-bottom: 16px;">🏦 Virtual Card</div>' : ''}
        
        ${!isLocked ? '<div style="font-weight:600; font-size:16px; margin-bottom: 16px;">Features</div>' : ''}
        <div class="tier-features">${featuresHtml}</div>
        
        ${unlockInput}
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 24px; margin-bottom: 16px;">
            <div>
                <span style="font-size: 28px; font-weight: 700;">$${t.price}</span>
                <span style="color: var(--hint); font-size: 14px;"> per card</span>
            </div>
            ${t.instant ? '<span style="font-size: 13px;">🎉 Get it Instantly</span>' : ''}
        </div>
        
        ${ctaBtn}
        
        ${state.error ? '<p style="color:var(--danger);text-align:center;margin-top:16px;font-size:14px;">' + escapeHtml(state.error) + '</p>' : ''}
    </div>`;
}

function navBar(): string {
    const items = [
        { id: 'cards', icon: '💳', label: 'Cards' },
        { id: 'select-card', icon: '🛒', label: 'Shop' },
        { id: 'agent', icon: '🧠', label: 'Agent' },
    ];
    return `<div class="nav-bar">${items.map(i =>
        `<div class="nav-item ${state.screen === i.id ? 'active' : ''}" data-nav="${i.id}"><div class="nav-icon">${i.icon}</div>${i.label}</div>`
    ).join('')}</div>`;
}

// ── Actions ────────────────────────────────────────────────

async function handleAction(action: string, param: string) {
    switch (action) {
        case 'createWallet': return createWallet();
        case 'goKyc': state.screen = 'kyc'; state.error = ''; render(); return;
        case 'submitKyc': return submitKyc();
        case 'goSelectCard': state.screen = 'select-card'; state.error = ''; render(); return;
        case 'viewTier': tg?.HapticFeedback?.impactOccurred('light'); return viewTier(param);
        case 'orderCard': return orderCard(param);
        case 'applyLockedCard': return applyLockedCard();
        case 'selectCard': return selectCard(param);
        case 'goFund': return goFund(param);
        case 'goReveal': return goReveal(param);
        case 'goAgent': return navigate('agent');
        case 'freezeCard': return toggleFreeze(param, 'frozen');
        case 'unfreezeCard': return toggleFreeze(param, 'active');
        case 'fundCard': return fundCard(param);
        case 'backCards': return navigate('cards');
        case 'backSelectCard': state.screen = 'select-card'; render(); return;
        case 'backDetail': state.screen = 'card-detail'; render(); return;
        case 'reload': return loadCards();
    }
}

async function createWallet() {
    if (state.loading) return;
    state.loading = true; state.error = ''; render();
    try {
        const initData = state.initData || tg?.initData || '';
        if (!initData && location.hostname !== 'localhost') throw new Error('Please open inside Telegram.');

        await delay(600);
        const res = await post(`${API}/onboard`, { initData: initData });
        state.walletAddress = res.walletAddress;
        tg?.HapticFeedback?.notificationOccurred('success');
        state.toastMsg = '✅ Wallet created!';
        state.loading = false;
        state.screen = 'kyc'; state.error = ''; render();
    } catch (e: any) {
        state.error = e.message;
        tg?.HapticFeedback?.notificationOccurred('error');
        state.loading = false; render();
    }
}

async function loadCards() {
    state.loading = true; state.screen = 'cards'; render();
    try {
        const res = await get(`${API}/cards?initData=${encodeURIComponent(state.initData)}`);
        state.cards = res.cards || [];
        state.walletAddress = res.walletAddress || state.walletAddress;
        state.profile = res.profile || null;
    } catch (e: any) {
        state.cards = [];
    }
    state.loading = false; render();
}

async function submitKyc() {
    if (state.loading) return;
    const emailInput = document.getElementById('kyc-email') as HTMLInputElement | null;
    const phoneInput = document.getElementById('kyc-phone') as HTMLInputElement | null;
    
    if (!emailInput || !phoneInput) return;
    const email = emailInput.value.trim();
    const phone = phoneInput.value.trim();
    
    if (!email || !phone) {
        state.error = 'Please fill in both fields.';
        render();
        return;
    }

    // Frontend validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        state.error = 'Please enter a valid email address.';
        render();
        return;
    }

    if (!phone.startsWith('+')) {
        state.error = 'Phone number must start with + (e.g. +1 234 567 8900).';
        render();
        return;
    }

    state.loading = true; state.error = ''; render();
    try {
        const res = await post(`${API}/kyc`, { initData: state.initData, email, phone });
        state.profile = res.profile;
        state.toastMsg = '✅ Identity verified!';
        tg?.HapticFeedback?.notificationOccurred('success');
        state.loading = false;
        state.screen = 'select-card'; state.error = ''; render();
    } catch (e: any) {
        state.error = e.message;
        tg?.HapticFeedback?.notificationOccurred('error');
        state.loading = false; render();
    }
}

function viewTier(tierId: string) {
    state.selectedTier = CARD_TIERS.find(t => t.id === tierId) || null;
    state.screen = 'card-tier-detail';
    state.error = '';
    render();
}

async function orderCard(tierId: string) {
    if (state.loading) return;
    state.loading = true; state.error = ''; render();
    try {
        const res = await post(`${API}/order-card`, { initData: state.initData, tier: tierId });
        if (res.invoiceUrl) {
            state.pendingIntentId = res.intentId || null;
            state.toastMsg = '💳 Opening payment…';
            state.loading = false; render();
            // Use openTelegramLink for t.me links, openLink for others
            if (res.invoiceUrl.includes('t.me') && tg?.openTelegramLink) {
                tg.openTelegramLink(res.invoiceUrl);
            } else if (tg?.openLink) {
                tg.openLink(res.invoiceUrl);
            } else {
                window.open(res.invoiceUrl, '_blank');
            }
        } else {
            state.toastMsg = `✅ ${state.selectedTier?.name || 'Card'} ordered!`;
            tg?.HapticFeedback?.notificationOccurred('success');
            state.loading = false;
            await loadCards();
        }
    } catch (e: any) {
        state.error = e.message;
        tg?.HapticFeedback?.notificationOccurred('error');
        state.loading = false; render();
    }
}

async function applyLockedCard() {
    if (state.loading) return;
    const codeInput = document.getElementById('unlock-code') as HTMLInputElement | null;
    const code = codeInput?.value?.trim() || '';
    if (!code) {
        state.error = 'Please enter your unlock code.';
        render();
        return;
    }
    state.loading = true; state.error = ''; render();
    try {
        const res = await post(`${API}/order-card`, { initData: state.initData, tier: 'locked', unlockCode: code });
        if (res.invoiceUrl) {
            state.pendingIntentId = res.intentId || null;
            state.toastMsg = '💳 Opening payment…';
            state.loading = false; render();
            if (res.invoiceUrl.includes('t.me') && tg?.openTelegramLink) {
                tg.openTelegramLink(res.invoiceUrl);
            } else if (tg?.openLink) {
                tg.openLink(res.invoiceUrl);
            } else {
                window.open(res.invoiceUrl, '_blank');
            }
        } else {
            state.toastMsg = '🔓 Special card unlocked!';
            tg?.HapticFeedback?.notificationOccurred('success');
            state.loading = false;
            await loadCards();
        }
    } catch (e: any) {
        state.error = e.message;
        tg?.HapticFeedback?.notificationOccurred('error');
        state.loading = false; render();
    }
}

async function selectCard(cardId: string) {
    state.selectedCard = state.cards.find(c => c.cardId === cardId) || null;
    state.screen = 'card-detail';
    render();
}

async function goFund(_cardId: string) {
    state.screen = 'fund'; state.loading = true; render();
    try {
        const res = await get(`${API}/fund-tiers`);
        state.fundTiers = res.tiers || [];
    } catch { state.fundTiers = []; }
    state.loading = false; render();
}

async function goReveal(cardId: string) {
    state.screen = 'reveal'; state.loading = true; state.cardReveal = null; state.error = ''; render();
    try {
        const res = await post(`${API}/reveal`, { initData: state.initData, cardId });
        state.cardReveal = res.details;
    } catch (e: any) {
        state.error = e.message;
    }
    state.loading = false; render();
}

async function toggleFreeze(cardId: string, newStatus: string) {
    try {
        await post(`${API}/card-status`, { initData: state.initData, cardId, status: newStatus });
        if (state.selectedCard) state.selectedCard.status = newStatus;
        state.toastMsg = newStatus === 'frozen' ? '❄️ Card frozen' : '🔥 Card unfrozen';
        tg?.HapticFeedback?.notificationOccurred('success');
    } catch (e: any) {
        state.toastMsg = '⚠️ ' + e.message;
    }
    render();
}

async function fundCard(amount: string) {
    const tier = state.fundTiers.find(t => t.fundAmount === Number(amount));
    if (!tier || !state.selectedCard) return;
    state.toastMsg = `Use the SDK to fund $${tier.fundAmount} (cost $${tier.totalCost.toFixed(2)} USDC). POST ${tier.endpoint}`;
    tg?.HapticFeedback?.impactOccurred('medium');
    render();
}

// ── Payment Status Polling ─────────────────────────────────
// When user returns from CryptoBot payment, check if payment was confirmed

async function checkPendingPayment() {
    if (!state.pendingIntentId) return;
    try {
        const res = await get(`${API}/payment-status/${state.pendingIntentId}?initData=${encodeURIComponent(state.initData)}`);
        if (res.status === 'paid') {
            state.pendingIntentId = null;
            state.toastMsg = '✅ Payment confirmed!';
            tg?.HapticFeedback?.notificationOccurred('success');
            await loadCards();
        }
    } catch {
        // Silently ignore — will retry on next visibility change
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        checkPendingPayment();
    }
});

// ── Helpers ─────────────────────────────────────────────────

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function get(url: string) {
    try {
        const res = await fetch(url);
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error || 'Request failed'); }
        return res.json();
    } catch (e: any) {
        if (e.message === 'Failed to fetch' || e.name === 'TypeError') {
            throw new Error('Network error. Please check your connection.');
        }
        throw e;
    }
}

async function post(url: string, body: any) {
    try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as any).error || 'Request failed'); }
        return res.json();
    } catch (e: any) {
        if (e.message === 'Failed to fetch' || e.name === 'TypeError') {
            throw new Error('Network error. Please check your connection.');
        }
        throw e;
    }
}

// ── Init ───────────────────────────────────────────────────

async function init() {
    if (tg) { tg.expand(); tg.MainButton?.hide(); }
    state.initData = tg?.initData || '';

    // If we have initData → check if already onboarded
    if (state.initData || location.hostname === 'localhost') {
        try {
            const res = await get(`${API}/cards?initData=${encodeURIComponent(state.initData || '')}`);
            state.cards = res.cards || [];
            state.walletAddress = res.walletAddress || '';
            state.profile = res.profile || null;
            if (state.walletAddress) {
                if (state.profile?.email && state.profile?.phone) {
                    state.screen = 'cards';
                } else {
                    state.screen = 'kyc';
                }
            } else {
                state.screen = 'onboarding';
            }
        } catch {
            state.screen = 'onboarding';
        }
    } else {
        state.screen = 'onboarding';
    }
    render();
}

init();
