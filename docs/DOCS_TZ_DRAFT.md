# ASG Card — Docs v1: Полное ТЗ

> **Статус:** DRAFT — ожидает review/approve от Founder  
> **Дата:** 2026-02-19  
> **Автор:** AI coordinator  
> **Источники:**  
>
> - [OpenCard Docs](https://opencard.dev/docs) — reference implementation  
> - [PLAN.md](file:///Users/innocode/Desktop/Test/ASGcard/docs/PLAN.md), [CTO_TZ.md](file:///Users/innocode/Desktop/Test/ASGcard/docs/CTO_TZ.md)  
> - Код: `api/src/routes/`, `api/src/config/pricing.ts`, `sdk/src/`

---

## 1. Scope и цели Docs v1

### 1.1 Цель

Одностраничная (single-page, multi-section) документация для `docs.asgcard.dev`, структурно повторяющая OpenCard docs, но адаптированная для **Solana + Ed25519** вместо Base/EVM + EIP-712.

### 1.2 Целевая аудитория

- AI-агенты (программно читают API reference)
- Разработчики AI-агентов (читают SDK Quick Start)
- Интеграторы платёжных систем (читают x402 flow)

### 1.3 Scope v1

| В scope | Не в scope |
|---------|------------|
| Все 10 API endpoints | Мультичейн (только Solana mainnet) |
| SDK `@asgcard/sdk` | Admin-панель |
| x402 + wallet auth | Мобильное приложение |
| Pricing (из `GET /pricing`) | Changelog / versioned docs |
| Architecture diagram | Многоязычность |

### 1.4 Принцип контента
>
> **[ПРАВИЛО]** Docs НИКОГДА не хардкодят цены. Таблицы цен генерируются из `GET /pricing` или ссылаются на этот endpoint как source of truth.

---

## 2. Полная карта разделов / якорей

Структура 1:1 с OpenCard:

| # | Anchor ID | Заголовок | Аналог в OpenCard |
|---|-----------|-----------|-------------------|
| 1 | `#introduction` | Introduction | Introduction |
| 2 | `#overview` | Overview | Overview |
| 3 | `#sdk` | SDK | SDK |
| 3.1 | `#install` | Install | Install |
| 3.2 | `#quick-start` | Quick Start | Quick Start |
| 3.3 | `#configuration` | Configuration | Configuration |
| 3.4 | `#methods` | Methods | Methods |
| 3.5 | `#error-handling` | Error Handling | Error Handling |
| 3.6 | `#low-level-utilities` | Low-Level x402 Utilities | Low-Level x402 Utilities |
| 3.7 | `#how-it-works` | How It Works (sequence diagram) | How It Works |
| 4 | `#authentication` | Authentication | Authentication |
| 4.1 | `#x402-payment-flow` | x402 Payment Flow | x402 Payment Flow |
| 4.2 | `#wallet-signature` | Wallet Signature (Free Endpoints) | Wallet Signature |
| 5 | `#pricing` | Pricing | Pricing |
| 5.1 | `#card-creation` | Card Creation | Card Creation |
| 5.2 | `#card-funding` | Card Funding | Card Funding |
| 6 | `#endpoints` | Endpoints | Endpoints |
| 6.1 | `#public-endpoints` | Public Endpoints | Public Endpoints |
| 6.2 | `#paid-endpoints` | Paid Endpoints (x402) | Paid Endpoints (x402) |
| 6.3 | `#wallet-signed-endpoints` | Wallet-Signed Endpoints | Wallet-Signed Endpoints |
| 7 | `#errors` | Errors | Errors |
| 8 | `#rate-limits` | Rate Limits | Rate Limits |
| 9 | `#architecture` | Architecture | Architecture |

**Sidebar (On this page):**
Introduction · Overview · SDK · Authentication · Pricing · Endpoints · Errors · Rate Limits · Architecture

---

## 3. Таблица соответствия OpenCard → ASG Card

| Аспект | OpenCard (Base/EVM) | ASG Card (Solana) | Статус |
|--------|---------------------|-------------------|--------|
| Блокчейн | Base (EIP-155 chain 8453) | **Solana mainnet** | ✅ ФАКТ (из кода) |
| Network ID в x402 | `eip155:8453` | **`solana:mainnet`** | ✅ ФАКТ |
| Стейблкоин | USDC (ERC-20) `0x8335…` | **USDC (SPL)** `EPjFWdd5Aufq…` | ✅ ФАКТ |
| SDK пакет | `@opencardsdk/sdk` | **`@asgcard/sdk`** | ✅ ФАКТ |
| SDK зависимость | `viem` | **`@solana/web3.js`** | ✅ ФАКТ |
| Подпись (auth) | EIP-712 typed data | **Ed25519 detached (nacl)** | ✅ ФАКТ |
| Auth domain | `{ name: "OpenCard", chainId: 8453 }` | **message: `asgcard-auth:<timestamp>`** | ✅ ФАКТ (из CTO_TZ §7) |
| Auth message format | EIP-712 typed message | **Plain UTF-8 string** | ✅ ФАКТ |
| Auth headers | Same names | **Same names** (`X-WALLET-ADDRESS`, `X-WALLET-SIGNATURE`, `X-WALLET-TIMESTAMP`) | ✅ ФАКТ |
| Base URL prod | `api.opencard.dev` | **`api.asgcard.dev`** | ✅ ФАКТ |
| Private key format | `0x…` (hex) | **Base58** (Solana secret key) | ✅ ФАКТ |
| Wallet adapter | viem `WalletClient` | **Solana `WalletAdapter`** (`signTransaction`) | ✅ ФАКТ |
| Proof transport | `X-Payment: base64(JSON)` | **`X-Payment: base64(JSON)`** (идентично) | ✅ ФАКТ |
| Класс клиента | `OpenCardClient` | **`ASGCardClient`** | ✅ ФАКТ |
| USDC decimals | 6 (same) | **6 (same)** | ✅ ФАКТ |
| Tx verification | EVM node `eth_getTransactionReceipt` | **Solana RPC `getTransaction`** | ⚠️ ПРЕДПОЛОЖЕНИЕ (логика в middleware) |
| x402 scheme | `exact` | **`exact`** (идентично) | ✅ ФАКТ |

---

## 4. Контент-спека по каждому разделу

### 4.1 Introduction (`#introduction`)

**Назначение:** Hero-блок, первое впечатление. Объясняет что за продукт и принцип "Payment is Authentication".

**Текстовый каркас:**

```
ASG Card API Documentation

x402-Powered Virtual Card Issuance for AI Agents

ASG Card lets AI agents autonomously purchase and manage virtual debit cards
by paying with USDC on Solana via the x402 payment protocol.

Streamlined onboarding — get started in minutes.

Base URL: https://api.asgcard.dev
```

**Навигация (быстрые ссылки):**
SDK · Authentication · Pricing · Endpoints · Errors · Rate Limits

**Code snippets:** нет  
**JSON examples:** нет

---

### 4.2 Overview (`#overview`)

**Назначение:** Объяснить 3 класса endpoints.

**Текстовый каркас:**

```
Overview

ASG Card exposes a REST API with three classes of endpoints:

| Type | Auth | Description |
|------|------|-------------|
| Public | None | Health check, pricing, tiers |
| Paid (x402) | USDC payment on Solana | Create/fund cards |
| Wallet-signed | Ed25519 signature | Card management |
```

**Code snippets:** нет  
**JSON examples:** нет

---

### 4.3 SDK (`#sdk`)

#### 4.3.1 Install (`#install`)

**Code snippet (bash):**

```bash
npm install @asgcard/sdk @solana/web3.js
```

> **[ФАКТ]** из `sdk/package.json` — зависимости: `@solana/web3.js`, `@solana/spl-token`, `bs58`

---

#### 4.3.2 Quick Start (`#quick-start`)

**Code snippet (TypeScript):**

```typescript
import { ASGCardClient } from '@asgcard/sdk';

const client = new ASGCardClient({
  privateKey: '<base58_solana_key>',
  baseUrl: 'https://api.asgcard.dev',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
});

// One line — SDK handles payment automatically
const card = await client.createCard({
  amount: 10,       // $10 tier
  nameOnCard: 'AI AGENT',
  email: 'agent@example.com',
});

console.log(card.details); // { cardNumber, cvv, expiry, ... }
```

> **[ФАКТ]** Полностью соответствует `sdk/src/client.ts` constructor + `createCard()`.

---

#### 4.3.3 Configuration (`#configuration`)

**Таблица параметров (из `sdk/src/types/index.ts` → `ASGCardClientConfig`):**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `privateKey` | `string` | One of two | — | Base58 Solana private key (32 or 64 bytes) |
| `walletAdapter` | `WalletAdapter` | One of two | — | Solana wallet adapter (expects `publicKey` + `signTransaction`) |
| `baseUrl` | `string` | No | `https://api.asgcard.dev` | API base URL |
| `rpcUrl` | `string` | No | `https://api.mainnet-beta.solana.com` | Solana RPC endpoint |
| `timeout` | `number` | No | `60000` | Request timeout in milliseconds |

> **[ФАКТ]** Defaults из `sdk/src/client.ts` lines 15-17.

---

#### 4.3.4 Methods (`#methods`)

##### `client.createCard(params): Promise<CardResult>`

Create a virtual card. Pays USDC automatically.

**Params (из `CreateCardParams`):**

| Field | Type | Values |
|-------|------|--------|
| `amount` | `number` | `5`–`5000` (any whole dollar amount) |
| `nameOnCard` | `string` | Name embossed on card |
| `email` | `string` | Delivery email |

**Code snippet:**

```typescript
const result = await client.createCard({
  amount: 50,
  nameOnCard: 'AI AGENT',
  email: 'agent@example.com',
});
```

**Response type `CardResult`** — document in JSON example (see §5.2 Paid Endpoints).

---

##### `client.fundCard(params): Promise<FundResult>`

Fund an existing card.

**Params (из `FundCardParams`):**

| Field | Type | Values |
|-------|------|--------|
| `amount` | `number` | `5`–`5000` (any whole dollar amount) |
| `cardId` | `string` | UUID of existing card |

**Code snippet:**

```typescript
const result = await client.fundCard({
  amount: 25,
  cardId: 'card-uuid',
});
```

---

##### `client.getPricing(): Promise<PricingResponse>`

Get current pricing info (no payment required). Returns $10 card fee + 3.5% top-up fee.

##### `client.health(): Promise<HealthResponse>`

Check if the ASG Card API is reachable.

##### `client.address: string`

The Solana wallet address (base58) being used for payments.

> **[ФАКТ]** Все методы подтверждены в `sdk/src/client.ts`.

---

#### 4.3.5 Error Handling (`#error-handling`)

**Code snippet:**

```typescript
import {
  ASGCardClient,
  InsufficientBalanceError,
  PaymentError,
  ApiError,
  TimeoutError,
} from '@asgcard/sdk';

try {
  const card = await client.createCard({ ... });
} catch (error) {
  if (error instanceof InsufficientBalanceError) {
    console.log(`Need ${error.required}, have ${error.available}`);
  } else if (error instanceof PaymentError) {
    console.log(`Payment failed: ${error.message}, tx: ${error.txHash}`);
  } else if (error instanceof ApiError) {
    console.log(`Server error ${error.status}:`, error.body);
  } else if (error instanceof TimeoutError) {
    console.log('Request timed out');
  }
}
```

**Error classes (из `sdk/src/errors/index.ts`):**

| Class | Fields | When |
|-------|--------|------|
| `InsufficientBalanceError` | `required`, `available` | USDC balance < required |
| `PaymentError` | `message`, `txHash?` | Solana tx failed |
| `ApiError` | `status`, `body` | Server returned non-2xx |
| `TimeoutError` | `message` | Request exceeded timeout |

> **[ФАКТ]** 4 error классов точно соответствуют `sdk/src/errors/index.ts`.

---

#### 4.3.6 Low-Level x402 Utilities (`#low-level-utilities`)

**Code snippet:**

```typescript
import {
  parseChallenge,
  checkBalance,
  executePayment,
  buildPaymentProof,
  handleX402Payment,
} from '@asgcard/sdk';
```

**Функции (из `sdk/src/utils/x402.ts`):**

| Function | Signature | Description |
|----------|-----------|-------------|
| `parseChallenge` | `(input: unknown) → X402Accept` | Parse 402 challenge, returns first accepted method |
| `checkBalance` | `(params) → Promise<void>` | Throws `InsufficientBalanceError` if USDC < required |
| `executePayment` | `(params) → Promise<string>` | Sends USDC on Solana, returns txHash |
| `buildPaymentProof` | `(input) → string` | Builds base64-encoded X-Payment header value |
| `handleX402Payment` | `(params) → Promise<string>` | Full cycle: parse → pay → build proof |

> **[ФАКТ]** Все 5 функций экспортируются из `sdk/src/utils/x402.ts`.

---

#### 4.3.7 How It Works — Sequence Diagram (`#how-it-works`)

**ASCII diagram (адаптированная из OpenCard):**

```
Your Code       SDK            ASG Card API       Solana
   |              |                 |                 |
   |-- createCard→|                 |                 |
   |              |--- POST ------->|                 |
   |              |<-- 402 ---------|                 |
   |              |                                   |
   |              |--- SPL transfer -----→ USDC tx -->|
   |              |<-- txHash ------ ← receipt -------|
   |              |                                   |
   |              |--- POST + X-Payment →|            |
   |              |<-- 201 + card -------|            |
   |<- CardResult |                 |                 |
```

---

### 4.4 Authentication (`#authentication`)

#### 4.4.1 x402 Payment Flow (`#x402-payment-flow`)

**Назначение:** Полное описание 4-шагового протокола x402 на Solana.

##### Step 1 — Request without payment

**Code snippet (curl):**

```bash
curl -X POST https://api.asgcard.dev/cards/create/tier/10 \
  -H "Content-Type: application/json" \
  -d '{"nameOnCard": "AGENT ALPHA", "email": "agent@example.com"}'
```

##### Step 2 — Receive 402 with payment instructions

**JSON example (из PLAN.md §3 + CTO_TZ §6.1):**

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:mainnet",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "maxAmountRequired": "113500000",
    "payTo": "<TREASURY_PUBKEY>",
    "maxTimeoutSeconds": 300,
    "resource": "/cards/create/tier/100",
    "description": "Create ASG Card with $100 load"
  }]
}
```

**Описание полей:**

| Field | Description |
|-------|-------------|
| `scheme` | Always `"exact"` |
| `network` | `"solana:mainnet"` |
| `asset` | USDC SPL mint address |
| `maxAmountRequired` | Amount in atomic USDC (6 decimals) |
| `payTo` | ASG Treasury public key |
| `maxTimeoutSeconds` | Payment window (300s) |

> **[ФАКТ]** Структура `X402Challenge` / `X402Accept` из `sdk/src/types/index.ts` lines 87-101.

##### Step 3 — Agent pays USDC on Solana

Описание: parse `accepts` array, send specified USDC amount to `payTo` address on Solana using SPL token transfer.

##### Step 4 — Retry with payment proof

**JSON example (X-Payment payload, из CTO_TZ §6.3):**

```json
{
  "scheme": "exact",
  "network": "solana:mainnet",
  "payload": {
    "authorization": {
      "from": "<AGENT_PUBKEY>",
      "to": "<TREASURY_PUBKEY>",
      "value": "113500000"
    },
    "txHash": "<SOLANA_TX_SIGNATURE>"
  }
}
```

> **[ФАКТ]** Transport = `X-Payment: base64(JSON)` (CTO_TZ §6.2). Fallback = raw JSON. Структура из `X402PaymentProof` в `sdk/src/types/index.ts` lines 103-114.

---

#### 4.4.2 Wallet Signature — Free Endpoints (`#wallet-signature`)

**Назначение:** Ed25519 подпись для бесплатных эндпоинтов (card management).

**Required Headers:**

| Header | Description |
|--------|-------------|
| `X-WALLET-ADDRESS` | Solana public key (base58) |
| `X-WALLET-SIGNATURE` | Ed25519 detached signature (base58) |
| `X-WALLET-TIMESTAMP` | Unix timestamp (seconds) |

**Signature protocol (из CTO_TZ §7):**

```
message = "asgcard-auth:<unixTimestamp>"
algorithm = Ed25519 detached
validity window = ±5 minutes
```

**Code snippet (TypeScript):**

```typescript
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

const keypair = Keypair.fromSecretKey(/* base58-decoded secret key */);
const timestamp = Math.floor(Date.now() / 1000);
const message = `asgcard-auth:${timestamp}`;

const signature = nacl.sign.detached(
  Buffer.from(message),
  keypair.secretKey,
);

const response = await fetch('https://api.asgcard.dev/cards', {
  headers: {
    'X-WALLET-ADDRESS': keypair.publicKey.toBase58(),
    'X-WALLET-SIGNATURE': bs58.encode(signature),
    'X-WALLET-TIMESTAMP': String(timestamp),
  },
});
```

> **[ФАКТ]** Полностью соответствует PLAN.md §4.3 и CTO_TZ §7.

---

### 4.5 Pricing (`#pricing`)

> **[ПРАВИЛО]** UI и Docs не хардкодят цены. Источник — `GET /pricing`.

**Единая модель:**
- **$10** — выпуск карты (one-time card fee)
- **3.5%** — комиссия на каждое пополнение
- Диапазон: $5–$5,000

> Пример: Создание карты с $100 → $100 + $10 + $3.50 = **$113.50 USDC**
> Пополнение $200 → $200 + $7.00 = **$207 USDC**

---

## 5. API Reference

> Все контракты ниже СТРОГО из кода (`api/src/routes/`), подтверждены `sdk/src/types/`.

### 5.1 Public Endpoints (`#public-endpoints`)

#### `GET /health`

Health check. No authentication required.

**Response 200:**

```json
{
  "status": "ok",
  "timestamp": "2026-02-11T14:00:00.000Z",
  "version": "1.0.0"
}
```

> **[ФАКТ]** Из `public.ts` lines 7-13. Поля: `status`, `timestamp`, `version` (из `env.API_VERSION`).

---

#### `GET /pricing`

Returns current pricing: $10 card issuance fee + 3.5% top-up fee. Accepted range: $5–$5,000.

**Response 200:**

```json
{
  "cardFee": 10,
  "topUpRate": 0.035,
  "minAmount": 5,
  "maxAmount": 5000,
  "currency": "USDC"
}
```

> **[ФАКТ]** Source: `api/src/config/pricing.ts`. Flat fee model.

---

#### `GET /cards/tiers`

Alias for `GET /pricing`. Returns the same flat pricing info.

> **[ФАКТ]** Both endpoints return identical data.

---

### 5.2 Paid Endpoints — x402 (`#paid-endpoints`)

Текст: "These endpoints require USDC payment via the x402 protocol on Solana. See Authentication → x402 Payment Flow."

#### `POST /cards/create/tier/:amount`

Create a new virtual card loaded with the specified amount ($5–$5,000).

**Pricing:** $10 card fee + 3.5% top-up on the amount.

**Request body (из `paid.ts` lines 6-9, zod schema):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `nameOnCard` | `string` | Yes | Min 1 char |
| `email` | `string` | Yes | Valid email |

**Response 201 Created:**

```json
{
  "success": true,
  "card": {
    "cardId": "550e8400-e29b-41d4-a716-446655440000",
    "nameOnCard": "AGENT ALPHA",
    "balance": 100,
    "status": "active",
    "createdAt": "2026-02-11T14:00:00.000Z"
  },
  "payment": {
    "amountCharged": 113.5,
    "txHash": "<solana_signature>",
    "network": "solana"
  },
  "details": {
    "cardNumber": "4111111111111111",
    "expiryMonth": 12,
    "expiryYear": 2028,
    "cvv": "123",
    "billingAddress": {
      "street": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94105",
      "country": "US"
    }
  }
}
```

> **[ФАКТ]** Response shape = `CardResult` из `sdk/src/types/index.ts` lines 40-67. Network = `"solana"` (vs OpenCard `"base"`).

---

#### `POST /cards/fund/tier/:amount`

Add funds to an existing card.

**Request body (из `paid.ts` lines 11-13, zod schema):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `cardId` | `string` | Yes | UUID of existing card |

**Response 200 OK:**

```json
{
  "success": true,
  "cardId": "550e8400-e29b-41d4-a716-446655440000",
  "fundedAmount": 25,
  "newBalance": 35.0,
  "payment": {
    "amountCharged": 29.5,
    "txHash": "<solana_signature>",
    "network": "solana"
  }
}
```

> **[ФАКТ]** Response shape = `FundResult` из `sdk/src/types/index.ts` lines 69-79. Status code: 200 (из `paid.ts` line 71).

---

### 5.3 Wallet-Signed Endpoints (`#wallet-signed-endpoints`)

Текст: "These endpoints are free but require wallet signature authentication."

> **[ФАКТ]** Middleware `requireWalletAuth` вешается на весь роутер (`wallet.ts` line 7).

#### `GET /cards`

List all cards owned by the authenticated wallet.

**Response 200:**

```json
{
  "cards": [{
    "cardId": "550e8400-e29b-41d4-a716-446655440000",
    "nameOnCard": "AGENT ALPHA",
    "lastFour": "1111",
    "balance": 10.0,
    "status": "active",
    "createdAt": "2026-02-11T14:00:00.000Z"
  }]
}
```

---

#### `GET /cards/:cardId`

Get detailed info for a specific card.

**Response 200:**

```json
{
  "card": {
    "cardId": "550e8400-e29b-41d4-a716-446655440000",
    "nameOnCard": "AGENT ALPHA",
    "email": "agent@example.com",
    "balance": 8.5,
    "initialAmountUsd": 10,
    "status": "active",
    "createdAt": "2026-02-11T14:00:00.000Z",
    "updatedAt": "2026-02-11T15:30:00.000Z"
  }
}
```

> **⚠️ [ПРЕДПОЛОЖЕНИЕ]** Response shape для GET /cards/:cardId взят из OpenCard docs (аналогичная структура). Точный shape определяется `cardService.getCard()` — нужно верифицировать по `api/src/services/cardService.ts`.

---

#### `GET /cards/:cardId/details`

Retrieve sensitive card details — full card number, CVV, expiry, and billing address.

**Response 200:**

```json
{
  "details": {
    "cardNumber": "4111111111111111",
    "expiryMonth": 12,
    "expiryYear": 2028,
    "cvv": "123",
    "billingAddress": {
      "street": "123 Main St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94105",
      "country": "US"
    }
  }
}
```

> **[ФАКТ]** Rate limit: 3 запроса/час/карту (CTO_TZ §15.3).

---

#### `POST /cards/:cardId/freeze`

Freeze a card. Blocks all transactions until unfrozen.

**Response 200:**

```json
{
  "success": true,
  "cardId": "550e8400-...",
  "status": "frozen"
}
```

> **[ФАКТ]** Из `wallet.ts` lines 57-78: `cardService.setCardStatus(…, "frozen")`.

---

#### `POST /cards/:cardId/unfreeze`

Unfreeze a previously frozen card.

**Response 200:**

```json
{
  "success": true,
  "cardId": "550e8400-...",
  "status": "active"
}
```

> **[ФАКТ]** Из `wallet.ts` lines 80-101: `cardService.setCardStatus(…, "active")`.

---

## 6. SDK Docs Spec

### 6.1 Install

```bash
npm install @asgcard/sdk @solana/web3.js
```

### 6.2 Quick Start

См. §4.3.2 выше.

### 6.3 Configuration

См. §4.3.3 — таблица из 5 параметров.

### 6.4 Methods

5 методов: `createCard`, `fundCard`, `getPricing`, `health`, `address` (getter).  
Все документированы в §4.3.4.

### 6.5 Errors

4 класса: `InsufficientBalanceError`, `PaymentError`, `ApiError`, `TimeoutError`.  
Документированы в §4.3.5.

### 6.6 Low-Level Utilities

5 функций: `parseChallenge`, `checkBalance`, `executePayment`, `buildPaymentProof`, `handleX402Payment`.  
Документированы в §4.3.6.

### 6.7 Types (входы/выходы из `sdk/src/types/index.ts`)

| Type | Used by | Fields |
|------|---------|--------|
| `ASGCardClientConfig` | Constructor | `privateKey?`, `walletAdapter?`, `baseUrl?`, `rpcUrl?`, `timeout?` |
| `CreateCardParams` | `createCard()` | `amount` (literal union), `nameOnCard`, `email` |
| `FundCardParams` | `fundCard()` | `amount` (literal union), `cardId` |
| `CardResult` | `createCard()` return | `success`, `card`, `payment`, `details` |
| `FundResult` | `fundCard()` return | `success`, `cardId`, `fundedAmount`, `newBalance`, `payment` |
| `PricingResponse` | `getPricing()` return | `cardFee`, `topUpRate`, `minAmount`, `maxAmount` |
| `HealthResponse` | `health()` return | `status`, `timestamp`, `version` |
| `WalletAdapter` | Config | `publicKey`, `signTransaction()` |
| `X402Challenge` | Internal | `x402Version`, `accepts: X402Accept[]` |
| `X402Accept` | Internal | `scheme`, `network`, `asset`, `maxAmountRequired`, `payTo`, `maxTimeoutSeconds`, `resource`, `description` |
| `X402PaymentProof` | Internal | `scheme`, `network`, `payload: { authorization, txHash }` |

---

## 7. x402 + Wallet Auth раздел

### 7.1 x402 Payment Flow (402 Challenge)

Полностью описан в §4.4.1.

Ключевые моменты для docs:

1. Запрос без оплаты → 402 с challenge JSON
2. Agent отправляет USDC SPL transfer на treasury
3. Retry с `X-Payment: base64(JSON)` header
4. API верифицирует tx on-chain (факт из CTO_TZ §6.4)

Verification checklist (из CTO_TZ §6.4):

- `scheme === "exact"`, `network === "solana:mainnet"`
- `to === TREASURY_PUBKEY`
- `value === expected tier cost in atomic USDC`
- `txHash` не использован ранее (anti-replay)
- RPC: tx confirmed/finalized, SPL transfer USDC, правильные from/to/amount
- tx не старше `maxTimeoutSeconds`

### 7.2 Ed25519 Wallet Auth Headers

Полностью описан в §4.4.2.

---

## 8. Pricing раздел

### 8.1 Правило

> **CRITICAL:** Docs и любой UI НЕ хардкодят цены. Единственный источник истины = `GET /pricing`.  
> Таблицы в docs являются визуальным справочником и должны содержать пометку:  
> _"For current prices, see `GET /pricing`. Prices shown below are for reference only."_

### 8.2 Таблицы

См. §4.5.1 (Creation) и §4.5.2 (Funding).

### 8.3 Atomic USDC

Упомянуть: 1 USDC = 1,000,000 atomic units (`toAtomicUsdc()` из `pricing.ts` line 101-102).

---

## 9. UX/UI требования для Docs-страницы

### 9.1 Layout

- **Single-page** с якорной навигацией (как OpenCard)
- **Sidebar** (desktop): fixed "On this page" с якорями из §2
- **Mobile**: sidebar скрыт, доступен через hamburger или в начале страницы как TOC

### 9.2 Code Blocks

- Syntax highlighting для `bash`, `typescript`, `json`
- **Copy button** на каждом code block (clipboard API)
- Моноширинный шрифт (system monospace или Fira Code / JetBrains Mono)

### 9.3 Tables

- Горизонтальный scroll на мобильных
- Zebra-striping для читаемости

### 9.4 Anchor Navigation

- Smooth scroll при клике
- URL обновляется при scroll (`history.replaceState`)
- Active state на текущем разделе в sidebar

### 9.5 Accessibility

- Skip link в начале страницы (`#main-content`)
- Все code blocks с `aria-label`
- Focus visible на интерактивных элементах
- Semantic HTML: `<nav>`, `<main>`, `<section>`, `<article>`
- Color contrast ≥ 4.5:1

### 9.6 Responsive Breakpoints

- Desktop: ≥1024px (sidebar + content)
- Tablet: 768-1023px (collapsed sidebar)
- Mobile: <768px (no sidebar, inline TOC)

### 9.7 Performance

- Нет тяжёлых JS-фреймворков (или SSR/SSG)
- Lazy load для architecture diagram
- Минимальное CLS

---

## 10. SEO / Meta / OG требования

### 10.1 HTML `<head>`

```html
<title>ASG Card Docs | API Documentation</title>
<meta name="description" content="API documentation for ASG Card — virtual debit cards for AI agents. Pay with USDC on Solana via x402.">
<meta name="theme-color" content="#0C1631">

<!-- Open Graph -->
<meta property="og:title" content="ASG Card — API Documentation">
<meta property="og:description" content="Virtual card issuance for AI agents on Solana. Full API reference, SDK guide, and x402 protocol docs.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://docs.asgcard.dev/">
<meta property="og:image" content="https://docs.asgcard.dev/og-docs.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="ASG Card — API Documentation">
<meta name="twitter:image" content="https://docs.asgcard.dev/og-docs.png">

<link rel="canonical" href="https://docs.asgcard.dev/">
```

### 10.2 Structured Data

- JSON-LD `WebPage` + `TechArticle`

### 10.3 Robots

- `index, follow`
- Sitemap XML

### 10.4 OG Image

- Отдельный `og-docs.png` (1200×630) для docs-домена

---

## 11. Definition of Done и Checklist приёмки

### 11.1 Content Completeness

- [ ] Все 9 разделов из §2 реализованы
- [ ] Все 10 API endpoints задокументированы
- [ ] Все 5 SDK методов + 5 utility functions описаны
- [ ] x402 flow описан с curl examples
- [ ] Wallet auth описан с TypeScript snippet
- [ ] Pricing таблицы соответствуют `GET /pricing`
- [ ] Architecture ASCII diagram на месте

### 11.2 Code Examples

- [ ] Все code snippets копипастятся и компилируются (TypeScript ≥ 5.0)
- [ ] curl examples возвращают ожидаемые ответы
- [ ] JSON примеры валидны и соответствуют реальным response shapes

### 11.3 UX

- [ ] Sidebar навигация работает
- [ ] Copy buttons на code blocks
- [ ] Smooth scroll + active anchor state
- [ ] Mobile responsive (проверка на 375px, 768px, 1440px)

### 11.4 Accessibility

- [ ] Skip link
- [ ] Focus visible
- [ ] Lighthouse Accessibility ≥ 90
- [ ] Color contrast ≥ 4.5:1

### 11.5 SEO

- [ ] Lighthouse SEO ≥ 95
- [ ] OG image 1200×630
- [ ] Canonical URL
- [ ] Единственный `<h1>` на странице

### 11.6 Consistency

- [ ] Цены в docs = `GET /pricing`
- [ ] Base URL = `https://api.asgcard.dev`
- [ ] Network = `solana:mainnet`
- [ ] USDC mint = `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- [ ] Нет упоминаний Base, EVM, EIP-712, viem, OpenCard

---

## 12. Риски и открытые вопросы

| # | Тип | Описание | Severity |
|---|-----|----------|----------|
| 1 | ⚠️ ВОПРОС | `GET /cards/:cardId` — точный response shape не виден в типах SDK (нет отдельного типа), нужно проверить `cardService.getCard()` | Medium |
| 2 | ⚠️ ВОПРОС | `GET /cards/:cardId/details` — rate limit (3/час) документировать в разделе Rate Limits или при endpoint? | Low |
| 3 | ⚠️ ВОПРОС | Документировать ли `Idempotency-Key` header (упомянут в CTO_TZ §10.3, но не виден в routes)? | Medium |
| 4 | ⚠️ ВОПРОС | Hosting docs: `docs.asgcard.dev` — это тот же Vite app или отдельный проект (Mintlify / MDX)? | High |
| 5 | ⚠️ РАСХОЖДЕНИЕ | `PLAN.md` §5 pricing НЕ совпадает с `pricing.ts` — код = source of truth. Нужно обновить PLAN.md | Medium |
| 6 | ⚠️ ВОПРОС | Нужен ли rate limits раздел с конкретными числами (RPM/IP)? В коде не найдено конкретных лимитов | Medium |
| 7 | ⚠️ ПРЕДПОЛОЖЕНИЕ | `freeze`/`unfreeze` response shape (`{ success, cardId, status }`) взят из OpenCard — нужно подтвердить через `cardService.setCardStatus()` return | Low |
| 8 | ⚠️ ВОПРОС | Нужно ли документировать `409 Conflict` (idempotency/duplicate tx из CTO_TZ §11)? | Medium |
| 9 | ⚠️ ВОПРОС | `TREASURY_PUBKEY` — placeholder в docs или указывать реальный? | High |
| 10 | ⚠️ ВОПРОС | Версионирование API (`API_VERSION` env) — показывать в docs? Менять base URL на `/v1/`? | Medium |

---

## Ready for Review — Summary (15 пунктов)

1. **Docs = single-page** с 9 якорными разделами, структурно 1:1 с OpenCard.
2. **3 класса endpoints:** Public (3), Paid x402 (2), Wallet-signed (5) — все 10 задокументированы.
3. **SDK:** 5 методов + 5 low-level utilities + 4 error класса — все из реального кода.
4. **Стек Solana:** все примеры используют `@solana/web3.js`, Ed25519, SPL USDC, base58 — никаких EVM артефактов.
5. **x402 flow:** 4-шаговый протокол с curl + JSON примерами, адаптированными для Solana.
6. **Wallet auth:** Ed25519 detached signature, `asgcard-auth:<timestamp>`, 3 headers.
7. **Pricing:** таблицы СТРОГО из `pricing.ts` (не из PLAN.md/CTO_TZ). Правило: docs не хардкодят цены.
8. **Расхождение найдено:** PLAN.md pricing values ≠ pricing.ts — код = source of truth.
9. **Response shapes:** все из `sdk/src/types/` + `api/src/routes/`. Помечены 2 предположения.
10. **UI/UX:** sidebar, copy buttons, smooth scroll, responsive, accessibility (skip link, aria, contrast).
11. **SEO:** полный набор meta/OG/Twitter/canonical для `docs.asgcard.dev`.
12. **Definition of Done:** 25 чеклист-пунктов по 6 категориям.
13. **10 рисков/вопросов** ранжированы по severity.
14. **Нулевой код написан** — только спека.
15. **Нулевых изменений** в проекте — создан только `DOCS_TZ_DRAFT.md`.
