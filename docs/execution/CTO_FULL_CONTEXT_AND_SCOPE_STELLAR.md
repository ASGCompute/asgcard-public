# ASG Card — Полный Контекст и Скоуп для CTO (Stellar Pilot)

Last updated: 2026-02-27  
Audience: CTO (первичный onboarding без знаний проекта)  
Owner: Founder + Product Owner (AI cofounder)

## 1. Что строим

ASG Card — инфраструктура виртуальных карт для AI-агентов с on-chain оплатой за API-вызовы.

Бизнес-модель v1:
1. Агент вызывает платный endpoint.
2. API возвращает `402 challenge` (x402).
3. Агент платит USDC в Stellar.
4. Агент повторяет запрос с `X-Payment`.
5. Сервис выпускает/пополняет карту через card issuer.

Цель пилота:
1. Запустить закрытый Stellar pilot (10–30 клиентов).
2. Подтвердить unit economics и надежность флоу create/fund/manage card.
3. После KPI-гейтов масштабировать и готовить Arbitrum/Solana как phase-2 rails.

## 2. Роли и модель работы

1. Founder: продуктовые и коммерческие решения, бюджет, go/no-go.
2. Product Owner (AI cofounder): scope, приоритизация, аудит качества, acceptance.
3. CTO: архитектура и реализация, delivery owner, reliability/security owner.

Правило исполнения: все задачи, статусы, решения и релизы ведутся через GitHub.

## 3. Текущий status продукта

1. Есть сайт и документация: `asgcard.dev`, `asgcard.dev/docs`.
2. Есть API и SDK каркас в репозитории.
3. Исторически в проекте были Solana-файлы/артефакты; текущий пилотный фокус зафиксирован на Stellar.
4. Подготовлен GitHub-ready backlog и скрипт автосоздания issue/milestone/labels.

## 4. Технический контур пилота Stellar

Сервисы (обязательные):
1. `api-gateway`
2. `x402-payment-service`
3. `card-orchestrator`
4. `issuer-adapter-4payments`
5. `webhook-ingestor`
6. `ledger-service`
7. `reconciliation-worker`
8. `risk-limits`
9. `observability-stack`

Интеграции:
1. x402 on Stellar + OpenZeppelin facilitator.
2. 4payments card issuing API и webhooks.
3. PostgreSQL для транзакционной модели и сверок.
4. Secrets manager для ключей и чувствительных данных.

## 5. Архитектурный поток (как должно работать)

1. Клиент вызывает `POST /cards/create/tier/:amount` или `POST /cards/fund/tier/:amount`.
2. Если нет `X-Payment`, API отдает `402 challenge`.
3. Клиент проводит on-chain платеж и отправляет `X-Payment`.
4. `x402-payment-service` делает verify/settle.
5. `card-orchestrator` вызывает `issuer-adapter-4payments`.
6. `ledger-service` связывает `payment proof` + `issuer operation` + `internal transaction`.
7. `webhook-ingestor` принимает issuer события, проверяет HMAC, обновляет статус.
8. `reconciliation-worker` сверяет расхождения и закрывает хвосты.

## 6. API scope v1 (контракт)

Public:
1. `GET /health`
2. `GET /pricing`
3. `GET /cards/tiers`

Paid (x402):
1. `POST /cards/create/tier/:amount`
2. `POST /cards/fund/tier/:amount`

Wallet-signed:
1. `GET /cards`
2. `GET /cards/:cardId`
3. `GET /cards/:cardId/details`
4. `POST /cards/:cardId/freeze`
5. `POST /cards/:cardId/unfreeze`

## 7. Критичные внешние ограничения

4payments:
1. Для issue/topup/withdraw лимит: 1 req/sec.
2. Webhooks подписываются через HMAC SHA256 (`webhook-sign`) по raw body.
3. Для идемпотентности использовать `externalId`.

x402 / Stellar:
1. Платные endpoint’ы должны корректно отдавать 402 challenge.
2. Verify/settle делать через facilitator-контракт (OpenZeppelin relayer plugin).
3. Обязательна replay-защита платежных proof.

## 8. Security baseline (обязательно)

1. PAN/CVV никогда не пишутся в обычные логи.
2. Доступ к sensitive card details лимитируется, аудитируется и алертится.
3. Wallet auth защищен от replay (`timestamp window` + nonce tracking).
4. Все webhook запросы проходят signature verify до бизнес-обработки.
5. Все секреты только из secret store, без hardcode.
6. Branch protection + required checks + security scanning в GitHub.

## 9. KPI-гейты пилота (go/no-go)

1. Card issue success >= 97%.
2. Top-up success >= 99%.
3. p95 create-card latency < 12s.
4. Unresolved reconciliation mismatches < 0.5%.
5. Security incidents по sensitive operations = 0.

## 10. Milestones и сроки

1. `M1 Foundation` — до 2026-03-13.
2. `M2 Payments+Issuer` — до 2026-04-03.
3. `M3 Security+Ops` — до 2026-04-24.
4. `M4 Pilot Launch` — до 2026-05-15.
5. `M5 Stabilization` — до 2026-05-29.

## 11. Скоуп CTO на старт (первые 10 рабочих дней)

День 1-2:
1. Прочитать этот документ, backlog и operating context.
2. Подтвердить high-level архитектуру и разбивку сервисов.
3. Открыть ADR-001 (service boundaries + data ownership).

День 3-5:
1. Закрыть GH-001..GH-005 (GitHub operating foundation).
2. Поднять staging pipeline и required checks.
3. Открыть ADR-002 (x402 verify/settle strategy и failure handling).

День 6-10:
1. Стартовать PLAT-001..PLAT-004.
2. Стартовать PAY-001 и ISS-001.
3. Подготовить demo smoke: health/pricing/tiers + paid endpoint 402 behavior.

## 12. Sprint 01 committed scope для CTO

Обязательные issue:
1. GH-001, GH-002, GH-003, GH-004, GH-005
2. PLAT-001, PLAT-002, PLAT-003, PLAT-004
3. PAY-001, PAY-002
4. ISS-001, ISS-002
5. WH-001, WH-002
6. REC-001

Definition of Done на каждую задачу:
1. PR в protected `main`, минимум 2 approvals.
2. Тесты, lint и security checks green.
3. Документация и runbook обновлены.
4. Метрики/логирование добавлены, где применимо.
5. Acceptance criteria из issue подтверждены в staging.

## 13. Что CTO должен отдать Founder/PO на weekly review

1. Статус milestone и burndown по P0/P1.
2. Список блокеров с конкретным owner и ETA.
3. Риски reliability/security + mitigation план.
4. Демо фактически работающего функционала в staging.
5. Изменения в scope (если есть) с impact на KPI/сроки.

## 14. GitHub execution kit (готово)

Канонический backlog:
- `docs/execution/github/ISSUE_BACKLOG_STELLAR_PILOT.md`

CSV backlog:
- `docs/execution/github/stellar_pilot_issue_backlog.csv`

Скрипт автосоздания issue/milestones/labels:
- `scripts/github/create_stellar_pilot_issues.sh`

Команда запуска:
```bash
bash scripts/github/create_stellar_pilot_issues.sh <owner/repo>
```

## 15. Read order для CTO (30–45 минут)

1. `docs/execution/FOUNDER_CTO_OPERATING_CONTEXT_STELLAR.md`
2. Этот документ
3. `docs/execution/CTO_SCOPE_SPRINT_01_STELLAR.md`
4. `docs/execution/github/ISSUE_BACKLOG_STELLAR_PILOT.md`

## 16. Источники интеграций

1. https://asgcard.dev
2. https://asgcard.dev/docs
3. https://docs.4payments.io/
4. https://developers.stellar.org/docs/build/apps/x402
5. https://developers.stellar.org/docs/tools/openzeppelin-relayer
6. https://mcp.openzeppelin.com/
7. https://github.com/OpenZeppelin/stellar-contracts/tree/main/packages/accounts
8. https://docs.openzeppelin.com/stellar-contracts/accounts/smart-account

