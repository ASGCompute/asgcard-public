# ASG Card Web — Задание CTO на улучшение (сравнение с OpenCard)

Дата: 2026-02-19  
Референс: https://opencard.dev  
Аудируемый код: `/Users/innocode/Desktop/Test/ASGcard/web/src/main.ts`, `/Users/innocode/Desktop/Test/ASGcard/web/src/style.css`, `/Users/innocode/Desktop/Test/ASGcard/web/index.html`

## 1. Цель

Привести текущий сайт ASG Card к качеству и конверсионной логике OpenCard, сохранив бренд ASG и Solana-позиционирование, но устранив недостоверные/несогласованные технические формулировки.

## 2. Критичные разрывы (P0)

1. `web/src/main.ts:88`  
Проблема: неверный endpoint в hero-терминале (`/cards/create/50`).  
Нужно: заменить на `POST /cards/create/tier/50`.

2. `web/src/main.ts:169`  
Проблема: неверный endpoint в step card (`POST /cards/create`).  
Нужно: `POST /cards/create/tier/:amount`.

3. `web/src/main.ts:247` + `web/src/main.ts:252`  
Проблема: математическая несогласованность pricing (top-up + total не бьются).  
Нужно: синхронизировать с backend `GET /pricing`.

4. `web/src/main.ts:262` + `web/src/main.ts:285` + `web/src/main.ts:295`  
Проблема: funding pricing конфликтует внутри одной карточки (`4.2% + $2`, но расчёт от `2.2%`).  
Нужно: единая модель комиссий, источник истины — API.

5. `web/src/main.ts:63`  
Проблема: claim `No KYC required` юридически рискованный без утверждённого compliance policy и провайдера.  
Нужно: заменить на нейтральный/legal-safe copy до финального legal sign-off.

6. `web/src/main.ts:356-376`  
Проблема: фейковый connect wallet (показывается EVM `0x...`, while Solana base58).  
Нужно: убрать мок и заменить на один из вариантов:
- реальная Solana wallet integration
- или удалить кнопку, оставить CTA в docs.

## 3. High Priority (P1)

1. Информационная архитектура лендинга (паритет с OpenCard)
- добавить/выделить: trust bar, четкий 4-step flow, metrics row, финальный CTA block.
- выровнять порядок секций для конверсии: Hero -> Proof/Features -> How It Works -> Pricing -> CTA.

2. Текстовая консистентность
- все route/flow тексты должны совпадать с API contract.
- все ссылки docs вести на актуальный URL и существующие якоря.

3. Доступность и UX
- добавить `Skip to content`.
- проверить контраст текста (`text-gray-400` на тёмном фоне местами на грани).
- добавить заметные focus states для клавиатурной навигации.
- добавить aria-label там, где иконка без текста.

4. SEO/Meta
- проверить canonical URL.
- заменить `vite.svg` favicon на брендовый.
- убедиться, что OG/Twitter image реально существует.

## 4. Medium Priority (P2)

1. Технический долг фронта
- уйти от giant template string в `main.ts` к компонентной структуре.
- выделить контент в отдельные data-объекты/JSON для синхронизации с docs/API.

2. Анимации
- сократить декоративные анимации, которые не усиливают UX.
- сохранить только meaningful motion (hero reveal, section reveal, CTA emphasis).

3. Тема/стиль
- если цель 1:1 с OpenCard по конверсии, проверить светлую версию как primary A/B ветку.

## 5. Обязательные acceptance criteria

1. Все цены и формулы на сайте совпадают с `GET /pricing` (автоматическая проверка снапшотом JSON -> UI).
2. Все endpoint-строки на сайте соответствуют реальным API routes.
3. Нет фейковых технических состояний (мок-коннект кошелька) в production UI.
4. Lighthouse targets:
- Performance >= 90
- Accessibility >= 95
- Best Practices >= 95
- SEO >= 95
5. Мобильная версия (375px) не имеет горизонтального скролла и clipping.

## 6. План выполнения CTO (1 спринт)

День 1:
- исправить P0-корректность (routes/pricing/copy/legal-safe)
- убрать mock wallet

День 2:
- переделать секции и порядок под conversion narrative
- accessibility pass

День 3:
- SEO/meta/favicon/OG cleanup
- Lighthouse optimization

День 4:
- визуальный QA + mobile QA + кроссбраузер
- handoff на review

## 7. Что передать на ревью

1. PR + changelog по каждому пункту P0/P1/P2.
2. Скриншоты до/после desktop + mobile.
3. Отчёт Lighthouse.
4. Сверка `UI pricing` vs `GET /pricing` (файл-артефакт).
