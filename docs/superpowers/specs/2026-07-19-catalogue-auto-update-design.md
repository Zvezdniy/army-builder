# Авто-апдейт каталогов (CI + GitHub Pages) — дизайн

**Дата:** 2026-07-19
**Срез:** автоматическое обновление парсимой базы из BSData — оркестрационный скрипт + GitHub Actions по расписанию + публикация на GitHub Pages.

## Цель

GW патчит баланс → BSData обновляет `.cat`/`.gst` за дни → наш CI по расписанию заново тянет,
парсит, пакует и публикует свежие каталоги → клиенты (веб, позже Expo) получают их без ручного
шага. Позиция «серая зона» ([[ip-posture-grey-zone]]) снимает redistributor-блокер: packed-каталоги
можно хостить публично.

## Что уже доказано в этой сессии

- Пайплайн `download BSData → muster-parse → pack → registry` работает end-to-end (реальный SM:
  132 рута, pack 206.7МБ→3.40МБ, грузится в вебе с детачментами/усилениями/force-org/очками).
- **Split-фракции** (тонкий `.cat` + `- Library.cat`): парсер вытягивает их через
  `merge_supporting`, если Library передать supporting-файлом (AM: 2 рута без Library → **140** с
  Library). P0-c (catalogueLink-резолв) для этого НЕ нужен.
- Headless-паковка решена: `pnpm exec tsx scripts/pack-ir.mjs` (в root devDeps добавлены `tsx` +
  `@muster/domain workspace:*`, чтобы node-скрипт из `scripts/` резолвил TS-исходник пакета).

## Инфраструктура (реальность)

- Репозиторий приватный `github.com/Zvezdniy/army-builder`, локальный main **не запушен** (301
  коммит впереди origin). CI живёт на GitHub → **репо надо запушить** (действие владельца).
- Хостинг — **GitHub Pages** через встроенный `GITHUB_TOKEN` (без отдельного storage-аккаунта/кредов).
  Pages публичны → packed-BSData становится публично скачиваемым = акт редистрибуции (согласуется с
  «серой зоной»). Включение Pages/Actions — действие владельца в настройках репо.

## Компоненты

### 1. Конфиг `scripts/catalogues.config.json`

BSData-наименования нерегулярны (у одних фракций контент в самом `.cat`, у других — в отдельном
`- Library.cat`), поэтому список явный, а не эвристический:

```json
{
  "repo": "BSData/wh40k-10e",
  "ref": "main",
  "gameSystem": "Warhammer 40,000.gst",
  "catalogues": [
    { "slug": "space-marines", "name": "Space Marines",
      "primary": "Imperium - Space Marines.cat", "libraries": [] },
    { "slug": "astra-militarum", "name": "Astra Militarum",
      "primary": "Imperium - Astra Militarum.cat",
      "libraries": ["Imperium - Astra Militarum - Library.cat"] }
  ]
}
```

Расширение библиотеки = добавить запись. Общий баланс-апдейт (правки внутри существующих файлов)
подхватывается автоматически при следующем прогоне — новые фракции добавляются в конфиг вручную
(редко, обычно на смене эдишена).

### 2. Скрипт `scripts/update-catalogues.mjs` (+ `pnpm run update-catalogues`)

Детерминированная оркестрация (Node ESM):

1. Читает конфиг.
2. Скачивает `gameSystem` + для каждой записи `primary` + `libraries` из
   `raw.githubusercontent.com/<repo>/<ref>/<url-encoded name>` во временную папку.
3. Собирает парсер: `cargo build --release --bin muster-parse` (в `packages/engine-parser`).
4. По каждой записи: `muster-parse <primary> <lib...> <gameSystem>` → tree-IR (stdout); затем pack
   через `packCatalogue` → `apps/web/public/catalogues/<slug>.ir.json`. Пустой парс (roots < порога)
   → предупреждение (вероятно не хватает library в конфиге), запись пропускается, не валит прогон.
5. Пишет манифест `apps/web/public/catalogues.json` (переиспользует логику
   `build-catalogue-manifest.mjs`).

Паковка — через тот же `tsx`-совместимый seam, что и `pack-ir.mjs` (либо импорт `packCatalogue`
напрямую, запуск скрипта под `tsx`). Диагностики парсера логируются суммарно (кол-во по кодам).
Скрипт идемпотентен и параметризуется `--config <path>` (дефолт `scripts/catalogues.config.json`).

### 3. GitHub Actions `.github/workflows/update-catalogues.yml`

- Триггеры: `schedule` (cron, напр. ежедневно) + `workflow_dispatch` (ручной).
- Шаги: checkout → setup Node/pnpm + Rust → `pnpm install` → `pnpm run update-catalogues` → загрузка
  `apps/web/public/catalogues/` (packed IR + `catalogues.json`) как Pages-артефакт → `deploy-pages`.
- Права: `contents: read`, `pages: write`, `id-token: write`. Публикует ТОЛЬКО данные каталогов
  (не веб-приложение) — фокус среза на доставке данных. Никаких секретов сверх `GITHUB_TOKEN`.

### 4. Реестр: конфигурируемый базовый URL каталогов

Чтобы приложение фетчило каталоги с Pages (а не только из локального `public/`), базовый URL —
из env `VITE_CATALOGUES_BASE` (Vite compile-time), дефолт — текущий относительный
`import.meta.env.BASE_URL` (обратная совместимость, локальный dev/веб на том же origin). `App`
передаёт этот базовый URL в `loadRegistry`/`loadCatalogueFor`. Мобайл (позже) передаст абсолютный
Pages-URL. Данные каталогов и деплой приложения **развязаны**: обновление данных не требует
редеплоя приложения — суть авто-апдейта.

## Границы (YAGNI / вне среза)

- **P0-c (catalogueLink-резолв)** — НЕ нужен: split-фракции покрываются supporting-Library-файлами.
- Полный список всех ~25 фракций в конфиге — заводим инкрементально; срез поставляет пайплайн +
  CI + хостинг на стартовом наборе (SM самодостаточный + AM split как образец обоих случаев).
- On-device кэш / freshness-детект / Expo-клиент — следующие срезы.
- Деплой самого веб-приложения на Pages — отдельно; здесь публикуем только данные.
- Автодискавери фракций из GitHub API — отложено (нерегулярный нейминг → явный конфиг надёжнее).

## Что делает владелец (я не могу — внешнее/креды)

1. Запушить репо в GitHub (`git push`, 301 коммит) — иначе Actions не запустятся.
2. Включить в настройках репо: Pages (source = GitHub Actions) + Actions.
3. Подтвердить, что публикация packed-BSData на публичные Pages = осознанная редистрибуция (серая
   зона). После — прописать Pages-URL в `VITE_CATALOGUES_BASE` для клиента.

## Тестирование

- **`update-catalogues.mjs`**: локальный прогон на конфиге из 2 фракций → `public/catalogues/`
  содержит `space-marines.ir.json` (≈3.4МБ, 132 рута) и `astra-militarum.ir.json` (140 рутов) +
  валидный `catalogues.json` из 2 записей; повторный прогон идемпотентен. Live: загрузить обе в
  вебе через реестр, проверить, что юниты/детачменты появляются.
- **Реестр env-база**: юнит-тест — `VITE_CATALOGUES_BASE` переопределяет базовый URL; дефолт =
  относительный. Существующие registry-тесты остаются зелёными.
- **Workflow**: YAML синтаксически валиден; локально не прогоняется (нужен GitHub) — проверяется
  ревью + после пуша владельцем.
- Весь `turbo run test` зелёный; Rust golden не затронут (парсер не меняется).
- В git не коммитятся GW-данные (`apps/web/public/` gitignored); в git идут только скрипт, конфиг,
  workflow, env-правка реестра, devDeps.
