---
name: Astronomican Lighthouse
name-scope: Внутренний КОДНЕЙМ (dev + дизайн-система). НЕ публичное имя — «Astronomican» = термин GW, в стор/маркетинг не идёт. Публичное имя TBD (Muster/Levy). См. §13.5/§14.
theme: dark
status: Тёмная тема — готова (v1). Светлая тема — v1 в design-system-light.md (парная, WCAG AA проверена).
pairs-with: design-system-light.md
note: >
  Это канонический источник дизайн-токенов тёмной темы. Код (RN/Expo + web)
  потребляет эти токены. Полное позиционирование бренда и раскладка UX —
  в дизайн-спеке §9.3.
colors:
  surface: '#051424'
  surface-dim: '#051424'
  surface-bright: '#2c3a4c'
  surface-container-lowest: '#010f1f'
  surface-container-low: '#0d1c2d'
  surface-container: '#122131'
  surface-container-high: '#1c2b3c'
  surface-container-highest: '#273647'
  on-surface: '#d4e4fa'
  on-surface-variant: '#c6c6cd'
  inverse-surface: '#d4e4fa'
  inverse-on-surface: '#233143'
  outline: '#909097'
  outline-variant: '#45464d'
  surface-tint: '#bec6e0'
  primary: '#bec6e0'
  on-primary: '#283044'
  primary-container: '#0f172a'
  on-primary-container: '#798098'
  inverse-primary: '#565e74'
  secondary: '#ffe083'
  on-secondary: '#3c2f00'
  secondary-container: '#eec200'
  on-secondary-container: '#645000'
  tertiary: '#ffb3b6'
  on-tertiary: '#68001a'
  tertiary-container: '#39000a'
  on-tertiary-container: '#f42f54'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#ffe083'
  secondary-fixed-dim: '#eec200'
  on-secondary-fixed: '#231b00'
  on-secondary-fixed-variant: '#574500'
  tertiary-fixed: '#ffdada'
  tertiary-fixed-dim: '#ffb3b6'
  on-tertiary-fixed: '#40000c'
  on-tertiary-fixed-variant: '#920028'
  background: '#051424'
  on-background: '#d4e4fa'
  surface-variant: '#273647'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 48px
    fontWeight: '800'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.2'
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.0'
    letterSpacing: 0.1em
  label-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
---

## Brand & Style
The design system is engineered for a premium tabletop gaming community, balancing the grim-dark intensity of Warhammer 40,000 with the high-fantasy majesty of Age of Sigmar. The brand personality is authoritative yet welcoming, positioning the club as a high-end "sanctuary" for hobbyists.

The visual style is **Minimalist-Atmospheric**. It rejects the cluttered, "fan-site" aesthetic of the early 2000s in favor of a sophisticated, editorial approach. We utilize expansive negative space to let high-fidelity miniature photography breathe. Depth is achieved through subtle textures—atmospheric smoke, grit, or celestial dust—layered behind sharp, clean UI elements. The emotional response should be one of "Tactical Clarity": everything is organized, premium, and focused on the hobby.

## Colors
The palette is rooted in a "Deep Space & Charcoal" foundation to provide a cinematic backdrop for miniature photography.

- **Primary (Abyssal):** A deep, saturated navy-charcoal used for the main canvas and deep UI layers.
- **Secondary (Aurelian Gold):** A vibrant gold representing the Order and Majesty of Age of Sigmar. Used for high-priority CTAs and achievement markers.
- **Tertiary (Crimson Protocol):** A sharp, energetic red representing the grim conflict of the 40th Millennium. Used for alerts, live game indicators, and secondary CTAs.
- **Surface & Neutrals:** Varying shades of slate and cool grey to define container boundaries without introducing harsh white lines.

## Typography
The typographic hierarchy emphasizes structure and legibility. 

- **Headings:** Use **Plus Jakarta Sans**. It provides a modern, geometric authority that feels "tech-forward" (40k) yet elegant (AoS). Heavy weights are used to anchor sections.
- **Body:** **Inter** is utilized for its exceptional readability in data-heavy contexts like army lists or rule clarifications.
- **Technical/Utility:** **JetBrains Mono** is used for metadata, dates, and "tactical" readouts (e.g., points values, table numbers) to evoke a sense of precision and data-entry.

## Layout & Spacing
The design system utilizes a **12-column fluid grid** for desktop and a **single-column stack** for mobile. 

- **Rhythm:** An 8px base unit governs all dimensions.
- **Sectioning:** Large vertical gaps (80px+) are encouraged between major sections to maintain a minimalist, "gallery" feel.
- **Adaptation:** On mobile, margins tighten to 20px, and complex data tables reflow into card-based layouts. 
- **The "Focus" Layer:** Content should be centered within a 1280px max-width container to prevent line lengths from becoming unreadable on ultra-wide monitors.

## Elevation & Depth
This design system uses **Tonal Layering** combined with **Inner Glows** rather than heavy drop shadows.

- **Surface Tiers:** Background is the darkest `#0F172A`. Content cards use a slightly lighter slate (`#1E293B`). High-priority modals use `#334155`.
- **Atmospheric Depth:** A 1px subtle border (low-opacity white) is used on cards to give them a "etched" look. 
- **Glassmorphism:** Navigation bars and "Live Game" tickers use a backdrop-blur (12px) with 70% opacity to maintain a sense of the "battlefield" (background imagery) beneath the UI.

## Shapes
We employ a **Soft (0.25rem)** rounding strategy. This maintains a disciplined, architectural feel—appropriate for military-themed wargaming—while avoiding the aggressive harshness of 0px sharp corners.

- **Standard Elements:** Buttons and Input fields use 4px (`rounded-sm`).
- **Containers:** Event cards and imagery use 8px (`rounded-lg`).
- **Badges:** Game system tags (e.g., "40k") use 2px rounding to appear like military dog tags.

## Components
- **Buttons:** Primary buttons are solid **Aurelian Gold** with black text for maximum "Call to Action" visibility. Secondary buttons are outlined in Slate with a hover state that fills the background.
- **Event Cards:** Feature a high-ratio image (16:9) at the top. The bottom section uses a strict grid to display the date, points limit, and "spots remaining." Use the **JetBrains Mono** label style for these technical details.
- **Game Tags:** Compact chips used to differentiate between systems. Blue-glow borders for 40k, Gold-glow for Age of Sigmar.
- **Schedule List:** A clean, vertical timeline. The time is positioned in a left-hand column using **JetBrains Mono**, with the event description in **Inter** to the right. Minimalist horizontal rules separate entries.
- **Status Indicators:** Pulsing subtle glows are used for "Live" game sessions or "Registration Open" states.

---

## Заметки по реализации (добавлено при интеграции — требуют сверки на визуальном проходе)

1. **Token-имена vs бренд-проза (нужно согласовать).** По Material-именованию токен `primary` = `#bec6e0` (светлый перивинкл/сине-серый), а «Aurelian Gold» — это `secondary`/`secondary-container` (`#ffe083`/`#eec200`). При этом проза «Components» говорит «Primary buttons are solid Aurelian Gold». То есть «Primary» в брендовом смысле (главный CTA) = токен `secondary` (золото), а не токен `primary`. Реализации задать явный маппинг «главный CTA → secondary-container (золото) + on-secondary-container», чтобы не собрать кнопки перивинклом.
2. **Прозаические HEX ≠ токены (elevation).** В «Elevation & Depth» указаны `#0F172A / #1E293B / #334155` (Tailwind slate) как иллюстрация ярусов, но реальные токены поверхностей другие (`surface #051424`, `surface-container-high #1c2b3c`, `surface-container-highest #273647`). **Источник истины — блок `colors` во фронтматтере**, прозаические хексы — только пояснение намерения.
3. **Маппинг на семантику валидации (§9.2.5 спека):** hard-ошибки → `error`; soft-предупреждения → `secondary` (золото); «Live»/«Registration» → `tertiary` (Crimson). **Конкретные пары чипов — в разделе «Компоненты: алерты/статусы» ниже** (наивные пары container/on-container давали «золото на золоте» и halation — переработано).
4. **Светлая тема — готова** (парная схема в `design-system-light.md`, WCAG AA). Роли и структура компонентов совпадают — компоненты не разветвляются между темами.
5. **Шрифты:** Plus Jakarta Sans / Inter / JetBrains Mono — подключить как локальные ассеты (офлайн-first, §7), не с внешнего CDN.

---

## Компоненты: алерты/статусы (severity через ПАТТЕРН, не только оттенок)

Утверждённый гибрид. **Уровень кодируется формой заливки + hue + моушеном**, а не только цветом (иначе error и live — оба красные — сливаются). Наивные пары `container/on-container` не годятся: warn давал «золото на золоте» (~2:1 перцептивно), live — halation яркого `#f42f54` на тёмном. Значения ниже — **тёмная тема**; светлая — те же паттерны в `design-system-light.md`. **Новых токенов 0.**

| Уровень | Паттерн | background | text | border | dot | Контраст текста |
|---|---|---|---|---|---|---|
| **Error** (hard) | filled, `font-weight:600` | `error-container #93000a` | `on-error-container #ffdad6` | — | `#ffdad6` | **7.25:1** |
| **Warn** (soft) | gold **ghost** | transparent (`surface`) | `secondary #ffe083` | `secondary-container #eec200` | `#eec200` | **14.3:1** |
| **Live/Registration** | crimson **ghost + пульс** | transparent | `tertiary #ffb3b6` | `#ffb3b6` | `tertiary-container-accent #f42f54` (пульс) | **10.9:1** |
| **Info** | perivinkle **ghost** | transparent | `primary #bec6e0` | `#bec6e0` | `#bec6e0` | **10.9:1** |

**Правила:**
- **Пульс** только у Live: точка `#f42f54` (нетекстовый индикатор, ≥3:1 к `surface`), halo `rgba(244,47,84,.55→0)`; уважать `prefers-reduced-motion`.
- **Системные теги** (40k/AoS/KT) — тоже ghost: AoS = золотой ghost (не полупрозрачное золото!), KT = crimson ghost, 40k = blue-glow. Чинит ту же болезнь «золото на золоте».
- **Success/valid — намеренно НЕ вводим зелёный токен:** позитив несёт золото или нейтральная галочка (форма отличает success от warn). Держим палитру компактной; зелёный-рамп добавляем только если продукт явно потребует развода success↔warn цветом.
- Эталон разметки — превью-артефакт (класс `.chip--*`).
