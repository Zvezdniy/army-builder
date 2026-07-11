# P0-d: резолюция `entryLink` → `selectionEntryGroup` — дизайн

**Дата:** 2026-07-11
**Статус:** утверждён (brainstorming), готов к плану
**Предшественники:** [P0-b мультифайл](2026-07-11-p0b-multi-file-assembly-design.md) (СДЕЛАНО), [разведка](2026-07-11-real-catalogue-recon.md)
**Примечание нумерации:** `P0-c` зарезервирован под sibling-библиотеки (`catalogueLink`); этот слайс — `P0-d`.

## Проблема

Проверка P0-b на реальном SM+gst вскрыла: из 48 уникальных нерезолвнутых `entryLink` **11 указывают на `selectionEntryGroup`** (группы выбора оружия/снаряжения внутри юнитов). Резолвер их не берёт: символьная таблица индексирует только **entries** (`SymbolTable::build` → `HashMap<id, RawEntry>`), а обе ветки резолва (`resolve_entry`, `resolve_group`) ищут цель ссылки только через `symbols.entry(id)`. Цель-группа не находится → `entryLink.unresolved` + drop. Итог: юниты теряют часть групп выбора («выбери 1 из N»), которые движок умел бы проверять.

Пробел структурный, не связан с мультифайлом — проявляется и на одиночном `.cat`.

## Границы (согласовано)

**В scope:** **вложенные** `entryLink type="selectionEntryGroup"` (внутри юнита или группы) — реальный случай опций юнитов.

**Вне scope (осознанно):**
- **Корень-группа** (top-level `entryLink` каталога на группу) — остаётся диагностированным. Выходит бесплатно: ветка surfacing'а корней (`resolve_with_caps`, root-expansion loop) ищет только `symbols.entry(...)`, поэтому группо-корень не находится → `entryLink.unresolved`, как сейчас. В IR у корня-группы нет места (`IrCatalogue.entries: Vec<IrEntry>`), не изобретаем.
- Группо-ссылка в ещё не загруженную библиотеку → остаётся `entryLink.unresolved` (P0-c).
- Никаких новых лимитов/скоупов групп — choose-N уже покрыт; здесь только «доставить» группу до маппинга.

## Подход

Три локальных изменения в резолвере; низ по течению не трогаем.

### 1. Символьная таблица индексирует группы

`SymbolTable` получает второй индекс `groups: HashMap<String, RawGroup>`. Обходы `walk_entry`/`walk_group` дополнительно вставляют **id группы → RawGroup** (для каждой top-level shared-группы и каждой вложенной). Новый аксессор `SymbolTable::group(&id) -> Option<&RawGroup>`.

Дубликаты: внутрифайловый дубликат id **группы** → та же жёсткая `ParseError::MalformedXml`, что и для entries (консистентно; id — глобальные GUID). Пространства id entries и групп раздельны (разные HashMap); коллизия entry-id ↔ group-id патологична и игнорируется.

### 2. Резолвер различает тип ссылки

`RawEntryLink` уже несёт `link_type` (атрибут `type` из XML). Обе ветки резолва диспатчат по нему:
- `link_type == "selectionEntryGroup"` → искать в `symbols.group(id)`; при попадании — cycle-check + рекурсивный `resolve_group(target)` + положить результат в `.groups` владельца;
- иначе (`selectionEntry` и всё прочее) → текущее поведение: `symbols.entry(id)` → `resolve_entry` → в `children`.

`link_type` в BSData авторитетен — берём его как истину. Если по типу цель не найдена (нет в соответствующем индексе) → `entryLink.unresolved` + drop; **без** перекрёстного фолбэка на другой индекс (честнее и проще; несуществующая цель = библиотека/опечатка = диагностика).

Общий cycle-guard (`path: HashSet<String>`), бюджет узлов и лимит глубины — те же, что для entries (id групп и entries лежат в одном `path`; GUID'ы не пересекаются, ложных циклов нет). Группо-ссылка в цикл → `ParseError::ReferenceCycle`, как для entries.

**Рефактор:** сейчас циклы по `entry.entry_links` в `resolve_entry` и `group.entry_links` в `resolve_group` идентичны. Выносим разбор одной ссылки в общий хелпер, например:

```rust
fn resolve_link(
    link: &RawEntryLink, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize,
    children: &mut Vec<RawEntry>, groups: &mut Vec<RawGroup>,
) -> Result<(), ParseError>
```

который по `link_type` кладёт результат в `children` **или** `groups`. Оба места (`resolve_entry`, `resolve_group`) зовут его в своих циклах по ссылкам.

### 3. Низ по течению — даром

Как только резолвнутая группа попадает в `entry.groups` (или `group.groups`), существующий `map_entry`/`map_group` (`ir/map.rs`) сам делает `IrGroup { choose-N constraints }` и флэттит членов в `children`, а `engine-eval` (`checkGroupConstraint`) уже это проверяет. **IR, домен и `engine-eval` не трогаем.**

## Тесты

- **Юнит (`resolve/links.rs`):**
  - юнит с `entryLink type="selectionEntryGroup"` в shared-группу → резолвнутый юнит имеет эту группу в `.groups` с членами внутри (ассерт по имени/членам);
  - группо-ссылка в цикл (группа ссылается назад на владельца) → `ParseError::ReferenceCycle`;
  - обычная `entryLink type="selectionEntry"` по-прежнему уходит в `children` (диспатч не сломал старое);
  - `entryLink type="selectionEntryGroup"` на отсутствующую цель → `entryLink.unresolved` + drop.
- **Юнит (`resolve/symbols.rs`):** `SymbolTable::group(id)` находит и top-level shared-группу, и вложенную; дубликат id группы → `MalformedXml`.
- **Интеграция (`tests/multi_file.rs`):** юнит ссылается `type="selectionEntryGroup"` на группу, живущую **только в `.gst`** → после `parse_system` у юнита есть `IrGroup` с лимитом «выбери N» (сквозь слияние + резолв + маппинг).
- **Golden `mini40k`:** байт-в-байт не меняется (в нём нет группо-ссылок).

## Объём (blast radius)

- `packages/engine-parser/src/resolve/symbols.rs` — индекс групп + аксессор.
- `packages/engine-parser/src/resolve/links.rs` — общий хелпер `resolve_link` + диспатч по `link_type`.
- Домен, `engine-eval`, `ir/map.rs` — **не трогаем**.

## Проверка результата (точка оценки заказчика)

После реализации — обновить инспектор реального вывода (`unit_inspector`, приватный Artifact) до **«до/после»**: показать на реальных юнитах SM те группы выбора, что сейчас выпадают, появившимися как плашки выбора. Заказчик оценивает работающий результат, а не спеку.

## Definition of Done

- Вложенные `entryLink type="selectionEntryGroup"` внутри юнитов резолвятся; юниты получают свои `IrGroup` с работающими лимитами выбора.
- Реальный SM+gst: 11 из 48 уникальных `selectionEntryGroup`-danglers → **0**; остаются только 37 библиотечных (`catalogueLink` → P0-c); форс-орг/очки как были.
- Golden `mini40k` байт-в-байт не изменился; домен и `engine-eval` не тронуты; капы держат (та же общая логика бюджета/глубины/цикла).
