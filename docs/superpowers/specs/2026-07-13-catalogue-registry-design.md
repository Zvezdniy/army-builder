# Реестр каталогов (библиотека фракций) — дизайн

**Дата:** 2026-07-13
**Срез:** сделать шаг «фракция» в SetupWizard реальным — реестр доступных каталогов + переключение активной фракции.

## Проблема

Шаг «фракция» в `SetupWizard` — жёсткая заглушка: единственная выбираемая карточка = текущий
загруженный каталог, остальные (Astra Militarum / Necrons / Orks) `disabled` с меткой «Library
soon». Пользователь не может держать несколько фракций и переключаться между ними. `App` держит
**один** `IrCatalogue` в `useState`; `loadIr` (file-input) заменяет его разово. Реестра и
персистентности нет.

## Почему GW-данные не в git (определяет дизайн)

Каталоги BSData — производное от IP Games Workshop (статы, правила, стоимости). Позиция проекта:
**приложение — инструмент, а не распространитель GW-контента**. App поставляется пустым от
GW-данных; данные — **BYO (bring your own)**, пользователь берёт их из BSData в рантайме. Поэтому
вся `apps/web/public/` в `.gitignore`, а в git коммитится только синтетическая не-GW фикстура
`apps/web/src/mini40k.ir.json`. Реестр обязан это соблюдать: **инфраструктура в git, ноль
GW-данных**.

## Решение (манифест-подход)

Реестр — рантайм-концепт «доступные фракции», собираемый из двух источников:

1. **Встроенный** — `mini40k` (всегда есть, не-GW; уже импортится в JS).
2. **Локальный манифест** — `public/catalogues.json`, фетчится в рантайме; каждая запись →
   ленивая загрузка packed/tree IR из `public/`. Пользователь кладёт каталоги в
   `public/catalogues/` → они появляются как фракции. Манифеста нет / он битый → реестр = только
   встроенный (мягкая деградация, без краха).

Существующий file-import остаётся (разовая загрузка на сессию, вне реестра).

### Модуль реестра (чистый, тестируемый)

`apps/web/src/registry/catalogueRegistry.ts` — web-специфичный (fetch + bundled JSON), но с
**инъектируемым fetch** для тестов в jsdom без сети.

```ts
export type CatalogueDescriptor = {
  id: string;          // стабильный id (id каталога; встроенный = его собственный id)
  name: string;        // отображаемое имя
  source:
    | { kind: "bundled"; data: unknown }   // распарсенный JSON встроенной фикстуры
    | { kind: "manifest"; file: string };  // путь относительно BASE_URL приложения
};

export type CatalogueManifest = {
  version: 1;
  catalogues: { id: string; name: string; file: string }[];
};

// Собирает список фракций: встроенная первой, затем валидные записи манифеста
// (dedup по id — встроенная не перекрывается). Любая ошибка фетча/парса манифеста
// → только встроенная. Никогда не бросает.
export function loadRegistry(
  bundled: CatalogueDescriptor,
  fetchFn: typeof fetch,
  manifestUrl: string,
): Promise<CatalogueDescriptor[]>;

// Материализует IrCatalogue для дескриптора через общий loadCatalogue-seam.
// bundled → loadCatalogue(data); manifest → fetch(file) → json → loadCatalogue(json).
export function loadCatalogueFor(
  descriptor: CatalogueDescriptor,
  fetchFn: typeof fetch,
  baseUrl: string,
): Promise<IrCatalogue>;
```

Валидация манифеста — Zod-схема (`CatalogueManifest`) в том же модуле; `version !== 1` или
провал парса → трактуется как «манифеста нет».

### Формат манифеста (`public/catalogues.json`)

```json
{
  "version": 1,
  "catalogues": [
    { "id": "sm-10e", "name": "Space Marines", "file": "catalogues/space-marines.ir.json" }
  ]
}
```

`file` резолвится относительно `import.meta.env.BASE_URL`. Ленивая загрузка: реальные IR
фетчатся только при выборе фракции, не при сборке реестра.

### Скрипт-построитель манифеста

`scripts/build-catalogue-manifest.mjs` (Node ESM, читает только JSON — без extensionless-импортов):
сканирует `apps/web/public/catalogues/*.ir.json`, читает `id`+`name` каждого (packed или tree),
пишет `apps/web/public/catalogues.json`. Запуск вручную после добавления каталогов. Убирает
ручное редактирование манифеста.

### UI

- **`App`**: на маунте (`useEffect`) грузит реестр (`loadRegistry`), держит
  `registry: CatalogueDescriptor[]` и `activeDescriptorId`. Встроенный дескриптор строится из
  распарсенного `mini40k` (`{ id, name }`). Переключение фракции:
  `loadCatalogueFor(descriptor)` → `setCatalogue` + свежий `createRoster` + сброс выбора/визарда
  (переиспользуем логику из текущего `loadIr`, вынеся её в общий `applyCatalogue(next)`).
- **`SetupWizard`** шаг «фракция»: рендерит `registry` реальными карточками (замена заглушки);
  активная — `chosen`; клик по другой зовёт `onSelectFaction(descriptor.id)`. Пока фракция
  грузится — карточка в состоянии загрузки; ошибка загрузки → строка «Couldn't load <name>»,
  активный каталог не меняется.
- **`SetupBar`** faction-chip: показывает имя активного каталога (уже так), открывает визард на
  шаге «фракция» (уже step 1).

### Пропсы (новые/изменённые)

```ts
// App → SetupWizard
registry: CatalogueDescriptor[];
activeDescriptorId: string;
onSelectFaction: (descriptorId: string) => void;   // async switch внутри App
factionError?: string;                              // сообщение о неудачной загрузке
```

## Обработка ошибок

- Манифест: fetch fail / not-ok / невалидный JSON / `version !== 1` / провал Zod → реестр =
  только встроенный, `console.warn` (не крах).
- Загрузка каталога фракции: fetch fail / невалидный IR → `factionError` в визарде, активный
  каталог сохраняется.
- Дескриптор с неизвестным id при переключении → no-op.

## Тестирование

- **`catalogueRegistry.ts` (jsdom, инъектированный fetch, без сети):**
  - `loadRegistry`: манифест с 2 записями → встроенный + 2 (порядок: встроенный первым);
    манифест 404/not-ok → только встроенный; битый JSON → только встроенный;
    `version` не 1 → только встроенный; дубль id встроенного в манифесте → не перекрывает.
  - `loadCatalogueFor`: bundled → рабочий `IrCatalogue`; manifest → фетчит `file` и парсит;
    fetch not-ok → бросает (App ловит в `onSelectFaction`).
- **web (jsdom):** SetupWizard шаг «фракция» рендерит N карточек из `registry`, клик по неактивной
  зовёт `onSelectFaction` с её id; активная помечена `chosen`. App: переключение фракции меняет
  активный каталог и сбрасывает ростер (мок реестра из 2 встроенных дескрипторов через
  инъекцию/пропс). Существующие App/builder/setup-тесты остаются зелёными.
- Весь `turbo run test` зелёный. Rust/парсер не тронуты (golden не затрагивается).
- **Live-проверка:** локально положить второй синтетический каталог (копия mini40k с иным
  `id`/`name`) в `public/catalogues/` + манифест (оба gitignored, НЕ коммитятся) → пикер фракций
  показывает 2 фракции, переключение грузит вторую и сбрасывает ростер.

## Границы (YAGNI)

- **Без IndexedDB-персиста** импортов (следующий срез — личная браузерная библиотека).
- Без фильтра/поиска по фракциям.
- Без удалённых (URL за пределами `public/` приложения) источников.
- File-import не интегрируется в реестр (остаётся разовым, как сейчас).
- Никаких GW-данных в git; тесты — на инъектированном fetch и синтетических/`mini40k` данных.
