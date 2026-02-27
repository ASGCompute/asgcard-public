# ASG Card — Web & Docs Rebrand Task (Founder Priority)

Статус: `P0`  
Цель: вывести сайт и документацию на визуальный уровень `Vercel / Apple / Solana / Redot` без шаблонного “AI-generated” вида.

## 1. Контекст

Сейчас функционально всё работает, но визуально не хватает editorial/premium уровня:
- слишком “генерик” атмосфера
- недостаточно строгая типографика и сетка
- архитектурные блоки выглядят технически, но не продуктово

Нужно сделать полноценный rebrand интерфейса в коде (не макет), сохранив текущий контент-контракт API/SDK.

## 2. Scope

Изменяем:
- `/Users/innocode/Desktop/Test/ASGcard/web/src/main.ts`
- `/Users/innocode/Desktop/Test/ASGcard/web/src/style.css`
- `/Users/innocode/Desktop/Test/ASGcard/web/src/docs.ts`
- `/Users/innocode/Desktop/Test/ASGcard/web/src/docs.css`
- `/Users/innocode/Desktop/Test/ASGcard/web/index.html`
- `/Users/innocode/Desktop/Test/ASGcard/web/docs/index.html`
- ассеты в `/Users/innocode/Desktop/Test/ASGcard/web/public/*` по необходимости

Не меняем:
- API контракты, endpoint names, pricing source-of-truth правила
- якоря docs (`#sdk-quick-start` и др.)

## 3. Арт-дирекшн (обязательно)

1. Характер:
- спокойный, технологичный, уверенный
- минимум визуального шума
- контраст и иерархия важнее декоративности

2. Референс-ощущение:
- `Vercel`: ритм, типографика, структурность
- `Apple`: воздух, композиция, дисциплина
- `Solana`: технологичный color-accent
- `Redot`: редакционный тон и “design system feel”

3. Запрещено:
- “случайные” градиенты на каждом блоке
- glassmorphism ради эффекта
- перегруженные неоновые glow
- одинаковые карточки без композиционного смысла

## 4. Визуальная система

1. Типографика:
- чёткая шкала размеров и line-height
- display/heading/body/code стили отделены
- плотный контроль трекинга на заголовках

2. Цвет:
- 1 базовый фон + 1 surface + 1 border palette
- 1 primary accent + 1 secondary accent
- акцент только для CTA и key states

3. Сетка и spacing:
- единая spacing-система (4/8pt)
- стабильные container widths
- консистентные section paddings на landing и docs

4. Компонентность:
- кнопки, табличные ячейки, code blocks, badges, callouts должны быть единым языком

## 5. Landing (asgcard.dev `/`)

1. Hero:
- более взрослый и чистый layout
- меньше декоративных элементов, больше чёткой value hierarchy
- CTA блок в стиле product-grade SaaS

2. Дальше по странице:
- trust bar, features, flow, pricing, final CTA в едином ритме
- таблицы pricing читаемые и “инженерные”, без визуального шума

3. Motion:
- только смысловые анимации
- трансформации и opacity, без `transition: all`
- обязательный `prefers-reduced-motion`

## 6. Docs (asgcard.dev/docs)

1. Общий стиль:
- editorial documentation UI уровня Vercel Docs
- ясная левая навигация + качественное состояние active section

2. Code blocks:
- аккуратный header (`PLAINTEXT`/`JSON`/`TS`)
- контраст, моноширинный ритм, копирование с clear feedback

3. Architecture sections:
- сделать визуально “продуктовыми”, не просто сырой preformatted blob
- допустимо SVG/HTML-diagram внутри code-like container
- четкая композиция, симметрия, читаемость на mobile

4. Таблицы:
- плотные, профессиональные, без лишней декоративности
- одинаковый стиль across docs

## 7. Контракт и контент (жёстко)

1. Pricing:
- источник данных: `GET /pricing`
- никаких hardcoded чисел для production render

2. API/SDK:
- все примеры и поля строго совместимы с текущим `api/src` и `sdk/src`

3. Anchors:
- сохранить существующие id и deep-links

## 8. Quality Gates (обязательно для приемки)

1. Build:
- `npm run -w @asgcard/web build` без ошибок

2. A11y:
- skip link
- focus-visible
- корректные `aria-*` у мобильной навигации

3. Perf:
- без layout thrash в scroll handlers
- без `transition: all`

4. SEO:
- корректные `title/description/canonical/og/twitter`
- OG изображения валидных размеров

5. Responsive QA:
- 375px, 768px, 1440px
- без горизонтального overflow (кроме ожидаемого в code/table wrappers)

## 9. Deployment (после апрува)

1. Прод-деплой:
```bash
cd /Users/innocode/Desktop/Test/ASGcard/web
npx -y vercel deploy --prod -y
```

2. Домен:
- проект: `web` (Vercel)
- целевой домен: `asgcard.dev`
- docs доступны через `https://asgcard.dev/docs`

3. Важно по DNS:
- если домен не резолвится, нужен `A` record:
`asgcard.dev -> 76.76.21.21`

## 10. Формат отчёта исполнителя

1. Список изменённых файлов.
2. Короткое описание дизайн-решений (5-10 пунктов).
3. Скриншоты:
- landing desktop/mobile
- docs desktop/mobile
- architecture блок до/после
4. Вывод `npm run -w @asgcard/web build`.
5. Production URL после деплоя.
