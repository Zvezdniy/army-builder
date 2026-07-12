# Дизайн: structural IR shrink (content-addressed дедуп поддеревьев)

**Дата:** 2026-07-12
**Статус:** утверждён к реализации (blanket-делегирование)
**Связано:** [[roster-web-status]], [[engine-parser-status]], `2026-07-12-per-placement-addressing-keystone-design.md`

## Проблема (гейт №1 к реальному использованию в вебе)

Парсер инлайнит каждую залинкованную сущность как полный клон в место вставки. На реальном SM это раздувает IR до **104 MB** (`entries` = 48.4 MB compact; 39343 узла дерева; 36096 профилей). Браузер не может ни скачать, ни распарсить, ни удержать в куче такой объём — реальный каталог в вебе брали 4-рутовым trimmed-подмножеством. Без структурного сжатия реальные каталоги непрактичны в билдере.

**Замер (реальный SM, `entries` compact 48.4 MB):**
- 39343 узла дерева, но лишь **1197 уникальных поддеревьев** по content-hash.
- Content-addressed пул поддеревьев: 48.4 MB → **2.8 MB (−94.3%)**.
- Профили: 36096 инстансов, 1128 уникальных (дедуп поддерева уже включает профили — отдельный профиль-пул не нужен, YAGNI).

## Ключевое наблюдение: дедуп и keystone ортогональны и совместимы

Per-placement keystone-срез сделал расходящиеся клоны легитимно РАЗЛИЧНЫМИ (разные модификаторы/цена конкретной вставки). Content-addressing это **сохраняет автоматически**: расходящиеся клоны имеют разный хэш → разные записи пула → разные объекты; идентичные клоны → одна запись пула → шарятся. Резолвинг ростера по дереву (`parentEntry.children.find(id)`) видит корректный per-placement экземпляр под своим родителем. Дедуп ничего не ломает в keystone-семантике — он лишь коллапсирует байт-идентичные повторы.

`categories.ts` уже документирует инвариант «entry.categories (shared across inlined duplicates) is never mutated» — движок уже рассчитан на шаринг сущностей. Проверено: engine-eval/roster НЕ мутируют `IrEntry` и НЕ сравнивают сущности по ссылочной идентичности (только по `id`). Значит рантайм-дерево может быть DAG с общими объектами для идентичных поддеревьев — куча крошечная.

## Решение

**Wire-формат (упакованный) + рехидратация на границе домена.** Дистрибутивный файл несёт плоский пул уникальных поддеревьев; на загрузке домен разворачивает его в рантайм-дерево `IrCatalogue` с ОБЩИМИ (frozen-подобными, read-only) объектами для идентичных поддеревьев. Движок/roster/web ниже по потоку потребляют неизменённый рантайм-тип `IrCatalogue` — публичный контракт не трогаем.

### Подход (выбран B из трёх)

- **A. Нативная упаковка в парсере (Rust эмитит пул).** Плюс: нет 100 MB-промежутка. Минус: интернинг в Rust + смена рекурсивного serialize-типа + регенерация golden + риск в самом парсере. Отвергнут как более рискованный.
- **B (рекомендован). JS pack/rehydrate на границе домена; парсер НЕ трогаем.** Плюс: изменение локализовано в чистом, тестируемом TS; парсер и весь его golden-набор остаются зелёными без единой правки; полный выигрыш −94% реализуется на границе дистрибуции. Минус: транзиентный 100 MB-промежуток на этапе pack (build-time CLI, браузер его не видит).
- **C. Только gzip.** Отвергнут: решает скачивание, но не парсинг/кучу (39343 различных объекта в куче остаются) — а именно они роняют браузер.

## Слои

### `packages/domain/src/packed.ts` (NEW)

Чистые функции + Zod-схемы. Ничего рантаймового не тянет.

- **`canonicalKey(value): string`** — детерминированная сериализация с рекурсивной сортировкой ключей объектов (массивы/примитивы как есть). Ключ для content-address. Детерминизм не зависит от порядка ключей, который выдал Zod.
- **`PackedEntry`** = схема `IrEntry`, но `children: z.array(z.number().int().nonnegative())` (индексы в пул) вместо `children: IrEntry[]`. Остальные поля идентичны `IrEntry`.
- **`PackedCatalogue`** = схема `IrCatalogue`, но:
  - `format: z.literal("packed-v1")` (дискриминатор пути загрузки),
  - `entryPool: z.array(PackedEntry)` — уникальные поддеревья,
  - `entries: z.array(z.number().int().nonnegative())` — индексы корней в пул.
  - `forceConstraints`/`categoryNames`/`ruleTexts` — как в `IrCatalogue`.
- **`packCatalogue(cat: IrCatalogue): PackedCatalogue`** — снизу-вверх интернинг:
  ```ts
  const pool: PackedEntry[] = [];
  const index = new Map<string, number>();
  const intern = (e: IrEntry): number => {
    const children = e.children.map(intern);           // дети интернятся первыми
    const packed = { ...e, children };
    const key = canonicalKey(packed);
    let i = index.get(key);
    if (i === undefined) { i = pool.length; pool.push(packed); index.set(key, i); }
    return i;
  };
  const roots = cat.entries.map(intern);
  return { ...cat, format: "packed-v1", entryPool: pool, entries: roots };
  ```
  Работает на ВАЛИДИРОВАННОМ рантайм-каталоге (дефолты Zod уже заполнены). Порядок детей значим (сохраняется). Общий ребёнок → один индекс.
- **`rehydrateCatalogue(p: PackedCatalogue): IrCatalogue`** — мемоизированная сборка (порядко-независима, без циклов — content-addressed из дерева даёт DAG без циклов):
  ```ts
  const built: IrEntry[] = new Array(p.entryPool.length);
  const build = (i: number): IrEntry => {
    const memo = built[i]; if (memo) return memo;
    const pe = p.entryPool[i]!;
    const node: IrEntry = { ...pe, children: pe.children.map(build) };  // shared refs
    built[i] = node; return node;
  };
  const entries = p.entries.map(build);
  const { format: _f, entryPool: _p, ...rest } = p;
  return { ...rest, entries };
  ```
  Идентичные поддеревья → `build(i)` возвращает ОДИН объект → общая ссылка (крошечная куча). Дефолты уже в пул-записях (валидированы `PackedCatalogue.parse`), повторный `IrCatalogue.parse` не нужен (39343-узловая ревалидация свела бы выигрыш на нет).
- **`loadCatalogue(raw: unknown): IrCatalogue`** — единый вход загрузки: если `raw.format === "packed-v1"` (или присутствует `entryPool`) → `rehydrateCatalogue(PackedCatalogue.parse(raw))`; иначе → `IrCatalogue.parse(raw)` (обратная совместимость с tree-формой). Экспорт из `domain/index.ts`.

### Pack CLI

`scripts/pack-ir.mjs` (repo-level, node + `tsx`/собранный домен): читает tree-IR JSON (вывод `muster-parse`), делает `IrCatalogue.parse` → `packCatalogue` → пишет упакованный JSON. Для воспроизводимости дистрибутивного файла. Печатает before/after размеры и коэффициент.

### `apps/web`

- Путь загрузки (статический импорт-фикстура И file-input) идёт через `loadCatalogue` вместо голого `IrCatalogueSchema.parse`. Mini-фикстура остаётся tree-формой (её пакетить незачем — крошечная; `loadCatalogue` её примет tree-веткой). File-input теперь принимает и упакованные реальные каталоги.
- Никаких изменений в компонентах/рендере — рантайм `IrCatalogue` тот же.

## Инвариант «никогда не мискомпилировать / не сломать существующее»

- `rehydrate(pack(c))` **глубоко равно** `c` для любого валидированного `IrCatalogue` (round-trip property-тест) → движок потребляет идентичные данные, все существующие тесты зелёные.
- Расходящиеся per-placement клоны → разный хэш → раздельные пул-записи → keystone-резолвинг различает их (не деградирует).
- Идентичные поддеревья → общий объект; read-only использование в engine-eval/roster (проверено: нет мутаций/ссылочных сравнений) → шаринг семантически прозрачен.
- Парсер и его golden — НЕ трогаем (0 Rust-риска).
- `loadCatalogue` обратно совместим: tree-форма грузится как прежде.
- Неизвестный/битый `format` → `PackedCatalogue.parse` бросает ZodError (не тихая мискомпиляция).

## Тесты

**domain (`packed.test.ts`):**
- `canonicalKey`: одинаковое содержимое с разным порядком ключей → равные ключи; разное содержимое → разные.
- `packCatalogue`: два идентичных инлайненных поддерева → одна пул-запись, два корня ссылаются на один индекс; порядок детей значим (перестановка → разные записи).
- `packCatalogue`: расходящиеся одноимённые клоны (разные costs/modifiers) → ДВЕ пул-записи (keystone-инвариант дедуп не нарушает).
- `rehydrateCatalogue`: разворачивает пул; идентичные поддеревья → **та же ссылка объекта** (assert `a === b`); DAG-шаринг.
- **round-trip:** для нескольких каталогов (mini-фикстура + синтетический с инлайн-повторами) `rehydrate(pack(c))` deep-equal `c`.
- `loadCatalogue`: `format: "packed-v1"` → рехидратирует; tree-форма → парсит как `IrCatalogue`; битый packed → бросает.
- **shrink-эффект:** синтетический каталог с N идентичными инлайн-поддеревьями → `entryPool.length` ≪ число узлов; сериализованный packed заметно меньше tree.

**apps/web (`App` load-тест, jsdom):** упакованная фикстура (packed-v1) → `loadCatalogue` разворачивает → приложение рендерит тот же результат, что из tree-фикстуры (evaluate identical). Регресс tree-загрузки не сломан.

**Полный прогон:** domain 100% на новом модуле; turbo 4/4 зелёный.

## Осязаемо (пост-мёрж проверка)

Упаковать реальный SM (`muster-parse` → 104 MB → `pack-ir` → ~3 MB), загрузить **полный** каталог (все 132 корня, не 4-рутовый trim) в веб-билдер, отрендерить Hammerfall Bunker и добавить юнит — доказать, что реальный каталог теперь браузеро-практичен end-to-end. Это снимает гейт №1 к реальному использованию.
