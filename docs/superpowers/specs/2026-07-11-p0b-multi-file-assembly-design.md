# P0-b: межфайловая сборка `.cat` + `.gst` — дизайн

**Дата:** 2026-07-11
**Статус:** утверждён (brainstorming), готов к плану
**Предшественники:** [P0-a — surfacing корней](2026-07-11-p0a-root-surfacing-design.md) (СДЕЛАНО), [разведка](2026-07-11-real-catalogue-recon.md)

## Проблема

После P0-a реальный `Imperium - Space Marines.cat` парсится в **130 корневых `IrEntry`**, но с **390 диагностиками `entryLink.unresolved`**: 28% ссылок каталога указывают в общий пул игровой системы (`.gst`), которого при одиночном парсе нет. Следствия:

- юниты структурно **неполны** — межфайловое оружие/снаряжение не вложено;
- **категории** не резолвятся (899/1111 `categoryLink` определены в `.gst`) → форс-орг не с чем сопоставить;
- **costType** для очков определены в `.gst` → имена очков пустые;
- **форс-орг** (force-org: «1+ HQ», минимумы Battleline) живёт в `forceEntries` `.gst` — при одиночном парсе `.cat` его вообще нет.

Итог: одиночного `.cat` недостаточно, чтобы валидировать реальную армию. Нужна сборка `.cat` вместе с его `.gst`.

## Границы (согласовано)

**В scope:** ровно `.cat` (фракция) + её `.gst` (игровая система). Одна пара на вызов.

**Вне scope (осознанно):**
- `catalogueLink`-библиотеки (соседние `.cat`, напр. общий Imperium-агностик) — остаток ~53 ссылок остаётся `entryLink.unresolved` → **P0-c**;
- имена **категорий** в IR (валидации хватает id; матч форс-орга идёт по id категории) — отдельный шаг для будущего UI;
- top-level корни самого `.gst` (его 5 `entryLinks` — системный конфиг детачментов, не юниты фракции) не эмитятся как корни;
- профили/характеристики (statlines) — **P1**.

## Ключевые измерения (живые файлы, scratchpad)

- Добавление `.gst` закрывает **609 из 662** danglers по entryLink (остаток 53 — из `catalogueLink`-библиотек).
- Закрывает **899 из 901** целей `categoryLink` (2 остаются), **6 из 9** costType (3 остаются).
- `.gst` привязан к `.cat` через атрибут `gameSystemId` (**не** `catalogueLink`).
- Парсер уже понимает корень `<gameSystem>`: `parse_raw` строит из `.gst` ту же `RawCatalogue` с заполненными `force_entries`, `cost_types`, `categories`, `shared_entries`, `shared_groups`.
- Структура `.gst` (root id `sys-352e-…`): costTypes(6), categoryEntries(114), forceEntries(3), sharedSelectionEntries(16), sharedSelectionEntryGroups(12), sharedRules(33), sharedProfiles(10). 16 shared-сущностей + вложенное в них = общий пул оружия/снаряжения, куда ведут те 609 ссылок.

## Подход: слить `.gst` в `.cat` ДО резолва

Вместо того чтобы учить `resolve`/`to_ir` работать с несколькими `RawCatalogue`, **сливаем `RawCatalogue` игровой системы в `RawCatalogue` фракции один раз, перед резолвом**. Дальше работает существующий однофайловый конвейер без изменений: `SymbolTable::build` видит объединённый пул символов, `to_ir` — объединённые карты. Максимальное переиспользование, минимальный blast radius.

### Шаги сборки

Дано: `primary` = `.cat`, `supporting` = `[.gst]` (в общем случае список).

1. `parse_raw(primary)` → `RawCatalogue` **A** (фракция).
2. Для каждого `supporting`: `parse_raw` → `RawCatalogue` **B** (система).
3. **Валидация привязки:** `B.id` должен равняться `A.game_system_id`.
   - не совпадает → диагностика `gameSystem.mismatch` (файл всё равно сливается — пользователь выбрал его явно, а диагностика делает несоответствие громким);
   - у `A` нет `gameSystemId` (пусто) → диагностика `gameSystem.unverified`, сливаем.
4. **Слияние B → A** (новый шаг `merge_supporting`):
   - `A.shared_entries` += `B.shared_entries`, `A.shared_groups` += `B.shared_groups` — с де-дупом по id верхнего уровня (см. ниже);
   - `A.cost_types`, `A.categories` — объединение (union), при коллизии ключа выигрывает **primary** (детерминизм; в реальных данных пространства GUID не пересекаются);
   - `A.force_entries` += `B.force_entries` — форс-орг системы;
   - `A.entries` / `A.entry_links` **не** трогаем — эмитим корни фракции, не системы;
   - `A.catalogue_links` не трогаем (не используется в P0-b; остаток → P0-c).
5. `resolve_with_diags(A)` — объединённая `SymbolTable` резолвит 609 межфайловых ссылок; остаток ~53 → `entryLink.unresolved` (как раньше).
6. `to_ir(A)` → `entries` = корни фракции (полностью вложены), `force_constraints` = из объединённых `force_entries` (форс-орг!), имена очков резолвятся через объединённые `cost_types`.

### Де-дуп id при слиянии

`SymbolTable::build` жёстко падает (`MalformedXml`) на дубликат id. Чтобы межфайловое пересечение не роняло весь парс (наш инвариант «никогда не падать на реальных данных»):

- **Внутрифайловый** дубликат id остаётся жёсткой типизированной ошибкой (malformed-вход) — не меняем.
- **Межфайловый** дубликат id **верхнего уровня** shared-сущностей: при слиянии пропускаем сущность из `B`, оставляем определение `primary`, эмитим диагностику `symbol.duplicate_cross_file`. Реализуется отслеживанием множества уже виденных top-level id при `extend`.
- Более глубокие (вложенные) межфайловые коллизии id всплывут из `SymbolTable::build` как жёсткая типизированная ошибка — это допустимо: в реальном BSData id — глобальные GUID, а два файла, определяющие один вложенный id, патологичны.

## Публичный API

Зеркалит существующие `parse_bytes` / `parse_file`.

```rust
/// Собрать основной каталог (.cat) с его вспомогательными файлами (.gst) в
/// один оценимый IrCatalogue. Вспомогательные сливаются в общий пул символов и
/// карты перед резолвом. В P0-b `supporting` — ровно один .gst, но список
/// оставлен на вырост (P0-c добавит catalogueLink-библиотеки, тем же слиянием).
pub fn parse_system(
    primary: (&[u8], bool),          // (байты, is_zip) основного .cat
    supporting: &[(&[u8], bool)],    // вспомогательные .gst
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError>;

/// Файловый вариант для CLI: zip по расширению (.gst/.gstz/.cat/.catz),
/// опциональный дедлайн парсинга (как parse_file).
pub fn parse_system_files(
    primary: &Path,
    supporting: &[&Path],
    deadline: Option<Duration>,
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError>;
```

Существующие `parse_bytes` / `parse_file` (одиночный путь) остаются без изменений.

## Что меняется в коде

- **`src/raw/merge.rs`** (новый): `merge_supporting(primary: &mut RawCatalogue, supporting: RawCatalogue, diags: &mut Vec<Diagnostic>)` — слияние по шагу 4 выше + де-дуп + диагностики привязки. Плюс тонкая обёртка проверки `gameSystemId`.
- **`src/lib.rs`**: `parse_system`, `parse_system_files` — парсят все входы, зовут `merge_supporting` по каждому вспомогательному, затем существующие `resolve_with_diags` + `to_ir`.
- **Домен (`@muster/domain`) и `engine-eval` — НЕ трогаем.** Форма IR (`entries` + `force_constraints` + `game_system_id`) уже всё вмещает; движок уже оценивает force_constraints и очки. P0-b — только парсер.

## Тесты

- **Юнит (`merge.rs`):** два синтетических `RawCatalogue` → слияние; проверить union `cost_types`/`categories`, конкатенацию `force_entries`, де-дуп верхнего уровня с диагностикой `symbol.duplicate_cross_file`, диагностики `gameSystem.mismatch`/`unverified`.
- **Интеграция (`tests/multi_file.rs`, новый):** маленькая синтетическая пара XML — `.gst` с shared-сущностью и `forceEntry`, `.cat` с корневым `entryLink` в сущность, живущую **только в `.gst`**. `parse_system` → в IR: корень полностью вложен с ребёнком из `.gst`, `force_constraints` из `forceEntry` системы, имя очков резолвнуто из costType системы. Плюс кейс `gameSystem.mismatch`. Плюс однофайловый путь: golden `mini40k` байт-в-байт не меняется.
- **Ручная проверка (scratchpad, не в git):** реальные `Space Marines.cat` + `Warhammer 40,000.gst` → danglers падают 390 → ~53, корней по-прежнему 130, `force_constraints` заполнены, парс не падает.

## Риск реализации: капы резолва

Полный резолв фракции вкладывает ~609 доп. поддеревьев и может упереться в `MAX_RESOLVED_NODES` (5M) или `MAX_RESOLVE_DEPTH` (256). Правило (не молчаливый обрыв): измерить на реальной паре SM+gst; если кап пробит — это настоящий сигнал (ростер реально большой), поднять кап до измеренного значения с запасом, а не тихо обрезать. Проверить в первой же задаче плана, где резолвится реальный файл.

## Definition of Done

- `parse_system` / `parse_system_files` собирают `.cat`+`.gst` в один `IrCatalogue`.
- Реальный SM+gst: межфайловые ссылки резолвятся (danglers 390 → ~53), корней 130, `force_constraints` из системы, имена очков не пустые, без паники.
- Остаток (`catalogueLink`-библиотеки, ~53 ссылки; 2 категории; 3 costType) — по-прежнему громко диагностируется (`entryLink.unresolved`) → P0-c.
- Golden `mini40k` (однофайловый путь) байт-в-байт не изменился; домен и `engine-eval` не тронуты.

## Post-implementation note (2026-07-11): числа danglers были ошибочны

Реализация выполнена и верна, но **разведочная оценка «`.gst` закрывает 609 entryLink-danglers» оказалась неверной**. Замер на реальной паре SM+gst (`parse_system_files`):

- корней **132** (было 130); `force_constraints` **0 → 2** (форс-орг из `.gst` ✅); пустых имён очков **1 из 365** (очки резолвятся ✅); паники/пробитых капов нет ✅;
- danglers `entryLink.unresolved`: **385 вхождений / 48 уникальных целей** (почти без изменений от 390). Разбор 48 уникальных: **37** не определены в `.cat`+`.gst` → sibling-библиотеки (`catalogueLink`) = **P0-c**; **11** — это `selectionEntryGroup`, которые резолвер не берёт **структурно** (`SymbolTable` индексирует только entries, не id групп) — отдельный пробел, не связанный с мультифайлом.

Итог: **содержательная цель P0-b достигнута** — реальная армия получила очки и форс-орг из `.gst`. Вклад `.gst` — именно карты/очки/форс-орг, а не закрытие entryLink-ссылок. Оставшиеся danglers требуют P0-c (37, библиотеки) и отдельного слайса «entryLink → selectionEntryGroup» (11). См. [[real-catalogue-recon]].
