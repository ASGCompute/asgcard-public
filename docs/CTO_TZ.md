# ASG Card — Полное ТЗ для CTO (v1)

Дата: 2026-02-19  
Роль документа: рабочее ТЗ на реализацию продукта `ASG Card` (исполнитель: CTO, контроль/ревью: AI coordinator)

## 1. Контекст и цель

ASG Card — Solana-адаптация модели OpenCard: выпуск и пополнение виртуальных карт для AI-агентов с оплатой в USDC через x402.  
Ключевой принцип: **Payment is Authentication**.

Цель v1:
1. Дать агентам production-ready API и SDK для `create/fund/manage` карт.
2. Обеспечить безопасную и проверяемую x402-оплату в Solana.
3. Запустить лендинг+доки с 1:1 структурной логикой OpenCard (бренд ASG, сеть Solana).

## 2. Ролевая модель исполнения

- Founder: продуктовые решения, go/no-go, коммерческие приоритеты.
- CTO: полная реализация архитектуры, кода, инфраструктуры, релизов.
- AI coordinator/reviewer: контроль качества, ревью PR, валидация соответствия ТЗ, риск-контроль.

## 3. Scope v1 (обязательный)

### 3.1 API (10 endpoints)

Public:
1. `GET /health`
2. `GET /pricing`
3. `GET /cards/tiers`

Paid (x402):
4. `POST /cards/create/tier/:amount`
5. `POST /cards/fund/tier/:amount`

Wallet-signed:
6. `GET /cards`
7. `GET /cards/:cardId`
8. `GET /cards/:cardId/details`
9. `POST /cards/:cardId/freeze`
10. `POST /cards/:cardId/unfreeze`

### 3.2 SDK (`@asgcard/sdk`)

Обязательные surface-методы:
- `createCard(params)`
- `fundCard(params)`
- `getTiers()`
- `health()`
- `address`

Обязательные ошибки:
- `InsufficientBalanceError`
- `PaymentError`
- `ApiError`
- `TimeoutError`

Обязательные low-level exports:
- `parseChallenge`
- `checkBalance`
- `executePayment`
- `buildPaymentProof`
- `handleX402Payment`

### 3.3 Web

- Лендинг и docs по структуре OpenCard, но под `ASG Card` и Solana.
- Полная консистентность текстов, маршрутов, цен, API-примеров с backend contract.

## 4. Non-Goals v1

1. Мобильные нативные приложения.
2. Мультичейн (кроме Solana mainnet).
3. Многоязычность интерфейса.
4. Сложная RBAC-панель администратора.

## 5. Архитектура

## 5.1 Компоненты

1. `api` (Node.js + Express + TypeScript):
- x402 challenge/proof flow
- верификация платежей через Solana RPC
- wallet auth middleware (Ed25519)
- card provider adapter
- rate limit + idempotency + audit logs

2. `db` (Supabase/PostgreSQL):
- карточные и платежные данные
- ownership mapping wallet -> cards
- журнал транзакций и статусов

3. `sdk` (TypeScript package)
- авто-handshake для 402
- транспорт и retry/timeout
- нормализованная обработка ошибок

4. `web` (Vite/TS/Tailwind или Next.js)
- маркетинговый лендинг
- docs-страница(ы)

## 5.2 Среды

- `local`
- `staging`
- `production`

Обязательные переменные:
- `PORT`
- `API_VERSION`
- `SOLANA_NETWORK`
- `SOLANA_RPC_URL`
- `USDC_MINT`
- `TREASURY_PUBKEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CARD_PROVIDER_*`
- `ENCRYPTION_KEY` (для чувствительных card details)

## 6. x402-Solana протокол (контракт)

## 6.1 402 challenge response

```json
{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "solana:mainnet",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "maxAmountRequired": "17200000",
      "payTo": "<TREASURY_PUBKEY>",
      "maxTimeoutSeconds": 300,
      "resource": "/cards/create/tier/10",
      "description": "Create ASG Card with $10 load"
    }
  ]
}
```

## 6.2 X-Payment transport

- Клиент должен отправлять `X-Payment` как **base64(JSON)**.
- API для совместимости принимает:
  - base64 JSON (основной формат)
  - raw JSON (fallback)

## 6.3 X-Payment payload

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

## 6.4 Валидация платежа (обязательная)

1. `scheme === exact`, `network === solana:mainnet`.
2. `to === TREASURY_PUBKEY`.
3. `value === expected tier cost in atomic USDC (6 decimals)`.
4. `txHash` существует и не использован ранее (anti-replay).
5. По RPC подтвердить tx:
- статус `confirmed` или `finalized`
- внутри tx есть SPL-transfer USDC
- mint = `USDC_MINT`
- from = `authorization.from`
- to = treasury associated token account
- amount = `authorization.value`
6. Временное окно: tx не старше `maxTimeoutSeconds` challenge.

## 7. Wallet auth (бесплатные endpoint'ы)

Headers:
- `X-WALLET-ADDRESS`
- `X-WALLET-SIGNATURE`
- `X-WALLET-TIMESTAMP`

Подпись v1:
- message: `asgcard-auth:<unixTimestamp>`
- алгоритм: Ed25519 detached
- окно валидности: ±5 минут

Обязательные защиты:
- отклонение старых timestamp
- rate limit по wallet+IP
- лог аномалий подписи

## 8. Data model (минимум)

### 8.1 `wallets`
- `id` (uuid)
- `address` (unique)
- `created_at`

### 8.2 `cards`
- `id` (uuid)
- `wallet_id` (fk)
- `provider_card_id`
- `name_on_card`
- `email`
- `last_four`
- `balance_usd`
- `initial_amount_usd`
- `status` (`active|frozen|closed`)
- `created_at`, `updated_at`

### 8.3 `card_details_secure`
- `card_id` (fk, unique)
- `ciphertext`
- `key_version`
- `created_at`

### 8.4 `transactions`
- `id` (uuid)
- `card_id` (nullable)
- `wallet_id`
- `kind` (`create|fund`)
- `tier_amount`
- `amount_charged_usd`
- `amount_charged_atomic`
- `network`
- `tx_hash` (unique)
- `status`
- `raw_proof_json`
- `created_at`

### 8.5 `rate_limit_card_details`
- `card_id`
- `bucket_start`
- `count`

## 9. Цены и тарифы (v1 baseline)

Держать синхронно с `GET /pricing` и docs:

Create tiers:
- 10 -> 17.20
- 25 -> 32.50
- 50 -> 58.00
- 100 -> 110.00
- 200 -> 214.00
- 500 -> 522.00

Fund tiers:
- 10 -> 14.20
- 25 -> 29.50
- 50 -> 55.00
- 100 -> 107.00
- 200 -> 211.00
- 500 -> 519.00

## 10. Нефункциональные требования

1. SLA API (staging target): 99.5%.
2. P95 latency:
- public endpoints < 250ms
- wallet endpoints < 400ms
- paid endpoints (без chain wait) < 600ms
3. Идемпотентность для create/fund (header `Idempotency-Key`).
4. Structured logging + request id.
5. Secrets только через environment/secret manager.
6. PII и card data не логировать.

## 11. Error contract

Единый формат:

```json
{ "error": "Human-readable error message" }
```

Коды:
- 400 bad request
- 401 invalid/missing auth
- 402 payment required
- 404 not found
- 409 conflict (idempotency/duplicate tx)
- 429 rate limit
- 500 internal

## 12. Тестирование (Definition of Ready for release)

1. Unit tests:
- pricing math
- challenge/proof parsing
- auth signature checks

2. Integration tests:
- full 402 flow (mock RPC)
- paid endpoint with valid/invalid proof
- wallet auth success/failure

3. E2E tests:
- create card happy path
- fund card happy path
- freeze/unfreeze
- card details rate limit

4. Regression checks:
- all API examples in docs валидны
- SDK quick start исполняется без правок

## 13. CI/CD

Pipeline обязательный:
1. lint
2. typecheck
3. unit+integration tests
4. build artifacts
5. deploy staging
6. smoke tests
7. manual approve -> production

## 14. Roadmap по фазам (детализация)

### Phase 1 — Foundation (1 неделя)
- monorepo
- env config
- API skeleton
- DB migrations
- base docs

Acceptance:
- все 10 routes существуют
- CI green

### Phase 2 — x402 Solana (1-2 недели)
- challenge/proof
- RPC verification
- replay protection

Acceptance:
- оплата реально верифицируется on-chain

### Phase 3 — Card Provider Integration (1-2 недели)
- create/fund mapping
- provider error mapping

Acceptance:
- реальный выпуск и пополнение карт в staging

### Phase 4 — Wallet auth + card management (4-5 дней)
- signatures
- list/details/freeze/unfreeze

Acceptance:
- все wallet endpoints закрыты подписью

### Phase 5 — SDK (1 неделя)
- клиент, ошибки, low-level utils
- typed docs/examples

Acceptance:
- SDK quick start проходит e2e

### Phase 6 — Web & Docs (1 неделя)
- лендинг
- docs parity
- pricing consistency

Acceptance:
- тексты/маршруты/цены совпадают с API

### Phase 7 — Polish & Launch (1 неделя)
- observability
- rate limits
- runbooks
- security hardening

Acceptance:
- launch checklist пройден

## 15. Security checklist (обязательный)

1. Шифрование card details at rest.
2. Никогда не возвращать full PAN/CVV кроме `create` и `details`.
3. `GET /cards/:id/details` ограничение 3/час/карта.
4. Audit trail всех доступов к sensitive endpoints.
5. Threat model по trust boundaries (agent, API, RPC, provider, DB).
6. Dependency scanning + lockfile discipline.

## 16. Принцип ревью и контроля качества

Каждый PR должен включать:
1. Цель и контекст.
2. Список изменённых контрактов (если есть).
3. Тест-доказательство (скриншоты/логи/отчёты).
4. Риски и rollback plan.

AI coordinator/reviewer проверяет:
1. соответствие ТЗ
2. безопасность
3. совместимость API/SDK/docs
4. готовность к merge/release

## 17. Критерии готовности продукта v1 (Go-Live)

1. Все 10 endpoints стабильно работают в production.
2. Оплата Solana USDC верифицируется on-chain.
3. SDK закрывает x402 flow автоматически.
4. Docs соответствуют реальному поведению API.
5. Web-конверсия и CTA работают (analytics events приходят).
6. Incident runbook и on-call handoff готовы.
