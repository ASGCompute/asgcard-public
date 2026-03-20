# Security Best Practices Report

## Executive Summary

The highest-risk issues are on the money-moving and card-detail paths. The current Stripe MPP beta path appears replayable in a way that can issue multiple cards for a single successful charge, wallet authentication is implemented as a reusable signed timestamp rather than a request-bound proof, and the miniapp treats Telegram `initData` as a long-lived bearer credential while exposing card details through a path that bypasses the nonce/rate-limit controls used elsewhere. Together, these issues create realistic loss scenarios: free card issuance, replayed privileged actions, and repeated PAN/CVV disclosure.

## Scope And Assumptions

- In scope: runtime API paths and browser miniapp/Stripe beta surfaces in `/api/src` and `/web/src`.
- In scope: current working tree, including uncommitted files such as `api/src/middleware/mppxPayment.ts`, `api/src/lib/mppProtocol.ts`, and the modified `api/src/routes/stripeBeta.ts`.
- Out of scope: infrastructure controls not visible in repo (CDN/WAF/Vercel header rewriting, Stripe dashboard policies, 4payments-side controls).
- Assumption: this service is internet-exposed and used to issue/fund real cards and reveal real PAN/CVV data.
- Assumption: log access exists for operators, vendors, or support staff; therefore replayable material in logs is security-relevant.
- Assumption: Telegram WebApp `initData` is intended to be short-lived proof of Telegram identity, not a permanent API token.

## Critical Findings

### SBP-001 — Replay Of One MPP Credential Can Issue Multiple Cards For One Successful Stripe Payment

**Severity:** Critical

**Locations**

- `api/src/middleware/mppxPayment.ts:219-283`
- `api/src/routes/stripeBeta.ts:167-211`
- `api/src/services/cardService.ts:141-154`
- `api/src/db/migrations/013_payment_rails.sql:9-18`

**Evidence**

- `requireMppxPayment()` creates a Stripe `PaymentIntent` with a deterministic idempotency key: `mppx_${challenge.id}_${spt}`.
- On success it only sets `req.paymentContext = { txHash: pi.id, ... }` and calls `next()`.
- `stripeBetaRouter.post("/create", ...)` immediately calls `cardService.createCard(...)`.
- `cardService.createCard()` inserts a new card row every time and stores `paymentReference`, but the schema adds only a normal column/index for `payment_reference`; there is no uniqueness or one-time-consumption check for Stripe references.

**Impact**

A replay of the same successful MPP credential/SPT can reuse the same successful Stripe `PaymentIntent` and still create another card, because the downstream issuance path does not bind issuance to a one-time-consumed payment record. This is a direct monetary-loss bug: one paid authorization can mint multiple cards or repeated funded actions.

**Fix**

- Introduce a Stripe payment consumption ledger keyed by `pi.id` (or by `challenge.id + spt`) and reject already-consumed references before card issuance.
- Enforce a database uniqueness constraint for the Stripe-side payment reference used to authorize issuance/funding.
- Bind the MPP challenge to the concrete action context: route, purpose, wallet address, and canonical request body hash.
- Treat the Stripe payment step as authorization to perform exactly one side effect, not merely as proof that a `PaymentIntent` once succeeded.

**Mitigation**

Immediately disable the Stripe MPP beta route until one-time payment consumption is enforced server-side.

### SBP-002 — Wallet Auth Signature Is A Reusable 5-Minute Bearer Credential Across All Wallet Routes

**Severity:** Critical

**Locations**

- `api/src/middleware/walletAuth.ts:76-125`
- `api/src/routes/wallet.ts:42-49`
- `api/src/modules/portal/routes.ts:17-18`

**Evidence**

- The only signed message is `asgcard-auth:${timestamp}`.
- The signature is not bound to HTTP method, path, query, body hash, `cardId`, or `X-AGENT-NONCE`.
- The accepted replay window is `MAX_CLOCK_DRIFT_SECONDS = 300`.
- The same middleware protects card listing, card details, freeze/unfreeze, and portal routes.

**Impact**

Any stolen or phished wallet signature remains valid for arbitrary privileged actions for up to five minutes. An attacker who captures one signed timestamp can call other wallet-authenticated endpoints, including card detail retrieval with an attacker-chosen fresh nonce, freeze/unfreeze, and owner portal actions. This turns the signature into a short-lived bearer token rather than a request-specific authorization proof.

**Fix**

- Sign a canonical request envelope including method, path, body hash, timestamp, and a unique nonce.
- Store and reject reused wallet-auth nonces server-side.
- Reduce the time window materially once request binding exists.
- Separate “read card details” from general wallet auth with a stronger purpose-bound signature format.

**Mitigation**

Do not expose wallet-authenticated browser flows until the signature is request-bound. At minimum, require a nonce in the signed message for all sensitive wallet routes, not only the details endpoint.

### SBP-003 — Miniapp Accepts Long-Lived Telegram `initData` And Bypasses Card-Detail Anti-Replay Controls

**Severity:** Critical

**Locations**

- `api/src/modules/miniapp/index.ts:15-28`
- `api/src/modules/miniapp/index.ts:43-55`
- `api/src/modules/miniapp/index.ts:99-109`
- `api/src/modules/miniapp/index.ts:230-247`
- `api/src/modules/miniapp/index.ts:292-300`

**Evidence**

- `validateInitData()` verifies only the HMAC and returns the embedded user object; it does not enforce freshness via `auth_date`.
- `GET /api/miniapp/cards` and `GET /api/miniapp/payment-status/:intentId` take `initData` via query string.
- `POST /api/miniapp/reveal` calls `cardService.getCardDetails(wallet, cardId)` directly, with no `X-AGENT-NONCE`, no one-time token, and no hourly reveal limit.

**Impact**

Leaked Telegram `initData` becomes a long-lived bearer credential for miniapp actions. Because some endpoints accept it in the URL, it can be captured by server logs, browser history, shared screenshots, or upstream edge logs. Once leaked, an attacker can repeatedly call `/reveal` to fetch PAN/CVV without the anti-replay/rate-limit protections enforced on `/cards/:id/details`.

**Fix**

- Reject `initData` older than a short max age, based on Telegram `auth_date`.
- Stop accepting `initData` via query string; accept it only in request body or a dedicated header on POST requests.
- Redact `initData` anywhere it could hit logs.
- Gate `/reveal` behind the same nonce/rate-limit model or a dedicated one-time reveal token.

**Mitigation**

Assume any previously logged `initData` is compromised. Rotate the miniapp auth model before enabling browser-side card reveal in production.

## High Findings

### SBP-004 — Logging Configuration Leaves Replayable Auth And Payment Material In Logs

**Severity:** High

**Locations**

- `api/src/utils/logger.ts:6-30`
- `api/src/routes/ops.ts:27-30`
- `node_modules/pino-std-serializers/lib/req.js:73-88`

**Evidence**

- Redaction covers `req.headers.authorization`, but not `req.headers["x-wallet-signature"]`, `req.headers["x-wallet-address"]`, `req.headers["x-wallet-timestamp"]`, `req.headers["x-payment"]`, or `req.url`.
- Installed pino request serialization includes both `req.url` and `req.headers`.
- `opsAuth` accepts the ops API key from `req.query.key`, which therefore becomes part of `req.url`.

**Impact**

Logs can contain live wallet-auth headers, x402 payment proofs, long-lived miniapp `initData` in query strings, and ops API keys passed via `?key=`. Anyone with log access can potentially replay privileged requests or recover operational secrets.

**Fix**

- Redact `req.url` and all wallet/payment headers, not just generic `Authorization`.
- Remove query-string auth for ops endpoints entirely.
- Audit existing log sinks for historical exposure of `initData`, wallet signatures, and ops keys.

**Mitigation**

Treat log stores as sensitive systems until replayable request material has been removed and rotated.

### SBP-005 — Ops IP Allowlist Uses Raw `X-Forwarded-For` Instead Of A Trusted Proxy-Derived Client IP

**Severity:** High

**Locations**

- `api/src/routes/ops.ts:37-46`
- `api/src/app.ts:15`

**Evidence**

- `opsAuth()` reads `req.header("x-forwarded-for")?.split(",")[0]` directly.
- The app does not configure an explicit `trust proxy` topology.

**Impact**

If the edge/proxy chain preserves or appends user-controlled `X-Forwarded-For` values, an attacker with the ops key may be able to spoof an allowlisted IP and reach ops endpoints. This is especially risky because query-string ops auth is also supported.

**Fix**

- Use an explicit `trust proxy` configuration and rely on `req.ip`, or validate against a trusted platform-specific header only after confirming edge overwrite behavior.
- Remove the query-string key path to avoid pairing a leaked key with a spoofed IP.

**Mitigation**

Verify at deployment time whether the platform overwrites `X-Forwarded-For`; until then, treat the IP allowlist as weaker than intended.

## Medium Findings

### SBP-006 — Browser Security Baseline Is Weak For High-Value Wallet/Card Flows

**Severity:** Medium

**Locations**

- `api/src/app.ts:15`
- `web/stripe/index.html`

**Evidence**

- The app enables default `cors()` globally and no security headers middleware such as Helmet is visible in app code.
- The Stripe beta page loads third-party Stripe.js from CDN, but no CSP or other response-header policy is visible in repo code.

**Impact**

This increases blast radius for browser-based exploit chains. It is not the root cause of the wallet-auth replay bugs, but it makes signature phishing, XSS exploitation, and cross-origin abuse easier to operationalize on a high-value payment surface.

**Fix**

- Add a restrictive CORS policy for browser-facing privileged routes.
- Add response security headers, especially CSP and `X-Content-Type-Options`.
- Minimize or isolate browser flows that handle card reveal or wallet signatures.

### SBP-007 — Telegram Wallet Binding Lookup Is Ambiguous If A User Has Multiple Active Bindings

**Severity:** Medium

**Locations**

- `api/src/modules/authz/ownerPolicy.ts:28-49`
- `api/src/modules/miniapp/index.ts:58-64`
- `api/src/modules/miniapp/index.ts:77-83`
- `api/src/db/migrations/003_bot_tables.sql:16`

**Evidence**

- `owner_telegram_links` is unique on `(owner_wallet, telegram_user_id)`, not on `telegram_user_id` alone.
- Both `findActiveBinding()` and `resolveWalletData()` use `WHERE telegram_user_id = $1 AND status = 'active' LIMIT 1` with no deterministic ordering.
- The miniapp `/onboard` path can create an additional active binding for the same Telegram user.

**Impact**

If a Telegram user accumulates multiple active bindings, the code can select an arbitrary wallet for card actions and reveal flows. This is more of an authorization-integrity issue than a direct bypass, but on a money-moving system it can still cause wrong-account actions and confusing access control behavior.

**Fix**

- Enforce a single active binding per Telegram user for the flows that depend on that invariant, or explicitly model multi-wallet selection.
- Add deterministic ordering and reject ambiguous binding states.

## Immediate Fix Order

1. Disable Stripe MPP beta until payment-consumption replay protection exists.
2. Replace timestamp-only wallet auth with request-bound signatures and server-side nonce tracking.
3. Expire Telegram `initData`, remove it from URLs, and protect `/miniapp/reveal` with one-time or rate-limited reveal semantics.
4. Remove query-string auth and broaden redaction to all replayable headers and URL secrets.
5. Validate ops source IPs through trusted proxy configuration, not raw forwarded headers.

## Audit Method

- Static code audit only.
- No runtime penetration testing was performed.
- No infrastructure config outside the repository was available for validation.
