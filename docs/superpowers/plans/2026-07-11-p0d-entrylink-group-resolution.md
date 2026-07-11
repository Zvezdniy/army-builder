# P0-d: резолюция `entryLink` → `selectionEntryGroup` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Научить резолвер брать `entryLink`, указывающий на `selectionEntryGroup`, и вкладывать группу как группу — чтобы юниты получали свои группы выбора оружия («выбери N»).

**Architecture:** Символьная таблица начинает индексировать группы (id → RawGroup) параллельно с entries. Разбор одной ссылки выносится в общий хелпер `resolve_link`, который по `link_type` кладёт результат либо в `children` (юнит), либо в `.groups` (группа). Низ по течению (`ir/map.rs`, домен, `engine-eval`) — без изменений; готовая choose-N машинерия подхватывает вложенную группу сама.

**Tech Stack:** Rust (crate `engine-parser`), quick-xml, serde; тесты `cargo test`.

## Global Constraints

- `#![forbid(unsafe_code)]` — без unsafe.
- Инвариант «никогда не считать неправильно»: неразрешимое → громкая `Diagnostic` + drop, никогда молча/выдумано.
- Диспатч строго по `link_type` (`type` из XML); при промахе по нужному индексу → `entryLink.unresolved` + drop, **без** перекрёстного фолбэка на другой индекс.
- Внутрифайловый дубликат id группы → жёсткая `ParseError::MalformedXml` (как для entries).
- Общий cycle-guard/бюджет/глубина — те же, что для entries; группо-ссылка в цикл → `ParseError::ReferenceCycle`.
- Форма IR не меняется; **не трогать** `packages/domain`, `packages/engine-eval`, `src/ir/map.rs`.
- Golden `mini40k` (`tests/golden.rs`) — байт-в-байт идентичен.
- Границы: только **вложенные** группо-ссылки. Top-level `entryLink` каталога на группу остаётся `entryLink.unresolved` (ветка surfacing'а корней ищет только entries — не менять её).
- Код, идентификаторы, коммит-сообщения — на английском.

---

## Файловая структура

- **Modify:** `packages/engine-parser/src/resolve/symbols.rs` — второй индекс `groups` + аксессор `group()`; обходы вставляют id групп.
- **Modify:** `packages/engine-parser/src/resolve/links.rs` — хелпер `resolve_link` + замена двух циклов по ссылкам на его вызов.
- **Modify:** `packages/engine-parser/tests/multi_file.rs` — интеграционный тест группо-ссылки в `.gst`.

Все команды — из `packages/engine-parser/`.

---

## Task 1: `SymbolTable` индексирует группы

**Files:**
- Modify: `packages/engine-parser/src/resolve/symbols.rs`

**Interfaces:**
- Consumes: `RawCatalogue`, `RawEntry`, `RawGroup`, `ParseError` (существуют).
- Produces: `SymbolTable::group(&self, id: &str) -> Option<&RawGroup>` (новый метод); `SymbolTable::build` теперь также индексирует группы. `entry()` не меняется.

- [ ] **Step 1: Заменить содержимое `symbols.rs` (индекс групп + тесты)**

Полное новое содержимое `packages/engine-parser/src/resolve/symbols.rs`:

```rust
use std::collections::HashMap;

use crate::error::ParseError;
use crate::raw::{RawCatalogue, RawEntry, RawGroup};

/// Symbol table indexing all shared entries and groups (and their nested
/// entries/groups) by id. Entries resolve `selectionEntry` links; groups resolve
/// `selectionEntryGroup` links.
#[derive(Debug)]
pub struct SymbolTable {
    entries: HashMap<String, RawEntry>,
    groups: HashMap<String, RawGroup>,
}

impl SymbolTable {
    /// Build a symbol table from a raw catalogue, indexing all shared entries and
    /// groups and their nested entries/groups by id. Returns an error on any
    /// duplicate entry id or duplicate group id.
    pub fn build(cat: &RawCatalogue) -> Result<SymbolTable, ParseError> {
        let mut entries = HashMap::new();
        let mut groups = HashMap::new();

        for entry in &cat.shared_entries {
            walk_entry(entry, &mut entries, &mut groups)?;
        }
        for group in &cat.shared_groups {
            walk_group(group, &mut entries, &mut groups)?;
        }

        Ok(SymbolTable { entries, groups })
    }

    /// Look up an entry by id (selectionEntry link target).
    pub fn entry(&self, id: &str) -> Option<&RawEntry> {
        self.entries.get(id)
    }

    /// Look up a group by id (selectionEntryGroup link target).
    pub fn group(&self, id: &str) -> Option<&RawGroup> {
        self.groups.get(id)
    }
}

/// Recursively walk an entry and all its nested entries/groups, inserting each
/// entry into `entries` and each group into `groups`. Errors on a duplicate id.
fn walk_entry(
    entry: &RawEntry,
    entries: &mut HashMap<String, RawEntry>,
    groups: &mut HashMap<String, RawGroup>,
) -> Result<(), ParseError> {
    if entries.contains_key(&entry.id) {
        return Err(ParseError::MalformedXml(format!(
            "Duplicate entry id in catalogue: {}",
            entry.id
        )));
    }
    entries.insert(entry.id.clone(), entry.clone());

    for nested_entry in &entry.entries {
        walk_entry(nested_entry, entries, groups)?;
    }
    for group in &entry.groups {
        walk_group(group, entries, groups)?;
    }

    Ok(())
}

/// Recursively walk a group: index the group itself by id, then recurse into its
/// nested entries/groups. Errors on a duplicate group id. Groups with an empty id
/// (not link-addressable) are indexed-skipped but still recursed.
fn walk_group(
    group: &RawGroup,
    entries: &mut HashMap<String, RawEntry>,
    groups: &mut HashMap<String, RawGroup>,
) -> Result<(), ParseError> {
    if !group.id.is_empty() {
        if groups.contains_key(&group.id) {
            return Err(ParseError::MalformedXml(format!(
                "Duplicate group id in catalogue: {}",
                group.id
            )));
        }
        groups.insert(group.id.clone(), group.clone());
    }

    for entry in &group.entries {
        walk_entry(entry, entries, groups)?;
    }
    for nested_group in &group.groups {
        walk_group(nested_group, entries, groups)?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str) -> RawEntry {
        RawEntry { id: id.into(), entry_type: "upgrade".into(), ..Default::default() }
    }
    fn group(id: &str) -> RawGroup {
        RawGroup { id: id.into(), ..Default::default() }
    }

    #[test]
    fn indexes_top_level_and_nested_groups() {
        let mut nested = group("g.nested");
        nested.entries.push(entry("e.in.group"));
        let mut shared = entry("e.shared");
        shared.groups.push(group("g.in.entry"));
        let cat = RawCatalogue {
            id: "c".into(),
            shared_entries: vec![shared],
            shared_groups: vec![nested],
            ..Default::default()
        };
        let st = SymbolTable::build(&cat).unwrap();
        assert!(st.group("g.nested").is_some(), "top-level shared group indexed");
        assert!(st.group("g.in.entry").is_some(), "group nested in an entry indexed");
        assert!(st.entry("e.in.group").is_some(), "entry nested in a group still indexed");
        assert!(st.entry("e.shared").is_some());
        assert!(st.group("nope").is_none());
    }

    #[test]
    fn duplicate_group_id_is_malformed() {
        let cat = RawCatalogue {
            id: "c".into(),
            shared_groups: vec![group("dup"), group("dup")],
            ..Default::default()
        };
        assert!(matches!(SymbolTable::build(&cat), Err(ParseError::MalformedXml(_))));
    }
}
```

- [ ] **Step 2: Прогнать тесты модуля**

Run: `cargo test symbols::tests`
Expected: `indexes_top_level_and_nested_groups`, `duplicate_group_id_is_malformed` — PASS.

- [ ] **Step 3: Прогнать весь набор — резолв/golden не сломаны**

Run: `cargo test`
Expected: всё PASS (новый индекс групп не меняет резолв-вывод; golden байт-в-байт).

- [ ] **Step 4: Commit**

```bash
git add packages/engine-parser/src/resolve/symbols.rs
git commit -m "feat(parser): SymbolTable indexes groups by id"
```

---

## Task 2: резолвер вкладывает группо-ссылки

**Files:**
- Modify: `packages/engine-parser/src/resolve/links.rs`
- Modify: `packages/engine-parser/tests/multi_file.rs`

**Interfaces:**
- Consumes: `SymbolTable::{entry, group}` (Task 1), `resolve_entry`, `resolve_group`, `Budget`, `unresolved_link_diag`, `RawEntryLink` (существуют).
- Produces: приватный `resolve_link(...)`; поведение: `entryLink type="selectionEntryGroup"` → в `.groups`, иначе → в `children`.

- [ ] **Step 1: Написать падающий интеграционный тест группо-ссылки**

Добавить в конец `packages/engine-parser/tests/multi_file.rs` (файл уже импортирует `use engine_parser::parse_system;`):

```rust
// A unit whose entryLink points at a selectionEntryGroup that lives only in the
// .gst. After assembly the unit must carry that group as an IrGroup with its
// choose-N limit, and the group's members must be flattened into the unit's
// children. This is the P0-d capability: resolving group-targeted entryLinks.
const CAT_GRP: &[u8] = br#"<?xml version="1.0"?>
<catalogue id="cat.g" name="FactionG" revision="1" gameSystemId="sys.gg"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.unit" name="Squad" type="unit">
      <costs><cost name="pts" typeId="ct.pts" value="100"/></costs>
      <entryLinks>
        <entryLink id="l.wpn" name="Weapon" type="selectionEntryGroup" targetId="g.weapon"/>
      </entryLinks>
    </selectionEntry>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="root.unit" name="Squad" type="selectionEntry" targetId="e.unit"/>
  </entryLinks>
</catalogue>"#;

const GST_GRP: &[u8] = br#"<?xml version="1.0"?>
<gameSystem id="sys.gg" name="GameG" revision="1"
            xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
  <costTypes><costType id="ct.pts" name="Points"/></costTypes>
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="g.weapon" name="Weapon">
      <constraints>
        <constraint id="c.w.min" type="min" value="1" field="selections" scope="parent"/>
        <constraint id="c.w.max" type="max" value="1" field="selections" scope="parent"/>
      </constraints>
      <selectionEntries>
        <selectionEntry id="e.bolter" name="Bolter" type="upgrade"/>
        <selectionEntry id="e.plasma" name="Plasma" type="upgrade"/>
      </selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
</gameSystem>"#;

#[test]
fn resolves_group_targeted_entrylink() {
    let (ir, diags) = parse_system((CAT_GRP, false), &[(GST_GRP, false)]).unwrap();
    let unit = ir.entries.iter().find(|e| e.id == "e.unit").expect("unit root surfaced");
    // The gst-only group is inlined as an IrGroup with its choose-1 limit.
    let wg = unit.groups.iter().find(|g| g.name == "Weapon").expect("group-linked group inlined");
    assert!(wg.constraints.iter().any(|c| c.type_ == "max" && c.value == 1.0), "choose-max present");
    assert!(wg.member_entry_ids.iter().any(|id| id == "e.bolter"), "members recorded on the group");
    // Members are flattened into the unit's children (existing map behaviour).
    assert!(unit.children.iter().any(|c| c.id == "e.bolter"), "member flattened into children");
    // Nothing dangling: the group target resolved.
    assert!(!diags.iter().any(|d| d.code == "entryLink.unresolved"), "no unresolved links: {:?}", diags);
}
```

- [ ] **Step 2: Прогнать тест — должен упасть (группо-ссылка не резолвится)**

Run: `cargo test --test multi_file resolves_group_targeted_entrylink`
Expected: FAIL — `unit.groups` пуст (группа не вложена) → паника на `.expect("group-linked group inlined")`; в диагностиках `entryLink.unresolved` для `g.weapon`.

- [ ] **Step 3: Добавить хелпер `resolve_link` в `links.rs`**

Вставить новую функцию сразу после `unresolved_link_diag` (перед `fn resolve_entry`):

```rust
/// Resolve one entryLink into either a child entry or an inlined group,
/// dispatching on the link's declared target type. A `selectionEntryGroup` target
/// is looked up in the group index and pushed to `groups`; anything else is an
/// entry, looked up in the entry index and pushed to `children`. An unresolvable
/// target (absent from the index its type names) is diagnosed and dropped — never
/// cross-resolved against the other index. A link into a node already on the path
/// is a reference cycle. The node budget/depth cap are shared with entry resolution.
fn resolve_link(
    link: &RawEntryLink, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize,
    children: &mut Vec<RawEntry>, groups: &mut Vec<RawGroup>,
) -> Result<(), ParseError> {
    if link.link_type == "selectionEntryGroup" {
        let target = match symbols.group(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); return Ok(()); }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved = resolve_group(target, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        groups.push(resolved);
    } else {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); return Ok(()); }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved = resolve_entry(target, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        children.push(resolved);
    }
    Ok(())
}
```

Also add `RawEntryLink` to the `use crate::raw::{...}` import at the top of the file (it currently imports `RawCatalogue, RawEntry, RawGroup`; add `RawEntryLink`).

- [ ] **Step 4: Заменить цикл по ссылкам в `resolve_entry`**

В `resolve_entry` заменить этот блок:

```rust
    for link in &entry.entry_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved_target = resolve_entry(target, &symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        children.push(resolved_target);
    }
```

на:

```rust
    for link in &entry.entry_links {
        resolve_link(link, symbols, path, budget, diags, depth, &mut children, &mut groups)?;
    }
```

(Примечание: в исходнике вызов может быть `resolve_entry(target, symbols, ...)` без `&` — заменяемый блок целиком удаляется, так что точный вид неважен; ориентируйся на «цикл `for link in &entry.entry_links` внутри `resolve_entry`».)

- [ ] **Step 5: Заменить цикл по ссылкам в `resolve_group`**

В `resolve_group` заменить этот блок:

```rust
    for link in &group.entry_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        children.push(resolve_entry(target, symbols, path, budget, diags, depth + 1)?);
        path.remove(&link.target_id);
    }
```

на:

```rust
    for link in &group.entry_links {
        resolve_link(link, symbols, path, budget, diags, depth, &mut children, &mut groups)?;
    }
```

(`children` и `groups` — локальные `Vec`, уже объявленные выше в `resolve_group`; `out.groups = groups` в конце функции сохраняет добавленные группо-ссылками.)

- [ ] **Step 6: Добавить целевые юнит-тесты резолва в `links.rs`**

В модуле `#[cfg(test)] mod tests` в `links.rs` добавить (рядом с существующими; хелперы `link`/`entry` там уже есть — `link(target)` создаёт `RawEntryLink` с пустым `link_type`, т.е. entry-типа):

```rust
    fn group_link(target: &str) -> RawEntryLink {
        RawEntryLink { target_id: target.to_string(), link_type: "selectionEntryGroup".to_string() }
    }

    #[test]
    fn group_targeted_link_inlines_a_group() {
        // A shared group g0 with one member; an entry links it as a group.
        let mut g0 = RawGroup { id: "g0".into(), name: "Opt".into(), ..Default::default() };
        g0.entries.push(entry("m0", vec![]));
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("g0")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(),
            entries: vec![owner],
            shared_groups: vec![g0],
            ..Default::default()
        };
        let resolved = resolve(cat).unwrap();
        let owner = resolved.entries.iter().find(|e| e.id == "owner").unwrap();
        assert_eq!(owner.groups.len(), 1, "group inlined into .groups, not children");
        assert_eq!(owner.groups[0].id, "g0");
        assert!(owner.groups[0].entries.iter().any(|m| m.id == "m0"));
        assert!(owner.entries.is_empty(), "group did not leak into children");
    }

    #[test]
    fn group_targeted_link_missing_is_diagnosed() {
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("g.absent")], ..Default::default()
        };
        let cat = RawCatalogue { id: "c".into(), entries: vec![owner], ..Default::default() };
        let mut diags = Vec::new();
        let resolved = resolve_with_diags(cat, &mut diags).unwrap();
        assert!(resolved.entries[0].groups.is_empty());
        assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("g.absent")));
    }

    #[test]
    fn group_targeted_link_into_cycle_is_typed_error() {
        // Group g0 contains an entry that links back to g0 as a group → cycle.
        let mut g0 = RawGroup { id: "g0".into(), ..Default::default() };
        g0.entries.push(RawEntry {
            id: "inner".into(), entry_type: "upgrade".into(),
            entry_links: vec![group_link("g0")], ..Default::default()
        });
        let owner = RawEntry {
            id: "owner".into(), entry_type: "unit".into(),
            entry_links: vec![group_link("g0")], ..Default::default()
        };
        let cat = RawCatalogue {
            id: "c".into(), entries: vec![owner], shared_groups: vec![g0], ..Default::default()
        };
        assert!(matches!(resolve(cat), Err(ParseError::ReferenceCycle(_))));
    }
```

Note: these tests use `resolve`, `resolve_with_diags`, `RawCatalogue`, `RawEntry`, `RawGroup`, `RawEntryLink`, `ParseError` — confirm the test module imports cover them (it already uses `super::*` plus `crate::raw::RawEntryLink`; add `RawGroup`/`RawCatalogue`/`RawEntry` imports if the module doesn't already bring them via `super::*`). The existing helper `entry(id, links)` builds a `RawEntry` with `entry_links: links`.

- [ ] **Step 7: Прогнать целевые тесты — должны пройти**

Run: `cargo test --test multi_file resolves_group_targeted_entrylink && cargo test links::tests`
Expected: интеграционный тест и три юнит-теста резолва — PASS.

- [ ] **Step 8: Весь набор — golden цел, ничего не сломано**

Run: `cargo test`
Expected: всё PASS, включая `tests/golden.rs` и `tests/multi_file.rs`.

- [ ] **Step 9: Commit**

```bash
git add packages/engine-parser/src/resolve/links.rs packages/engine-parser/tests/multi_file.rs
git commit -m "feat(parser): resolve selectionEntryGroup-targeted entryLinks into groups"
```

---

## Task 3: проверка на реальной паре + инспектор «до/после» (ручная, вне git)

**Files:** нет коммитов кода (данные и одноразовые примеры в git не идут).

Реальные `Imperium - Space Marines.cat` + `Warhammer 40,000.gst` — в scratchpad (`bsdata/`), не в git. Это проверка DoD и точка оценки заказчиком.

- [ ] **Step 1: Замерить danglers на реальной паре**

Написать одноразовый `packages/engine-parser/examples/real_pair.rs` (пути — аргументами), считающий уникальные `entryLink.unresolved` цели и разбивающий их на «определены как `selectionEntryGroup` в cat+gst» vs «не определены (библиотеки)». Запустить:

`cargo run --example real_pair -- "<scratchpad>/bsdata/Imperium - Space Marines.cat" "<scratchpad>/bsdata/Warhammer 40,000.gst"`

Expected (сверить с DoD): **уникальных danglers-групп → 0** (было 11); остаётся ~37 библиотечных; корни/очки/форс-орг как в P0-b (roots≈132, force_constraints=2), без паники. Если реальная группо-цель не резолвится — расследовать (частый корень: `link_type` в данных не ровно `selectionEntryGroup`, а, скажем, пустой — тогда уточнить диспатч и зафиксировать в спеке).

- [ ] **Step 2: Обновить инспектор до «до/после»**

Пересобрать приватный Artifact `unit_inspector` (см. предыдущий инспектор в scratchpad): на реальных юнитах показать группы выбора, которые до слайса выпадали, а теперь появляются как плашки «выбери N». Дать заказчику ссылку — это его точка оценки working result.

- [ ] **Step 3: Убрать одноразовый пример**

`rm packages/engine-parser/examples/real_pair.rs`. Данные и пример в git не идут. Кода-коммита у Task 3 нет.

---

## Self-Review

**Покрытие спеки:**
- Индекс групп в `SymbolTable` + аксессор — Task 1, тест `indexes_top_level_and_nested_groups`; дубликат группы — `duplicate_group_id_is_malformed`.
- Диспатч по `link_type`, вкладывание группы в `.groups`, drop при промахе без фолбэка — Task 2, `resolve_link` + тесты `group_targeted_link_*`.
- Cycle-guard на группо-ссылке — Task 2, `group_targeted_link_into_cycle_is_typed_error`.
- Обычная entry-ссылка не сломана — покрыто существующими тестами резолва + golden (Task 2 Step 8).
- Сквозной результат (юнит получает `IrGroup` из `.gst`) — Task 2, `resolves_group_targeted_entrylink`.
- Границы (top-level группо-корень не сурфейсится) — не меняем root-expansion loop; остаётся `entryLink.unresolved` (Global Constraints).
- Домен/engine-eval/map.rs не тронуты; golden цел — Task 2 Step 8.
- DoD на реальных данных (11→0) + точка оценки — Task 3.

**Плейсхолдеры:** нет — весь код приведён; заменяемые блоки в Task 2 показаны дословно.

**Согласованность типов:** `resolve_link(&RawEntryLink, &SymbolTable, &mut HashSet<String>, &mut Budget, &mut Vec<Diagnostic>, usize, &mut Vec<RawEntry>, &mut Vec<RawGroup>) -> Result<(), ParseError>` — одна сигнатура в Task 2 (Produces + определение + оба вызова). `SymbolTable::group(&str) -> Option<&RawGroup>` — одна в Task 1 (Produces + определение) и в Task 2 (`resolve_link`). Коды диагностик (`entryLink.unresolved`, `group.constraint_dropped`) и поля IR (`groups`, `member_entry_ids`, `type_`, `value`) сверены с `ir/map.rs`.

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-07-11-p0d-entrylink-group-resolution.md`. Два варианта исполнения:

1. **Subagent-Driven (рекомендую)** — свежий сабагент на задачу, ревью между задачами.
2. **Inline Execution** — задачи в этой сессии через executing-plans, чекпойнты.

Какой подход?
