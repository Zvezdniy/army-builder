---
name: Astronomican Lighthouse
name-scope: Внутренний КОДНЕЙМ (dev + дизайн-система). НЕ публичное имя — «Astronomican» = термин GW. Публичное имя TBD (Muster/Levy). См. §13.5/§14.
theme: light
status: >
  Светлая тема — v1 (выведена как пара к тёмной сеньор-дизайнером, WCAG AA проверена).
  Требует верификации на реальных экранах — см. «Open flags».
pairs-with: design-system-dark.md
shared: >
  typography, rounded, spacing — ОБЩИЕ с тёмной темой (theme-independent).
  Источник истины для них — design-system-dark.md. Здесь дублируются для удобства.
colors:
  # --- Neutrals / surfaces (cool slate gallery-white, не стерильный #fff) ---
  surface: '#fbfcff'
  surface-dim: '#dbdce2'
  surface-bright: '#fbfcff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f6fb'
  surface-container: '#eff0f6'
  surface-container-high: '#e9eaf0'
  surface-container-highest: '#e3e4ea'
  on-surface: '#1a1c22'
  on-surface-variant: '#43474f'
  inverse-surface: '#2f3036'
  inverse-on-surface: '#f0f1f7'
  outline: '#73777f'
  outline-variant: '#c3c6ce'
  surface-tint: '#565e74'
  # --- Primary (Abyssal → deep slate-navy ink на светлом) ---
  primary: '#565e74'
  on-primary: '#ffffff'
  primary-container: '#dae2fd'
  on-primary-container: '#3f465c'
  inverse-primary: '#bec6e0'
  # --- Secondary (Aurelian Gold: CTA + достижения) ---
  secondary: '#6d5e00'
  on-secondary: '#ffffff'
  secondary-container: '#eec200'
  on-secondary-container: '#4a3b00'
  # --- Tertiary (Crimson Protocol: live / secondary CTA) ---
  tertiary: '#920028'
  on-tertiary: '#ffffff'
  tertiary-container: '#ffdada'
  on-tertiary-container: '#5c0018'
  # --- Error (hard-ошибки валидации) ---
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#410002'
  # --- Fixed tokens (theme-independent — идентичны тёмной теме) ---
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
  # --- Background / misc ---
  background: '#fbfcff'
  on-background: '#1a1c22'
  surface-variant: '#dfe2eb'
typography:
  headline-xl: { fontFamily: Plus Jakarta Sans, fontSize: 48px, fontWeight: '800', lineHeight: '1.1', letterSpacing: -0.02em }
  headline-lg: { fontFamily: Plus Jakarta Sans, fontSize: 32px, fontWeight: '700', lineHeight: '1.2', letterSpacing: -0.01em }
  headline-lg-mobile: { fontFamily: Plus Jakarta Sans, fontSize: 28px, fontWeight: '700', lineHeight: '1.2' }
  headline-md: { fontFamily: Plus Jakarta Sans, fontSize: 24px, fontWeight: '600', lineHeight: '1.3' }
  body-lg: { fontFamily: Inter, fontSize: 18px, fontWeight: '400', lineHeight: '1.6' }
  body-md: { fontFamily: Inter, fontSize: 16px, fontWeight: '400', lineHeight: '1.5' }
  label-caps: { fontFamily: JetBrains Mono, fontSize: 12px, fontWeight: '500', lineHeight: '1.0', letterSpacing: 0.1em }
  label-sm: { fontFamily: Inter, fontSize: 14px, fontWeight: '500', lineHeight: '1.4' }
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

## Светлая тема — «Tactical Clarity» (пара к «Deep Space & Charcoal»)

Выведена как M3-парная схема к тёмной теме с сохранением **ролевого паритета 1:1** — каждый токен делает ту же работу, компоненты не переразводятся. Метод: тональные шкалы, зашитые в `*-fixed`-токены тёмной темы (они theme-independent), развёрнуты для светлой схемы. `inverse-primary` тёмной = `primary` светлой — встроенная M3-симметрия как якорь. **Abyssal переехал из фона в «чернила»** (primary/on-surface); Gold и Crimson остались акцентами.

## Контраст (WCAG 2.1, проверено)

| Пара (текст / фон) | Роль | Ratio | Итог |
|---|---|---|---|
| on-surface `#1a1c22` / surface `#fbfcff` | основной текст | 16.7:1 | ✅ AA |
| on-surface-variant `#43474f` / surface | вторичный текст | 9.2:1 | ✅ AA |
| on-primary `#fff` / primary `#565e74` | primary-кнопка/чип | 6.5:1 | ✅ AA |
| on-primary-container `#3f465c` / primary-container `#dae2fd` | tonal-кнопка | 7.3:1 | ✅ AA |
| **on-secondary-container `#4a3b00` / secondary-container `#eec200`** | **золотой CTA** | 6.5:1 | ✅ AA |
| secondary `#6d5e00` / surface | золото как ink/иконка/бейдж | 6.3:1 | ✅ AA |
| on-tertiary `#fff` / tertiary `#920028` | crimson CTA/live | 9.3:1 | ✅ AA |
| on-tertiary-container `#5c0018` / tertiary-container `#ffdada` | live-чип pale | 11.1:1 | ✅ AA |
| on-error `#fff` / error `#ba1a1a` | hard-ошибка | 6.5:1 | ✅ AA |
| on-error-container `#410002` / error-container `#ffdad6` | баннер ошибки | 13.3:1 | ✅ AA |
| outline `#73777f` / surface | границы (не текст) | 4.4:1 | ✅ UI (≥3), НЕ для текста |

Провалов нет. `outline` — только для нетекстовых границ; для плейсхолдеров/disabled использовать `on-surface-variant`.

## Ключевые решения

- **Gold-on-white решён явно (главный хазард).** Золото не читается как текст на белом → две формы: (1) **CTA = `secondary-container #eec200` + чернила `on-secondary-container #4a3b00`** (6.5:1) — «сплошное золото» как в тёмной теме; (2) золото-акцент/иконка = `secondary #6d5e00` (тон-40) на светлом (6.3:1). Пастельное золото как текст на светлом — не используем.
- **Осознанное отступление от чистого M3:** `secondary-container` оставлен насыщенным `#eec200` (а не бледным тон-90) ради паритета «главный CTA = сплошное золото» в обеих темах. Компромисс — см. flag 1.
- **Crimson → tone-40 `#920028` + белый** (9.3:1) для live/secondary-CTA; pale-вариант — `tertiary-container`. Разделение `error` (hard-ошибки валидации) vs `tertiary` (live/soft) из тёмной темы сохранено (§9.2.5).
- **Fixed-токены идентичны тёмной теме** — корректное M3-поведение; все `on-*-fixed` тёмные, на светлых `*-fixed`-контейнерах дают 7–13:1.
- **Нейтрали — cool slate, не generic white:** `surface #fbfcff` — холодный галерейный офф-уайт, контейнеры растут холодным тоном; границы через `outline-variant` без жёстких линий.

## Elevation / glass на светлом (специфика — отличается от тёмной)

- **Elevation несёт ТЕНЬ, а не тон** (тональное расслоение на светлом слабое): неглубокие cool-тонированные тени, напр. `0 1px 2px rgba(26,28,34,.06), 0 4px 12px rgba(26,28,34,.08)` — тень в сине-серый ink, не чистый чёрный.
- **Инверсия «этчинга»:** 1px белый бордер на светлом невидим → заменить на 1px `outline-variant #c3c6ce` (тонкая тёмная хейрлайн).
- **Inner glow убрать/инвертировать** (на светлом читается как замыленность); опц. `inset 0 1px 0 rgba(255,255,255,.7)` для «поднятой» поверхности.
- **Glassmorphism: непрозрачность 85–92%** (не 70% как в тёмной — иначе «молочный» навбар), blur 12px, + 1px нижний `outline-variant`.
- **Модалки:** `surface-container-highest #e3e4ea` + тень + scrim `rgba(26,28,34,.32)`.

## Open flags (верифицировать на реальных экранах)

1. **`secondary-container #eec200` как CTA-заливка** может «вибрировать» на больших площадях на белом. Fallback B: CTA = `#6d5e00` + белый текст (но теряется «сплошное золото»). Решение — на визуальном проходе.
2. **`outline` 4.4:1** — не для текста.
3. **Золото/чипы над фото миниатюр** на светлом могут терять контраст → полупрозрачный подслой под чипами (glass).
4. **`secondary #6d5e00`** визуально ближе к оливково-бронзовому, чем к «сияющему золоту» — проверить, читается ли как «achievement», иначе использовать золото только как контейнер-заливку.
5. **Live-пульс (`tertiary`)** на светлом слабее — возможно нужен крупнее halo или непрозрачная crimson-точка + кольцо.
6. **`surface (#fbfcff) ≠ surface-dim (#dbdce2)`** (в тёмной теме они равны) — проверить компоненты, завязанные на dim/bright различие.

## Компоненты: алерты/статусы (severity через ПАТТЕРН — паритет с тёмной темой)

Та же структура, что в `design-system-dark.md` (уровень = заливка/ghost/ghost+пульс), значения для **светлой** темы. В светлой «золото на золоте» не возникает (тёмные чернила на ярком фоне), но паттерн переносим ради **паритета компонентов**. Новых токенов 0.

| Уровень | Паттерн | background | text | border | dot | Контраст текста |
|---|---|---|---|---|---|---|
| **Error** (hard) | filled, `font-weight:600` | `error #ba1a1a` | `on-error #ffffff` | — | `#ffffff` | **6.5:1** |
| **Warn** (soft) | gold **ghost** | transparent (`surface`) | `secondary #6d5e00` | `#6d5e00` | `secondary-container #eec200` | **6.3:1** |
| **Live/Registration** | crimson **ghost + пульс** | transparent | `tertiary #920028` | `#920028` | `#920028` (пульс) | **9.3:1** |
| **Info** | perivinkle **ghost** | transparent | `primary #565e74` | `#565e74` | `#565e74` | **6.5:1** |

Правила пульса/reduced-motion, системных тегов (AoS/KT ghost) и «без зелёного success» — идентичны тёмной теме (см. её файл).
