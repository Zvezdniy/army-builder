# P0-b: межфайловая сборка `.cat` + `.gst` — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Собрать каталог фракции (`.cat`) вместе с его игровой системой (`.gst`) в один оценимый `IrCatalogue`, чтобы межфайловые ссылки, категории, очки и форс-орг резолвились.

**Architecture:** Слить `RawCatalogue` игровой системы в `RawCatalogue` фракции ДО резолва (общий пул символов + объединённые карты), затем прогнать существующий однофайловый конвейер `resolve_with_diags` → `to_ir` без изменений. Новый публичный API `parse_system` / `parse_system_files`. Домен и `engine-eval` не трогаем.

**Tech Stack:** Rust (crate `engine-parser`), quick-xml, serde; тесты `cargo test`.

## Global Constraints

- `#![forbid(unsafe_code)]` — без unsafe.
- Инвариант «никогда не считать неправильно»: непредставимое/потерянное → громкая `Diagnostic` + drop, никогда не молча и не выдумано.
- Внутрифайловый дубликат id остаётся жёсткой `ParseError` (malformed); межфайловый top-level дубликат — диагностика + оставить primary.
- Форма IR не меняется. Домен (`packages/domain`) и `packages/engine-eval` не трогать.
- Golden `mini40k` (`tests/golden.rs`) должен остаться байт-в-байт идентичным; одиночный путь `parse_bytes`/`parse_file` — без изменений поведения.
- Диагностики — коды: `gameSystem.mismatch`, `gameSystem.unverified`, `symbol.duplicate_cross_file` (плюс существующие `entryLink.unresolved` из резолва).
- Код, идентификаторы, коммит-сообщения — на английском.

---

## Файловая структура

- **Create:** `packages/engine-parser/src/raw/merge.rs` — функция слияния `merge_supporting` + юнит-тесты.
- **Modify:** `packages/engine-parser/src/raw/mod.rs` — зарегистрировать модуль и реэкспорт.
- **Modify:** `packages/engine-parser/src/lib.rs` — `parse_system`, `parse_system_files`; вынести общие хелперы (`check_size`, `to_xml`, `read_input`), переиспользовать в существующих `parse_bytes`/`parse_file`.
- **Create:** `packages/engine-parser/tests/multi_file.rs` — интеграционный тест сквозной сборки `.cat`+`.gst`.

Все команды выполняются из `packages/engine-parser/`.

---

## Task 1: `merge_supporting` — слияние вспомогательного файла в основной

**Files:**
- Create: `packages/engine-parser/src/raw/merge.rs`
- Modify: `packages/engine-parser/src/raw/mod.rs`

**Interfaces:**
- Consumes: `RawCatalogue`, `Diagnostic` (существуют).
- Produces: `pub fn merge_supporting(primary: &mut RawCatalogue, supporting: RawCatalogue, diags: &mut Vec<Diagnostic>)` — реэкспортируется как `crate::raw::merge_supporting`.

- [ ] **Step 1: Написать модуль с падающими тестами**

Создать `packages/engine-parser/src/raw/merge.rs`:

```rust
use std::collections::HashSet;
use crate::error::Diagnostic;
use super::model::RawCatalogue;

/// Merge a supporting file (a `.gst` game system, or later a sibling library)
/// into the primary catalogue in place, so the single-file resolve/to_ir
/// pipeline sees one combined symbol pool and one set of maps. Called once per
/// supporting file, before resolve.
///
/// - Validates the supporting file is the primary's declared game system
///   (`gameSystemId`); emits a diagnostic on mismatch or when unverifiable, but
///   still merges (the caller chose these files explicitly).
/// - Extends shared entries/groups, de-duplicating TOP-LEVEL ids across files
///   (primary's definition wins; the dropped duplicate is diagnosed) so a
///   cross-file id clash never crashes SymbolTable::build. Deeper (nested)
///   cross-file id clashes remain a hard error from build — genuinely malformed.
/// - Unions cost-type and category maps (primary wins on the — unexpected — key
///   clash; real BSData ids are disjoint GUIDs).
/// - Appends the supporting file's forceEntries (the game system's force-org).
/// - Leaves the primary's entries / entry_links / catalogue_links untouched: the
///   roots we emit are the faction's, not the system's.
pub fn merge_supporting(
    primary: &mut RawCatalogue,
    supporting: RawCatalogue,
    diags: &mut Vec<Diagnostic>,
) {
    // gameSystemId binding check.
    match primary.game_system_id.as_deref() {
        Some(gs) if !gs.is_empty() => {
            if gs != supporting.id {
                diags.push(Diagnostic {
                    code: "gameSystem.mismatch".to_string(),
                    message: format!(
                        "supporting file {} is not the primary's game system {} (merged anyway)",
                        supporting.id, gs
                    ),
                });
            }
        }
        _ => diags.push(Diagnostic {
            code: "gameSystem.unverified".to_string(),
            message: format!(
                "primary has no gameSystemId; cannot verify supporting file {} (merged anyway)",
                supporting.id
            ),
        }),
    }

    // Collect existing top-level shared ids to de-dup across files.
    let mut seen: HashSet<String> = HashSet::new();
    for e in &primary.shared_entries {
        seen.insert(e.id.clone());
    }
    for g in &primary.shared_groups {
        seen.insert(g.id.clone());
    }

    for e in supporting.shared_entries {
        if seen.insert(e.id.clone()) {
            primary.shared_entries.push(e);
        } else {
            diags.push(duplicate_cross_file_diag(&e.id));
        }
    }
    for g in supporting.shared_groups {
        if seen.insert(g.id.clone()) {
            primary.shared_groups.push(g);
        } else {
            diags.push(duplicate_cross_file_diag(&g.id));
        }
    }

    // Union maps: primary wins on key clash (insert only if absent).
    for (k, v) in supporting.cost_types {
        primary.cost_types.entry(k).or_insert(v);
    }
    for (k, v) in supporting.categories {
        primary.categories.entry(k).or_insert(v);
    }

    // Append the supporting file's force-org.
    primary.force_entries.extend(supporting.force_entries);
}

fn duplicate_cross_file_diag(id: &str) -> Diagnostic {
    Diagnostic {
        code: "symbol.duplicate_cross_file".to_string(),
        message: format!(
            "shared id {} defined in multiple files; keeping the primary's (dropped the duplicate)",
            id
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::raw::{RawEntry, RawForce};
    use std::collections::HashMap;

    fn shared_entry(id: &str) -> RawEntry {
        RawEntry { id: id.to_string(), entry_type: "upgrade".into(), ..Default::default() }
    }

    #[test]
    fn unions_maps_and_appends_forces() {
        let mut primary = RawCatalogue {
            id: "cat".into(),
            game_system_id: Some("sys".into()),
            cost_types: HashMap::from([("pts".to_string(), "Points".to_string())]),
            categories: HashMap::from([("hq".to_string(), "HQ".to_string())]),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            cost_types: HashMap::from([("pl".to_string(), "Power".to_string())]),
            categories: HashMap::from([("tr".to_string(), "Troops".to_string())]),
            force_entries: vec![RawForce { id: "f1".into(), ..Default::default() }],
            shared_entries: vec![shared_entry("s.weapon")],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert_eq!(primary.cost_types.len(), 2);
        assert_eq!(primary.categories.len(), 2);
        assert_eq!(primary.force_entries.len(), 1);
        assert!(primary.shared_entries.iter().any(|e| e.id == "s.weapon"));
        assert!(diags.is_empty(), "clean merge has no diagnostics: {:?}", diags);
    }

    #[test]
    fn primary_wins_on_map_key_clash() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys".into()),
            cost_types: HashMap::from([("pts".to_string(), "PrimaryName".to_string())]),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            cost_types: HashMap::from([("pts".to_string(), "SupportingName".to_string())]),
            ..Default::default()
        };
        merge_supporting(&mut primary, supporting, &mut Vec::new());
        assert_eq!(primary.cost_types.get("pts").unwrap(), "PrimaryName");
    }

    #[test]
    fn cross_file_duplicate_shared_id_is_diagnosed_and_dropped() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys".into()),
            shared_entries: vec![shared_entry("dup")],
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys".into(),
            shared_entries: vec![shared_entry("dup"), shared_entry("fresh")],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert_eq!(primary.shared_entries.iter().filter(|e| e.id == "dup").count(), 1);
        assert!(primary.shared_entries.iter().any(|e| e.id == "fresh"));
        assert!(diags.iter().any(|d| d.code == "symbol.duplicate_cross_file" && d.message.contains("dup")));
    }

    #[test]
    fn mismatched_game_system_is_diagnosed_but_merged() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys.expected".into()),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sys.other".into(),
            shared_entries: vec![shared_entry("s")],
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert!(diags.iter().any(|d| d.code == "gameSystem.mismatch"));
        assert!(primary.shared_entries.iter().any(|e| e.id == "s"), "still merged");
    }

    #[test]
    fn missing_game_system_id_is_unverified() {
        let mut primary = RawCatalogue { id: "cat".into(), game_system_id: None, ..Default::default() };
        let supporting = RawCatalogue { id: "sys".into(), ..Default::default() };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert!(diags.iter().any(|d| d.code == "gameSystem.unverified"));
    }
}
```

- [ ] **Step 2: Зарегистрировать модуль**

В `packages/engine-parser/src/raw/mod.rs` добавить строку `mod merge;` и реэкспорт. Итоговый файл:

```rust
mod merge;
mod model;
mod parse;
pub use merge::merge_supporting;
pub use model::*;
pub use parse::parse_raw;
```

- [ ] **Step 3: Прогнать тесты — должны компилироваться и проходить**

Run: `cargo test --test '*' merge_supporting 2>/dev/null; cargo test merge::tests`
Expected: 5 тестов модуля `merge::tests` — PASS.

Если не компилируется из-за приватности `error::Diagnostic` — проверить, что `use crate::error::Diagnostic;` доступен (он `pub` и уже используется в `resolve/links.rs`).

- [ ] **Step 4: Прогнать весь набор — ничего не сломано**

Run: `cargo test`
Expected: все тесты PASS (новые 5 + существующие без изменений).

- [ ] **Step 5: Commit**

```bash
git add packages/engine-parser/src/raw/merge.rs packages/engine-parser/src/raw/mod.rs
git commit -m "feat(parser): merge_supporting folds a .gst into the primary catalogue"
```

---

## Task 2: `parse_system` / `parse_system_files` + сквозной интеграционный тест

**Files:**
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/multi_file.rs`

**Interfaces:**
- Consumes: `crate::raw::{parse_raw, merge_supporting}`, `crate::resolve::resolve_with_diags`, `crate::ir::to_ir`, `RawCatalogue` (из Task 1 и существующие).
- Produces:
  - `pub fn parse_system(primary: (&[u8], bool), supporting: &[(&[u8], bool)]) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError>`
  - `pub fn parse_system_files(primary: &Path, supporting: &[&Path], deadline: Option<Duration>) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError>`

- [ ] **Step 1: Написать падающий интеграционный тест**

Создать `packages/engine-parser/tests/multi_file.rs`:

```rust
use engine_parser::parse_system;

// A faction .cat whose ONLY root is an entryLink into a shared entry that itself
// links to a weapon that lives ONLY in the .gst. Categories, costType and the
// force-org also live in the .gst. This proves cross-file assembly end to end.
const CAT: &[u8] = br#"<?xml version="1.0"?>
<catalogue id="cat.f" name="Faction" revision="1" gameSystemId="sys.g"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="e.captain" name="Captain" type="unit">
      <costs><cost name="pts" typeId="ct.pts" value="80"/></costs>
      <categoryLinks>
        <categoryLink id="cl.hq" name="HQ" targetId="cat.hq" primary="true"/>
      </categoryLinks>
      <entryLinks>
        <entryLink id="l.wpn" name="Bolter" type="selectionEntry" targetId="e.bolter"/>
      </entryLinks>
    </selectionEntry>
  </sharedSelectionEntries>
  <entryLinks>
    <entryLink id="root.captain" name="Captain" type="selectionEntry" targetId="e.captain"/>
  </entryLinks>
</catalogue>"#;

const GST: &[u8] = br#"<?xml version="1.0"?>
<gameSystem id="sys.g" name="Game" revision="1"
            xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
  <costTypes><costType id="ct.pts" name="Points"/></costTypes>
  <categoryEntries><categoryEntry id="cat.hq" name="HQ"/></categoryEntries>
  <forceEntries>
    <forceEntry id="force.army" name="Army">
      <categoryLinks>
        <categoryLink id="fcl.hq" name="HQ" targetId="cat.hq">
          <constraints>
            <constraint id="fc.hq.min" type="min" value="1" field="selections" scope="force"/>
          </constraints>
        </categoryLink>
      </categoryLinks>
    </forceEntry>
  </forceEntries>
  <sharedSelectionEntries>
    <selectionEntry id="e.bolter" name="Bolter" type="upgrade">
      <costs><cost name="pts" typeId="ct.pts" value="5"/></costs>
    </selectionEntry>
  </sharedSelectionEntries>
</gameSystem>"#;

#[test]
fn assembles_cat_with_its_gst() {
    let (ir, diags) = parse_system((CAT, false), &[(GST, false)]).unwrap();

    // Root surfaced from the catalogue-level entryLink.
    let captain = ir.entries.iter().find(|e| e.id == "e.captain")
        .expect("captain root surfaced");
    // Its weapon, which lives only in the .gst, resolved as a child.
    assert!(captain.children.iter().any(|c| c.id == "e.bolter"),
        "gst-only weapon inlined: {:?}", captain.children);
    // Cost name resolved via the merged .gst costType (empty without the merge).
    assert_eq!(captain.costs[0].name, "points");
    // Category id present (matched against force-org by id).
    assert_eq!(captain.categories, vec!["cat.hq"]);
    // Force-org came from the .gst's forceEntry.
    assert!(ir.force_constraints.iter().any(|c| c.id == "fc.hq.min"
        && c.target_type == "category" && c.target_id == "cat.hq" && c.type_ == "min"));
    // Nothing dangling in this closed pair.
    assert!(!diags.iter().any(|d| d.code == "entryLink.unresolved"),
        "no unresolved links: {:?}", diags);
}

#[test]
fn wrong_gst_is_diagnosed() {
    // gameSystemId "sys.g" but the supporting file's id is "sys.other".
    let wrong_gst = br#"<?xml version="1.0"?>
<gameSystem id="sys.other" name="Other" revision="1"
            xmlns="http://www.battlescribe.net/schema/gameSystemSchema">
</gameSystem>"#;
    let (_ir, diags) = parse_system((CAT, false), &[(wrong_gst, false)]).unwrap();
    assert!(diags.iter().any(|d| d.code == "gameSystem.mismatch"),
        "mismatch diagnosed: {:?}", diags);
}
```

- [ ] **Step 2: Прогнать тест — должен упасть (нет `parse_system`)**

Run: `cargo test --test multi_file`
Expected: FAIL — `cannot find function parse_system in crate engine_parser`.

- [ ] **Step 3: Реализовать API в `lib.rs`**

Заменить содержимое `packages/engine-parser/src/lib.rs` на версию с вынесенными хелперами и новым API (существующие `parse_bytes`/`parse_file` переиспользуют хелперы — поведение идентично):

```rust
#![forbid(unsafe_code)]

pub mod error;
pub mod ir;
pub mod limits;
pub mod raw;
pub mod resolve;
pub mod xml;
pub mod zip;

use std::path::Path;
use std::time::Duration;

pub use error::{Diagnostic, ParseError};
pub use ir::IrCatalogue;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// Reject inputs over the byte cap before doing any work.
fn check_size(input: &[u8]) -> Result<(), ParseError> {
    if input.len() as u64 > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    Ok(())
}

/// Get the XML bytes for one input, extracting the single zip member if needed.
fn to_xml(input: &[u8], is_zip: bool) -> Result<std::borrow::Cow<[u8]>, ParseError> {
    if is_zip {
        Ok(std::borrow::Cow::Owned(crate::zip::extract_single_xml(input)?))
    } else {
        Ok(std::borrow::Cow::Borrowed(input))
    }
}

/// Read a file into owned bytes with a size cap; zip detected by extension.
fn read_input(path: &Path) -> Result<(Vec<u8>, bool), ParseError> {
    let meta = std::fs::metadata(path).map_err(|e| ParseError::Io(e.to_string()))?;
    if meta.len() > crate::limits::MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge(crate::limits::MAX_INPUT_BYTES));
    }
    let bytes = std::fs::read(path).map_err(|e| ParseError::Io(e.to_string()))?;
    let is_zip = matches!(
        path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("catz") | Some("gstz") | Some("rosz") | Some("zip")
    );
    Ok((bytes, is_zip))
}

/// Parse in-memory catalogue bytes. If `is_zip`, first extract the single XML
/// member. Enforces MAX_INPUT_BYTES before doing any work.
pub fn parse_bytes(input: &[u8], is_zip: bool) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(input)?;
    let xml = to_xml(input, is_zip)?;
    let raw = crate::raw::parse_raw(&xml)?;
    let mut diags = Vec::new();
    let resolved = crate::resolve::resolve_with_diags(raw, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}

/// Assemble a primary catalogue (`.cat`) with its supporting files (`.gst`) into
/// one evaluable IrCatalogue. Each supporting file is merged into the primary's
/// symbol pool and maps before the single-file resolve runs. In P0-b `supporting`
/// is exactly one `.gst`; the slice shape is future-proofing for P0-c libraries.
pub fn parse_system(
    primary: (&[u8], bool),
    supporting: &[(&[u8], bool)],
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let (p_bytes, p_zip) = primary;
    check_size(p_bytes)?;
    let p_xml = to_xml(p_bytes, p_zip)?;
    let mut cat = crate::raw::parse_raw(&p_xml)?;

    let mut diags = Vec::new();
    for &(s_bytes, s_zip) in supporting {
        check_size(s_bytes)?;
        let s_xml = to_xml(s_bytes, s_zip)?;
        let s_cat = crate::raw::parse_raw(&s_xml)?;
        crate::raw::merge_supporting(&mut cat, s_cat, &mut diags);
    }

    let resolved = crate::resolve::resolve_with_diags(cat, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}

/// Read and parse a file. Zip is detected by extension (.catz/.gstz/.rosz).
/// If `deadline` is Some, the parse runs on a worker thread and is abandoned
/// (returning ParseError::Io("parse deadline exceeded")) if it does not finish
/// in time — the pipeline's "max parse time" guard (spec §10.1).
pub fn parse_file(path: &Path, deadline: Option<Duration>) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let (bytes, is_zip) = read_input(path)?;
    match deadline {
        None => parse_bytes(&bytes, is_zip),
        Some(d) => {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(parse_bytes(&bytes, is_zip));
            });
            match rx.recv_timeout(d) {
                Ok(result) => result,
                Err(_) => Err(ParseError::Io("parse deadline exceeded".into())),
            }
        }
    }
}

/// File-path variant of `parse_system` for the CLI: zip detected by extension,
/// optional parse deadline (same worker-thread guard as `parse_file`).
pub fn parse_system_files(
    primary: &Path,
    supporting: &[&Path],
    deadline: Option<Duration>,
) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    let primary_owned = read_input(primary)?;
    let mut supporting_owned: Vec<(Vec<u8>, bool)> = Vec::with_capacity(supporting.len());
    for p in supporting {
        supporting_owned.push(read_input(p)?);
    }

    let run = move || {
        let sup_refs: Vec<(&[u8], bool)> =
            supporting_owned.iter().map(|(b, z)| (b.as_slice(), *z)).collect();
        parse_system((primary_owned.0.as_slice(), primary_owned.1), &sup_refs)
    };

    match deadline {
        None => run(),
        Some(d) => {
            let (tx, rx) = std::sync::mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(run());
            });
            match rx.recv_timeout(d) {
                Ok(result) => result,
                Err(_) => Err(ParseError::Io("parse deadline exceeded".into())),
            }
        }
    }
}
```

- [ ] **Step 4: Прогнать интеграционный тест — должен пройти**

Run: `cargo test --test multi_file`
Expected: `assembles_cat_with_its_gst` и `wrong_gst_is_diagnosed` — PASS.

- [ ] **Step 5: Прогнать весь набор — golden цел, поведение одиночного пути не изменилось**

Run: `cargo test`
Expected: все тесты PASS, в т.ч. `tests/golden.rs` (`parser_output_matches_golden`, `parses_the_zip_form_identically`) и `tests/smoke.rs`.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-parser/src/lib.rs packages/engine-parser/tests/multi_file.rs
git commit -m "feat(parser): parse_system assembles a .cat with its .gst"
```

---

## Task 3: проверка на реальной паре SM + `.gst` (ручная, вне git)

**Files:** нет коммитов кода; при необходимости — точечный правки капов.

Реальные `Imperium - Space Marines.cat` + `Warhammer 40,000.gst` лежат в scratchpad и **не** входят в git (GW-IP-adjacent). Это проверка DoD и риска капов из спеки.

- [ ] **Step 1: Написать одноразовый пример, гоняющий реальную пару**

Создать `packages/engine-parser/examples/real_pair.rs` (пример, не тест — не коммитим постоянно; либо гонять через `cargo run` во временном месте scratchpad). Пути к файлам передать через аргументы, не хардкодить:

```rust
use std::path::Path;
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cat = Path::new(&args[1]);
    let gst = Path::new(&args[2]);
    let (ir, diags) = engine_parser::parse_system_files(cat, &[gst], Some(Duration::from_secs(30)))
        .expect("parse_system_files");
    let roots = ir.entries.len();
    let unresolved = diags.iter().filter(|d| d.code == "entryLink.unresolved").count();
    let forces = ir.force_constraints.len();
    let empty_cost_names = ir.entries.iter().flat_map(|e| &e.costs).filter(|c| c.name.is_empty()).count();
    println!("roots={roots} unresolved={unresolved} force_constraints={forces} empty_cost_names={empty_cost_names}");
}
```

- [ ] **Step 2: Запустить на реальной паре**

Run (пути — из scratchpad `bsdata/`):
`cargo run --example real_pair -- "<scratchpad>/bsdata/Imperium - Space Marines.cat" "<scratchpad>/bsdata/Warhammer 40,000.gst"`

Expected (сверить с DoD спеки):
- `roots=130` (как после P0-a);
- `unresolved` упало с ~390 до ~53 (остаток — `catalogueLink`-библиотеки);
- `force_constraints` > 0 (форс-орг из `.gst`);
- `empty_cost_names` заметно уменьшилось (очки резолвятся);
- процесс не паникует и укладывается в дедлайн.

- [ ] **Step 3: Если пробит кап резолва**

Если парс падает с `ParseError::ResolvedTooLarge` или `ResolveTooDeep` — это настоящий сигнал (ростер большой), НЕ молчаливый обрыв. Замерить фактические числа, поднять соответствующий кап в `packages/engine-parser/src/limits.rs` до измеренного значения с запасом (напр. ×2), добавить комментарий с обоснованием и замером. Перепрогнать Step 2. Если капы не пробиты — этот шаг пропустить.

- [ ] **Step 4: Убрать пример перед завершением ветки**

`examples/real_pair.rs` — временный. Удалить его (данные и одноразовый прогон в git не идут). Если Step 3 менял `limits.rs` — закоммитить только правку капа:

```bash
rm packages/engine-parser/examples/real_pair.rs
# только если менялись капы:
git add packages/engine-parser/src/limits.rs
git commit -m "perf(parser): raise resolve caps for full-faction assembly"
```

---

## Self-Review

**Покрытие спеки:**
- Слияние `.gst` → `.cat` до резолва — Task 1 (`merge_supporting`).
- Объединённая символьная таблица / карты / force_entries — Task 1 (union + extend), проверено юнит-тестами.
- Де-дуп id (внутрифайловый жёсткий / межфайловый top-level мягкий) — Task 1, тест `cross_file_duplicate_shared_id_is_diagnosed_and_dropped`; жёсткий внутрифайловый путь не тронут (`SymbolTable::build`).
- Валидация `gameSystemId` (`mismatch`/`unverified`) — Task 1, два теста.
- `parse_system` / `parse_system_files` API — Task 2.
- Сквозная межфайловая резолюция + форс-орг из `.gst` + имена очков — Task 2, `assembles_cat_with_its_gst`.
- Домен/engine-eval не тронуты, golden цел — Task 2 Step 5 (весь набор).
- DoD на реальных данных + риск капов — Task 3.

**Плейсхолдеры:** нет — весь код приведён целиком.

**Согласованность типов:** `merge_supporting(&mut RawCatalogue, RawCatalogue, &mut Vec<Diagnostic>)` — сигнатура одна в Task 1 (Produces) и в вызове Task 2 Step 3. `parse_system((&[u8],bool), &[(&[u8],bool)])` — одна в Task 2 (Produces), в тесте `multi_file.rs` и в теле `parse_system_files`. Коды диагностик (`gameSystem.mismatch`/`gameSystem.unverified`/`symbol.duplicate_cross_file`/`entryLink.unresolved`) совпадают между реализацией и ассертами.

## Execution Handoff

План сохранён в `docs/superpowers/plans/2026-07-11-p0b-multi-file-assembly.md`. Два варианта исполнения:

1. **Subagent-Driven (рекомендую)** — свежий сабагент на задачу, ревью между задачами, быстрая итерация.
2. **Inline Execution** — задачи в этой сессии через executing-plans, чекпойнты для ревью.

Какой подход?
