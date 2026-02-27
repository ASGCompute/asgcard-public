# ASG Card — План Реализации

> Аналог [OpenCard.dev](https://opencard.dev) под брендом **ASG Card** на **Solana** (вместо Base).

---

## 1. Что Строим

Платформа мгновенной выдачи виртуальных Visa-карт для AI-агентов. Оплата — USDC на Solana по протоколу x402. **Payment IS Authentication** — никаких API-ключей и регистраций.

| Параметр | OpenCard | ASG Card |
|---|---|---|
| Блокчейн | Base (EVM) | **Solana** |
| Стейблкоин | USDC (ERC-20) | **USDC (SPL)** |
| SDK зависимость | `viem` | **`@solana/web3.js`** |
| Подпись (auth) | EIP-712 | **Ed25519** |
| Base URL | `api.opencard.dev` | **`api.asgcard.dev`** |
| USDC адрес | `0x833589f...` | **`EPjFWdd5Aufq...`** |

---

## 2. Архитектура

```
AI Agent (Solana wallet + USDC)
        │
        ▼
  HTTP Request (no auth)
        │
        ▼
┌──────────────────────────────┐
│       ASG Card API           │
│   (Express + x402-solana)    │
│                              │
│  Paid (x402):                │
│   POST /cards/create/tier/N  │
│   POST /cards/fund/tier/N    │
│                              │
│  Wallet-signed (free):       │
│   GET  /cards                │
│   GET  /cards/:id            │
│   GET  /cards/:id/details    │
│   POST /cards/:id/freeze     │
│   POST /cards/:id/unfreeze   │
│                              │
│  Public:                     │
│   GET /health                │
│   GET /pricing               │
│   GET /cards/tiers           │
└──────────┬───────────────────┘
           │
     ┌─────┴─────┐
     ▼           ▼
  Card      Solana RPC
 Issuing    (tx verify)
Provider
```

---

## 3. x402 Поток на Solana

```
Agent            SDK             API            Solana
  |               |               |               |
  |-- createCard->|               |               |
  |               |-- POST ------>|               |
  |               |<-- 402 -------|               |
  |               |                               |
  |               |-- SPL transfer ------------->|
  |               |<-- signature ----------------|
  |               |                               |
  |               |-- POST + X-Payment ->|        |
  |               |<-- 201 + card -------|        |
  |<-- result ----|               |               |
```

### 402 Response (Solana-адаптированный)

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "solana:mainnet",
    "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "maxAmountRequired": "17200000",
    "payTo": "<ASG_TREASURY_PUBKEY>",
    "maxTimeoutSeconds": 300,
    "resource": "/cards/create/tier/10",
    "description": "Create ASG Card with $10 load"
  }]
}
```

### X-Payment Header (proof)

```json
{
  "scheme": "exact",
  "network": "solana:mainnet",
  "payload": {
    "authorization": {
      "from": "<AGENT_PUBKEY>",
      "to": "<TREASURY_PUBKEY>",
      "value": "17200000"
    },
    "txHash": "<SOLANA_TX_SIGNATURE>"
  }
}
```

---

## 4. Компоненты Проекта

### 4.1 Backend API (`/api`)

- **Express.js** сервер
- x402 middleware адаптированный для Solana
- Верификация SPL-Token транзакций через Solana RPC
- Интеграция с card issuing провайдером
- PostgreSQL/Supabase для хранения карт и транзакций

**Эндпоинты (11 шт.):**

| # | Метод | Путь | Auth | Описание |
|---|---|---|---|---|
| 1 | GET | `/health` | — | Health check |
| 2 | GET | `/pricing` | — | Все тарифы + комиссии |
| 3 | GET | `/cards/tiers` | — | Список тарифов |
| 4 | POST | `/cards/create/tier/:N` | x402 | Создать карту |
| 5 | POST | `/cards/fund/tier/:N` | x402 | Пополнить карту |
| 6 | GET | `/cards` | Wallet | Список карт |
| 7 | GET | `/cards/:id` | Wallet | Детали карты |
| 8 | GET | `/cards/:id/details` | Wallet | Номер/CVV/Срок |
| 9 | POST | `/cards/:id/freeze` | Wallet | Заморозить |
| 10 | POST | `/cards/:id/unfreeze` | Wallet | Разморозить |

### 4.2 SDK (`/sdk` → npm `@asgcard/sdk`)

**Класс `ASGCardClient`:**

```ts
import { ASGCardClient } from '@asgcard/sdk';

const client = new ASGCardClient({
  privateKey: '<base58_solana_key>',
  baseUrl: 'https://api.asgcard.dev',
  rpcUrl: 'https://api.mainnet-beta.solana.com',
});

const card = await client.createCard({
  amount: 50,
  nameOnCard: 'AI AGENT',
  email: 'agent@example.com',
});
```

**Конфигурация:**

| Параметр | Тип | Описание |
|---|---|---|
| `privateKey` | `string` | Base58 Solana private key |
| `walletAdapter` | `WalletAdapter` | Или Solana wallet adapter |
| `baseUrl` | `string` | `https://api.asgcard.dev` |
| `rpcUrl` | `string` | Solana RPC endpoint |
| `timeout` | `number` | Таймаут в мс |

**Методы:**

- `createCard(params)` → `Promise<CardResult>`
- `fundCard(params)` → `Promise<FundResult>`
- `getTiers()` → `Promise<Tier[]>`
- `health()` → `Promise<{ status: string }>`
- `address` → Solana pubkey string

**Error Classes:**

- `InsufficientBalanceError` — недостаточно USDC
- `PaymentError` — ошибка транзакции
- `ApiError` — ошибка сервера
- `TimeoutError` — таймаут

**Low-Level Utilities:**

- `parseChallenge()` — парсинг 402
- `checkBalance()` — проверка USDC баланса
- `executePayment()` — отправка USDC
- `buildPaymentProof()` — сборка X-Payment
- `handleX402Payment()` — полный цикл

### 4.3 Wallet Auth (Ed25519)

```ts
// Подпись для бесплатных эндпоинтов
const message = `asgcard-auth:${timestamp}`;
const signature = nacl.sign.detached(
  Buffer.from(message),
  keypair.secretKey
);

// Заголовки
headers: {
  'X-WALLET-ADDRESS': publicKey.toBase58(),
  'X-WALLET-SIGNATURE': bs58.encode(signature),
  'X-WALLET-TIMESTAMP': String(timestamp),
}
```

### 4.4 Landing Page (`/landing`)

- Hero: "Instant Virtual Cards for Your AI Agent"
- Features: Payment IS Auth, Agent-First, Real Cards
- Flow: 4 шага (Request → Pay → Card → Spend)
- CTA → Documentation

### 4.5 Documentation (`/docs`)

Одностраничная документация:

- SDK (install, quick start, config, methods, errors)
- Authentication (x402 flow, wallet signature)
- Pricing (таблица тарифов)
- Endpoints (все 11 с примерами)
- Errors + Rate Limits
- Architecture diagram

---

## 5. Ценообразование

### Создание карты

| Load | Issuance | TopUp | ASG Fee | **Итого** |
|---|---|---|---|---|
| $10 | $3.00 | $2.20 | $2.00 | **$17.20** |
| $25 | $3.00 | $2.20 | $2.00 | **$32.20** |
| $50 | $3.00 | $2.20 | $2.00 | **$57.20** |
| $100 | $3.00 | $2.20 | $2.00 | **$107.20** |
| $200 | $3.00 | $2.20 | $2.00 | **$207.20** |
| $500 | $3.00 | $2.20 | $2.00 | **$507.20** |

### Пополнение (без issuance fee)

| Сумма | TopUp | ASG Fee | **Итого** |
|---|---|---|---|
| $10 | $2.20 | $2.00 | **$14.20** |
| $25 | $2.20 | $2.00 | **$29.20** |

---

## 6. Ответы API — Схемы

### POST /cards/create/tier/50 → 201

```json
{
  "success": true,
  "card": {
    "cardId": "uuid",
    "nameOnCard": "AI AGENT",
    "balance": 50,
    "status": "active",
    "createdAt": "2026-02-11T14:00:00.000Z"
  },
  "payment": {
    "amountCharged": 57.2,
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

### GET /cards → 200

```json
{
  "cards": [{
    "cardId": "uuid",
    "nameOnCard": "AI AGENT",
    "lastFour": "1111",
    "balance": 50.0,
    "status": "active",
    "createdAt": "2026-02-11T14:00:00.000Z"
  }]
}
```

### Errors

```json
{ "error": "Human-readable error message" }
```

| Код | Описание |
|---|---|
| 400 | Bad Request |
| 401 | Invalid signature |
| 402 | Payment Required (x402) |
| 404 | Not Found |
| 429 | Rate Limited |
| 500 | Internal Error |

---

## 7. Технический Стек

| Слой | Технология |
|---|---|
| Backend | Node.js + Express |
| DB | Supabase (PostgreSQL) |
| Blockchain | Solana (`@solana/web3.js`, `@solana/spl-token`) |
| SDK | TypeScript NPM-пакет |
| Landing | Next.js / Vite |
| Docs | Mintlify / MDX |
| Card Provider | TBD (stripe issuing / marqeta / etc.) |

---

## 8. Порядок Реализации

### Фаза 1 — Foundation

- [ ] Инициализация монорепо
- [ ] Настройка Supabase (таблицы: cards, transactions, wallets)
- [ ] Backend скелет (Express, routes, middleware)

### Фаза 2 — x402 на Solana

- [ ] x402 middleware (402 response, payment verification)
- [ ] Solana tx верификация (SPL Token transfer check)
- [ ] Treasury wallet setup

### Фаза 3 — Card Issuing

- [ ] Интеграция с card provider
- [ ] Create card flow
- [ ] Fund card flow

### Фаза 4 — Wallet Auth

- [ ] Ed25519 signature verification middleware
- [ ] Card management endpoints (list, details, freeze/unfreeze)

### Фаза 5 — SDK

- [ ] `ASGCardClient` class
- [ ] x402 auto-handling
- [ ] Error classes
- [ ] Low-level utilities
- [ ] NPM publish setup

### Фаза 6 — Frontend

- [ ] Landing page (1-в-1 как OpenCard)
- [ ] Documentation page
- [ ] Responsive design

### Фаза 7 — Polish

- [ ] Rate limiting
- [ ] Logging & monitoring
- [ ] Tests
- [ ] CI/CD
