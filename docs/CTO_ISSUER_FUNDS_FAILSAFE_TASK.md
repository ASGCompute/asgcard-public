# ASG Card — CTO Task: Issuer Funds Failsafe + Public Docs Correction

Статус: `P0`  
Дата: `2026-03-17`  
Owner: `CTO`  
Причина: customer-facing incident on paid create flow

## 1. Контекст

На `2026-03-17` подтверждено следующее:

1. `API` и `x402` path живы, но create/fund flow может брать payment до реального issuer fulfillment.
2. Реальный customer case: `POST /cards/create/tier/500` завершился `502 Card issuance failed: 4payments says Insufficient funds`.
3. Live 4payments account balance на момент проверки был недостаточен для выпуска карты с initial load `$500`.
4. Текущий код сначала делает `verify + settle`, записывает payment как `settled`, и только потом вызывает issuer `issueCard`.
5. Автоматического refund/rollback path после issuer-side `502` в текущем коде нет.
6. Public-facing wording сейчас недостаточно чётко разделяет:
- merchant refunds to the card
- ASG operational refund policy on failed create/fund
- USD card vs US-issued card wording

Это `P0`, потому что customer может получить платный failure path.

## 2. Цель

Исправить paid flow так, чтобы ASG Card не принимал payment, если 4payments не может профинансировать requested create/fund tier, и синхронно поправить public docs/copy, не трогая ничего вне этого инцидента.

## 3. Разрешённый Scope

Менять только следующие файлы:

- `/Users/innocode/Desktop/Test/ASGcard/api/src/middleware/x402.ts`
- `/Users/innocode/Desktop/Test/ASGcard/api/src/services/fourPaymentsClient.ts`
- `/Users/innocode/Desktop/Test/ASGcard/api/src/services/metrics.ts`
- `/Users/innocode/Desktop/Test/ASGcard/api/__tests__/x402-challenge.test.ts`
- `/Users/innocode/Desktop/Test/ASGcard/web/src/docs.ts`
- `/Users/innocode/Desktop/Test/ASGcard/web/public/docs.md`

Допустимо добавить один новый узкий unit/integration test file в `api/__tests__/`, если без этого критерии не покрываются.

## 4. Запрещено

Не менять:

- pricing model и tier math
- x402 protocol contract, кроме fail-safe gate до `402`
- wallet auth flow
- webhook flow
- DB schema / migrations
- card details model
- frontend visual design вне docs wording
- любые refactor/cleanup без прямой связи с инцидентом

Нельзя:

- трогать unrelated files
- переименовывать endpoints
- менять env schema без крайней необходимости
- деплоить что-либо кроме точечного fix и public docs correction

## 5. Что нужно сделать

### A. Add issuer-capacity precheck before `402`

Для `POST /cards/create/tier/:amount` и `POST /cards/fund/tier/:amount`:

1. До выдачи `402 Payment Required` сделать lightweight precheck against 4payments available balance.
2. Для `create` сравнивать issuer available balance с requested load amount.
3. Для `fund` сравнивать issuer available balance с requested top-up amount.
4. Если available balance меньше requested amount:
- вернуть `503 Service temporarily unavailable`
- не выдавать `402`
- не принимать payment
- body должен ясно объяснять, что service временно недоступен для этого tier
5. Если balance check к 4payments завершился timeout / network error / non-200:
- fail closed
- вернуть `503`
- не выдавать `402`

### B. Add observability for this failure class

Добавить отдельные metric/log events для:

- `issuer_balance_check_failed`
- `issuer_insufficient_funds`

Минимум в metadata:

- `purpose=create|fund`
- `tierAmount`
- `availableBalance` если удалось получить
- `requiredAmount`

## 6. Public Docs Correction

В public docs исправить только следующие смысловые вещи:

1. Не обещать и не подразумевать, что карта является `US-issued`, если это не подтверждено provider contract.
2. Формулировать карту как `USD MasterCard` без лишнего claim.
3. Явно разделить:
- merchant refunds to the card are supported
- failed ASG create/fund cases are handled operationally, not as self-serve refunds
4. Не менять pricing values.
5. Не менять docs structure шире необходимого для этого fix.

## 7. Acceptance Criteria

Работа считается принятой только если выполнено всё ниже:

1. При issuer balance ниже requested amount:
- `POST /cards/create/tier/500` возвращает `503`
- `POST /cards/fund/tier/500` возвращает `503`
- `402` challenge не выдаётся

2. При temporary issuer check failure:
- create/fund route возвращает `503`
- request не доходит до payment acceptance path

3. При достаточном issuer balance:
- текущее happy-path поведение не ломается
- challenge по-прежнему возвращается как `402`
- tier math и `accepts.amount` остаются прежними

4. Public docs после деплоя:
- не содержат claim про `US-issued card`
- содержат корректную refund wording
- не ломают anchors и existing docs navigation

5. Никаких DB migrations.

6. Никаких изменений вне scope files.

## 8. Test Requirements

Обязательно добавить/обновить automated tests на:

1. `issuer balance sufficient` -> стандартный `402` challenge остаётся прежним
2. `issuer balance insufficient` -> route returns `503`, no challenge
3. `issuer balance check failure` -> route returns `503`, no challenge

Если для этого нужен mock/stub 4payments client, сделать это минимально, без перестройки архитектуры.

## 9. Deployment Rules

1. Сначала локально:

```bash
cd /Users/innocode/Desktop/Test/ASGcard
npm run -w @asgcard/api test -- x402-challenge
```

2. Затем общий smoke:

```bash
cd /Users/innocode/Desktop/Test/ASGcard
npm run -w @asgcard/api test
```

3. Затем только targeted production deploy API + public docs.

4. После deploy приложить proof:

- prod URL
- конкретный `503` example for blocked tier
- конкретный `402` example for allowed tier
- список изменённых файлов

## 10. CTO Report Format

В отчёте после выполнения прислать только:

1. список изменённых файлов
2. что именно было изменено по каждому файлу, по 1 строке
3. test results
4. prod verification evidence
5. confirmation: `ничего вне scope не менялось`

## 11. Source Evidence

Кодовые места, на которые опирается задача:

- payment settles before issuer call: `/Users/innocode/Desktop/Test/ASGcard/api/src/middleware/x402.ts`, `/Users/innocode/Desktop/Test/ASGcard/api/src/services/paymentService.ts`
- issuer issue/topup happens after payment context: `/Users/innocode/Desktop/Test/ASGcard/api/src/services/cardService.ts`
- pricing truth source: `/Users/innocode/Desktop/Test/ASGcard/api/src/config/pricing.ts`

## 12. Definition of Done

Done только если:

1. customer cannot enter paid failure path caused by insufficient issuer funds
2. public wording is corrected
3. deploy is live
4. no unrelated regressions introduced
