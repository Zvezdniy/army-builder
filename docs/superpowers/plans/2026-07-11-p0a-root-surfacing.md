# План реализации: P0-a — всплытие корней каталога (top-level entryLinks)

> **Для агентов-исполнителей:** ОБЯЗАТЕЛЬНАЯ ПОД-СКИЛЛ: используйте superpowers:subagent-driven-development (рекомендуется) или superpowers:executing-plans для выполнения плана задача-за-задачей. Шаги отмечены чекбоксами (`- [ ]`).

**Цель:** Научить парсер эмитить выбираемые корни реального каталога (его top-level `<entryLinks>`) в IR, попутно сделав резолв терпимым к неразрешимым ссылкам (диагностика + drop вместо жёсткой ошибки), — чтобы реальный `.cat` давал непустой IR, а не пустой «успех» и не аварию.

**Архитектура:** Три слоя парсера. (1) Сырой разбор читает каталог-левел `<entryLinks>` в новое поле `RawCatalogue.entry_links`. (2) Резолв получает канал диагностик, терпимо обрабатывает любую неразрешимую ссылку (`entryLink.unresolved` + пропуск), и разворачивает корневые линки в корневые `IrEntry` тем же инлайнингом + общими DoS-капами. (3) Маппинг не меняется; `lib.rs` протягивает диагностики резолва наружу. Домен и engine-eval не трогаем.

**Стек:** Rust (`packages/engine-parser`): serde, quick-xml, `#![forbid(unsafe_code)]`, proptest. Гейты: `cargo test`, `cargo clippy`, `cargo deny check`, `cargo audit`.

## Глобальные ограничения

Требования всего проекта, неявно входят в каждую задачу:

- **Никогда не считать неправильно / громкая неполнота.** Любая неразрешимая ссылка (корневая или вложенная) — диагностика `entryLink.unresolved` + drop, никогда не выдуманное поддерево. То, что вне среза, — видно в диагностиках, а не молчит и не роняет парс.
- **Недоверенный вход.** Разворачивание корней и терпимый резолв используют тот же общий node/depth-бюджет и path cycle-guard (`MAX_RESOLVED_NODES`, `MAX_RESOLVE_DEPTH`); крейт остаётся `#![forbid(unsafe_code)]`. Cycle/бюджет/глубина — по-прежнему жёсткие `ParseError`.
- **Контракт синхронен.** Golden `mini40k` (в нём нет каталог-левел линков и все вложенные ссылки резолвятся в файле) не меняется; `tests/golden.rs` остаётся зелёным. Домен, engine-eval, копия golden в engine-eval — не трогаем.
- **Гейты.** `cargo test`, `cargo clippy --all-targets -- -D warnings -A clippy::single_match -A clippy::while_let_loop`, `cargo deny check`, `cargo audit` — чисто. `pnpm test`/`pnpm typecheck` не затронуты.

**Команда точечного прогона:** `cd packages/engine-parser && cargo test --test <имя>` (`raw_parse`, `map`) или `cargo test resolve` (юнит-тесты в `links.rs`).

**Единый код диагностики (используется в задачах 2 и 3):** `entryLink.unresolved`, сообщение `format!("entryLink target {} not found in this file (dropped)", target_id)`.

---

## Задача 1: сырой разбор — читать каталог-левел `<entryLinks>`

**Файлы:**
- Изменить: `packages/engine-parser/src/raw/model.rs` (поле `RawCatalogue.entry_links`)
- Изменить: `packages/engine-parser/src/raw/parse.rs` (`read_catalogue` — match-арм)
- Тест: `packages/engine-parser/tests/raw_parse.rs`

**Интерфейсы:**
- Производит: `RawCatalogue.entry_links: Vec<RawEntryLink>`, заполненное прямыми детьми `<catalogue><entryLinks>`. Потребляется задачей 3 (разворачивание корней).

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `packages/engine-parser/tests/raw_parse.rs`:

```rust
#[test]
fn reads_catalogue_level_entry_links() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.unit" name="Unit" type="unit"/>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="l1" name="Unit" type="selectionEntry" targetId="e.unit"/>
    <entryLink id="l2" name="Missing" type="selectionEntry" targetId="e.missing"/>
  </entryLinks>
</catalogue>"#;
    let raw = parse_raw(xml).unwrap();
    let targets: Vec<&str> = raw.entry_links.iter().map(|l| l.target_id.as_str()).collect();
    assert_eq!(targets, vec!["e.unit", "e.missing"]);
}
```

- [ ] **Шаг 2: Прогнать — убедиться, что падает**

Запуск: `cd packages/engine-parser && cargo test --test raw_parse`
Ожидается: не компилируется (`RawCatalogue` не имеет поля `entry_links`).

- [ ] **Шаг 3: Реализация — поле модели**

В `packages/engine-parser/src/raw/model.rs`, в структуру `RawCatalogue`, после строки `pub catalogue_links: Vec<RawCatalogueLink>,` добавить:

```rust
    pub entry_links: Vec<RawEntryLink>,   // catalogue-level <entryLinks> (roster roots)
```

- [ ] **Шаг 4: Реализация — чтение в `read_catalogue`**

В `packages/engine-parser/src/raw/parse.rs`, в `read_catalogue`, среди match-армов (рядом с `b"selectionEntries" => ...`), перед веткой `other =>`, добавить:

```rust
                b"entryLinks" => read_entrylinks_into(&mut cat.entry_links, &mut r)?,
```

(`read_entrylinks_into(dst: &mut Vec<RawEntryLink>, r: &mut SafeXmlReader)` уже существует — используется для `<entryLinks>` внутри сущностей и групп.)

- [ ] **Шаг 5: Прогнать — убедиться, что проходит**

Запуск: `cd packages/engine-parser && cargo test --test raw_parse`
Ожидается: PASS (новый тест зелёный; старые тесты raw_parse зелёные).

- [ ] **Шаг 6: Коммит**

```bash
git add packages/engine-parser/src/raw packages/engine-parser/tests/raw_parse.rs
git commit -m "feat(parser): read catalogue-level <entryLinks> into RawCatalogue.entry_links"
```

---

## Задача 2: резолв — канал диагностик + терпимость к неразрешимым ссылкам

**Файлы:**
- Изменить: `packages/engine-parser/src/resolve/links.rs` (сигнатуры + терпимость + helper)
- Изменить: `packages/engine-parser/src/resolve/mod.rs` (реэкспорт `resolve_with_diags`)
- Изменить: `packages/engine-parser/src/lib.rs` (`parse_bytes` протягивает диагностики)
- Тест: `packages/engine-parser/tests/map.rs`

**Интерфейсы:**
- Потребляет: `RawCatalogue` (в т.ч. `entry_links` из Задачи 1, но разворачивание корней — Задача 3).
- Производит:
  - `pub fn resolve(cat: RawCatalogue) -> Result<RawCatalogue, ParseError>` — прежняя сигнатура сохраняется (диагностики отбрасываются), чтобы существующие вызовы в тестах не ломались.
  - `pub fn resolve_with_diags(cat: RawCatalogue, diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError>` — новый путь, отдающий диагностики; используется `lib.rs` и диагностик-тестами.
  - `unresolved_link_diag(target_id: &str) -> Diagnostic` (внутренний helper).
  - Поведение: любая вложенная неразрешимая `entryLink` → диагностика `entryLink.unresolved` + пропуск ребёнка (не `ParseError`).

- [ ] **Шаг 1: Написать падающий тест**

Добавить в `packages/engine-parser/tests/map.rs` (импорт `resolve_with_diags` появится в Шаге 4; если тест ссылается на него до реализации — это часть red-фазы):

```rust
#[test]
fn nested_unresolved_entrylink_is_tolerated() {
    // A nested entryLink whose target lives in another file must NOT crash the
    // resolve; it is diagnosed and the child dropped. This is what makes a real
    // .cat (28% of entryLinks point at the .gst) parseable.
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.unit" name="Unit" type="unit">
      <costs><cost name="Points" typeId="pts" value="10"/></costs>
      <entryLinks>
        <entryLink id="l" name="Missing" type="selectionEntry" targetId="e.missing"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let mut diags = Vec::new();
    let raw = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap(); // must NOT error
    let (ir, _d) = to_ir(&raw);
    assert!(ir.entries.iter().any(|e| e.id == "e.unit"), "unit still maps");
    assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("e.missing")),
        "dangling nested link diagnosed: {:?}", diags);
}
```

Обновить строку импорта в начале `tests/map.rs` на:

```rust
use engine_parser::{raw::parse_raw, resolve::{resolve, resolve_with_diags}, ir::to_ir};
```

- [ ] **Шаг 2: Прогнать — убедиться, что падает**

Запуск: `cd packages/engine-parser && cargo test --test map`
Ожидается: не компилируется (`resolve_with_diags` не существует).

- [ ] **Шаг 3: Реализация — переписать `links.rs`**

В `packages/engine-parser/src/resolve/links.rs`:

Заменить импорт ошибки на импорт с `Diagnostic`:

```rust
use crate::error::{Diagnostic, ParseError};
```

Заменить функции `resolve` и `resolve_with_caps` на:

```rust
/// Resolve, discarding diagnostics. Kept for callers that don't need them.
pub fn resolve(cat: RawCatalogue) -> Result<RawCatalogue, ParseError> {
    let mut diags = Vec::new();
    resolve_with_caps(cat, MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH, &mut diags)
}

/// Resolve, collecting diagnostics (unresolvable entryLinks). Used by the
/// pipeline (`parse_bytes`) so incompleteness is loud, not silent.
pub fn resolve_with_diags(cat: RawCatalogue, diags: &mut Vec<Diagnostic>)
    -> Result<RawCatalogue, ParseError> {
    resolve_with_caps(cat, MAX_RESOLVED_NODES, MAX_RESOLVE_DEPTH, diags)
}

pub(crate) fn resolve_with_caps(mut cat: RawCatalogue, max_nodes: u64, max_depth: usize,
    diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError> {
    let symbols = SymbolTable::build(&cat)?;
    let mut path: HashSet<String> = HashSet::new();
    let mut budget = Budget { nodes: 0, max_nodes, max_depth };
    let mut resolved = Vec::with_capacity(cat.entries.len());
    for e in &cat.entries {
        resolved.push(resolve_entry(e, &symbols, &mut path, &mut budget, diags, 1)?);
    }
    cat.entries = resolved;
    Ok(cat)
}

/// A dropped entryLink whose target is not in this file (root or nested).
fn unresolved_link_diag(target_id: &str) -> Diagnostic {
    Diagnostic {
        code: "entryLink.unresolved".to_string(),
        message: format!("entryLink target {} not found in this file (dropped)", target_id),
    }
}
```

Заменить `resolve_entry` на (добавлен параметр `diags`; неразрешимая ссылка → диагностика + `continue`):

```rust
fn resolve_entry(entry: &RawEntry, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize) -> Result<RawEntry, ParseError> {
    budget.check_depth(depth)?;
    budget.account()?;
    let mut out = entry.clone();
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &entry.entries {
        children.push(resolve_entry(child, symbols, path, budget, diags, depth + 1)?);
    }
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &entry.groups {
        groups.push(resolve_group(g, symbols, path, budget, diags, depth + 1)?);
    }
    for link in &entry.entry_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let resolved_target = resolve_entry(target, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        children.push(resolved_target);
    }
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}
```

Заменить `resolve_group` на (то же изменение):

```rust
fn resolve_group(group: &RawGroup, symbols: &SymbolTable, path: &mut HashSet<String>,
    budget: &mut Budget, diags: &mut Vec<Diagnostic>, depth: usize) -> Result<RawGroup, ParseError> {
    budget.check_depth(depth)?;
    budget.account()?;
    let mut out = group.clone();
    let mut children: Vec<RawEntry> = Vec::new();
    for child in &group.entries {
        children.push(resolve_entry(child, symbols, path, budget, diags, depth + 1)?);
    }
    let mut groups: Vec<RawGroup> = Vec::new();
    for g in &group.groups {
        groups.push(resolve_group(g, symbols, path, budget, diags, depth + 1)?);
    }
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
    out.entries = children;
    out.groups = groups;
    out.entry_links = Vec::new();
    Ok(out)
}
```

Обновить два юнит-теста в конце `links.rs` (они вызывают `resolve_with_caps` напрямую) — добавить аргумент `&mut Vec::new()`:

```rust
        assert!(matches!(resolve_with_caps(cat, 1000, 10_000, &mut Vec::new()), Err(ParseError::ResolvedTooLarge(_))));
```
и
```rust
        assert!(matches!(resolve_with_caps(cat, u64::MAX, 10, &mut Vec::new()), Err(ParseError::ResolveTooDeep(_))));
```

- [ ] **Шаг 4: Реализация — реэкспорт + связка `lib.rs`**

В `packages/engine-parser/src/resolve/mod.rs` заменить строку `pub use links::resolve;` на:

```rust
pub use links::{resolve, resolve_with_diags};
```

В `packages/engine-parser/src/lib.rs`, в `parse_bytes`, заменить

```rust
    let raw = crate::raw::parse_raw(&xml)?;
    let resolved = crate::resolve::resolve(raw)?;
    Ok(crate::ir::to_ir(&resolved))
```

на:

```rust
    let raw = crate::raw::parse_raw(&xml)?;
    let mut diags = Vec::new();
    let resolved = crate::resolve::resolve_with_diags(raw, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
```

- [ ] **Шаг 5: Прогнать новый тест + весь крейт**

Запуск: `cd packages/engine-parser && cargo test --test map && cargo test`
Ожидается: PASS (`nested_unresolved_entrylink_is_tolerated` зелёный; `golden`, `resolve`-юниты, `raw_parse`, proptest — зелёные; golden байт-в-байт не изменился).

- [ ] **Шаг 6: Коммит**

```bash
git add packages/engine-parser/src/resolve packages/engine-parser/src/lib.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): resolve tolerates unresolvable entryLinks (entryLink.unresolved diagnostic)"
```

---

## Задача 3: резолв — разворачивание каталог-левел корней

**Файлы:**
- Изменить: `packages/engine-parser/src/resolve/links.rs` (`resolve_with_caps` — блок разворачивания корней)
- Тест: `packages/engine-parser/tests/map.rs`

**Интерфейсы:**
- Потребляет: `RawCatalogue.entry_links` (Задача 1); терпимый резолв + `unresolved_link_diag` + канал диагностик (Задача 2).
- Производит: разрешённые корневые линки добавляются в `cat.entries` (и текут в IR через `map_entry`); висячие корни → `entryLink.unresolved`. После резолва `cat.entry_links` пуст.

- [ ] **Шаг 1: Написать падающие тесты**

Добавить в `packages/engine-parser/tests/map.rs` (импорт `ParseError` — добавить `use engine_parser::ParseError;` в начало файла отдельной строкой):

```rust
#[test]
fn surfaces_catalogue_root_entrylinks() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.captain" name="Captain" type="unit">
      <costs><cost name="Points" typeId="pts" value="90"/></costs>
      <selectionEntries>
        <selectionEntry id="e.captain.sword" name="Sword" type="upgrade"/>
      </selectionEntries>
    </selectionEntry>
    <selectionEntry id="e.squad" name="Squad" type="unit"/>
    <selectionEntry id="e.orphan" name="Orphan" type="unit"/>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="l1" name="Captain" type="selectionEntry" targetId="e.captain"/>
    <entryLink id="l2" name="Squad" type="selectionEntry" targetId="e.squad"/>
    <entryLink id="l3" name="Missing" type="selectionEntry" targetId="e.missing"/>
  </entryLinks>
</catalogue>"#;
    let mut diags = Vec::new();
    let raw = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags).unwrap();
    let (ir, map_diags) = to_ir(&raw);
    diags.extend(map_diags);
    // linked roots surface
    assert!(ir.entries.iter().any(|e| e.id == "e.captain"));
    assert!(ir.entries.iter().any(|e| e.id == "e.squad"));
    // the linked root's own subtree is inlined
    let cap = ir.entries.iter().find(|e| e.id == "e.captain").unwrap();
    assert!(cap.children.iter().any(|c| c.id == "e.captain.sword"));
    // an un-linked shared entry does NOT surface (only linked roots do)
    assert!(!ir.entries.iter().any(|e| e.id == "e.orphan"), "orphan must not surface");
    // dangling root link diagnosed
    assert!(diags.iter().any(|d| d.code == "entryLink.unresolved" && d.message.contains("e.missing")),
        "dangling root diagnosed: {:?}", diags);
}

#[test]
fn root_entrylink_into_cycle_is_typed_error() {
    let xml = br#"<?xml version="1.0"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.a" name="A" type="unit">
      <entryLinks><entryLink id="la" name="A" type="selectionEntry" targetId="e.a"/></entryLinks>
    </selectionEntry>
  </sharedSelectionEntries>
  <entryLinks><entryLink id="root" name="A" type="selectionEntry" targetId="e.a"/></entryLinks>
</catalogue>"#;
    let mut diags = Vec::new();
    let res = resolve_with_diags(parse_raw(xml).unwrap(), &mut diags);
    assert!(matches!(res, Err(ParseError::ReferenceCycle(_))), "expected cycle error, got {:?}", res);
}
```

- [ ] **Шаг 2: Прогнать — убедиться, что падают**

Запуск: `cd packages/engine-parser && cargo test --test map`
Ожидается: FAIL (`surfaces_catalogue_root_entrylinks` — корни не всплывают, `ir.entries` не содержит `e.captain`; корни ещё не разворачиваются).

- [ ] **Шаг 3: Реализация — блок разворачивания корней**

В `packages/engine-parser/src/resolve/links.rs`, в `resolve_with_caps`, заменить хвост функции

```rust
    cat.entries = resolved;
    Ok(cat)
```

на:

```rust
    cat.entries = resolved;

    // Surface catalogue-level entryLinks (roster roots) as resolved root
    // entries, reusing the same inlining, cycle-guard and shared node/depth
    // budget. Danglers (target in another file) are diagnosed and dropped —
    // never invented.
    let root_links = std::mem::take(&mut cat.entry_links);
    for link in &root_links {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); continue; }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let root = resolve_entry(target, &symbols, &mut path, &mut budget, diags, 1)?;
        path.remove(&link.target_id);
        cat.entries.push(root);
    }
    Ok(cat)
```

- [ ] **Шаг 4: Прогнать новые тесты**

Запуск: `cd packages/engine-parser && cargo test --test map`
Ожидается: PASS (`surfaces_catalogue_root_entrylinks`, `root_entrylink_into_cycle_is_typed_error`, `nested_unresolved_entrylink_is_tolerated` — зелёные; старые map-тесты зелёные).

- [ ] **Шаг 5: Полный крейт + гейты**

Запуск: `cd packages/engine-parser && cargo test && cargo clippy --all-targets -- -D warnings -A clippy::single_match -A clippy::while_let_loop && cargo deny check && cargo audit`
Ожидается: всё зелёное; golden `mini40k` байт-в-байт не изменился (нет каталог-левел линков → корней не прибавилось).

- [ ] **Шаг 6: Проверка на живом файле (ручной шаг, без коммита данных)**

```bash
cd packages/engine-parser
cargo build --release --bin muster-parse
DIR=/private/tmp/claude-502/-Users-avksentiev-Projects-army-builder/5cc503e6-7245-4304-8818-0512eadb9e43/scratchpad/bsdata
./target/release/muster-parse "$DIR/Imperium - Space Marines.cat" 2>/tmp/sm.diag >/tmp/sm.ir.json
# ожидаемо: ~130 корней в entries, множество entryLink.unresolved диагностик
python3 -c "import json;d=json.load(open('/tmp/sm.ir.json'));print('roots:',len(d['entries']))"
grep -c 'entryLink.unresolved' /tmp/sm.diag
```
Ожидаемо: `roots:` порядка **130** (было 0); счётчик `entryLink.unresolved` порядка **~690**. Файл данных в git не кладём (GW-IP-adjacent).

- [ ] **Шаг 7: Коммит**

```bash
git add packages/engine-parser/src/resolve/links.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): surface catalogue-level entryLinks as root IrEntry"
```

---

## Финальная проверка (после всех задач)

- [ ] `cd packages/engine-parser && cargo test` — зелёные (raw_parse, map, golden, resolve-юниты, proptest, security).
- [ ] `cargo clippy --all-targets -- -D warnings -A clippy::single_match -A clippy::while_let_loop` — чисто.
- [ ] `cargo deny check` и `cargo audit` — ok.
- [ ] Golden `mini40k` не изменился: `git status` не показывает правок в `tests/fixtures/golden/mini40k.ir.json`; копия в engine-eval не тронута.
- [ ] `pnpm test && pnpm typecheck` — зелёные (не затрагивались).
- [ ] Ручная проверка на живом SM `.cat`: ~130 корней, ~690 `entryLink.unresolved`.
