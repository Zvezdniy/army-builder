# 11e JSON Catalogue Reader — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a JSON front-end to the Rust parser (`raw::parse_raw_json(&[u8]) -> RawCatalogue`) so BSData wh40k-11e JSON catalogues produce the same `IrCatalogue` as the XML path, with format dispatch by file extension.

**Architecture:** The whole parser funnels through `raw::parse_raw(xml) -> RawCatalogue`; every later stage (`resolve`, `to_ir`, `merge_supporting`, `pack`) is format-agnostic. We add a sibling `parse_raw_json` that deserializes BS-JSON into serde DTOs and maps them field-for-field onto the identical `RawCatalogue`. A `Format` enum chosen at I/O time dispatches XML vs JSON. The XML path is untouched.

**Tech Stack:** Rust, serde + serde_json (new deps), existing `quick-xml` path unchanged. Tests via `cargo test`.

## Global Constraints

- The 10e XML path (`parse_raw`, `to_xml`, `parse_bytes(bytes, is_zip)`) MUST remain behavior-identical. The existing golden test `parser_output_matches_golden` MUST stay green untouched.
- `parse_raw_json` MUST return the SAME `RawCatalogue` shape the XML parser produces, so `resolve`/`to_ir` are reused unchanged. The parity test (Task 7) is the binding correctness gate.
- Both root wrappers MUST be handled: `{"catalogue": {…}}` and `{"gameSystem": {…}}` (inner `type` = `"catalogue"`/`"gameSystem"`). A game system parses into a `RawCatalogue` merged as a supporting file, exactly like a `.gst`.
- Unmodeled 11e details: `associations` on an entry → dropped LOUDLY with a `Diagnostic`; condition `includeChildForces` → ignored silently (no `RawCondition` slot, never changes a mapping). Comparators `instanceOf`/`notInstanceOf` need NO handling — `to_ir::map_condition` already maps them.
- `entryLink` constraints have no `RawEntryLink` slot in the XML path; the JSON reader mirrors that (carries id/target_id/link_type/hidden/modifiers only). Do NOT add a constraints slot.
- `MAX_INPUT_BYTES` size cap applies before JSON parsing, same as XML (`check_size`).
- Work on branch `feat/11e-json-reader` (spec already committed there).
- Diagnostics use the existing `Diagnostic { code, message }` type; drops are loud, never silent (codebase convention).

## Target types (already defined in `src/raw/model.rs`, do NOT change)

```rust
RawCatalogue { id: String, name: String, revision: i64, game_system_id: Option<String>,
  cost_types: HashMap<String,String>, categories: HashMap<String,String>,
  rules: BTreeMap<String,String>, shared_entries: Vec<RawEntry>, shared_groups: Vec<RawGroup>,
  entries: Vec<RawEntry>, force_entries: Vec<RawForce>,
  catalogue_links: Vec<RawCatalogueLink>, entry_links: Vec<RawEntryLink> }
RawEntry { id, name, entry_type: String, hidden: bool, costs: Vec<RawCost>,
  category_links: Vec<RawCategoryLink>, constraints: Vec<RawConstraint>, modifiers: Vec<RawModifier>,
  entries: Vec<RawEntry>, groups: Vec<RawGroup>, entry_links: Vec<RawEntryLink>, profiles: Vec<RawProfile> }
RawGroup { id, name, default_selection_entry_id: String, hidden: bool, entries, groups,
  entry_links, constraints, modifiers, profiles }
RawCost { type_id: String, value: f64 }
RawCategoryLink { target_id: String, primary: bool, constraints: Vec<RawConstraint> }
RawEntryLink { id, target_id, link_type: String, hidden: bool, modifiers: Vec<RawModifier> }
RawForce { id, name, constraints: Vec<RawConstraint>, category_links: Vec<RawCategoryLink> }
RawCatalogueLink { target_id: String, import_root_entries: bool }
RawConstraint { id, kind: String, value: f64, field: String, scope: String, include_child_selections: bool }
RawModifier { kind: String, field: String, value: f64, value_raw: String,
  conditions: Vec<RawCondition>, condition_groups: Vec<RawConditionGroup>, has_repeats: bool }
RawCondition { comparator, field, scope, value: f64, child_id, include_child_selections: bool }
RawConditionGroup { kind: String, conditions: Vec<RawCondition>, groups: Vec<RawConditionGroup> }
RawProfile { id, name, type_name: String, characteristics: Vec<RawCharacteristic> }
RawCharacteristic { name, value }
```

## File Structure

- **Create** `packages/engine-parser/src/raw/parse_json.rs` — all serde DTOs + `parse_raw_json` + DTO→Raw mapping. One responsibility: JSON bytes → `RawCatalogue`.
- **Create** `packages/engine-parser/tests/fixtures/mini11e.catalogue.json` and `mini11e.gamesystem.json` — small hand-authored 11e-shaped fixtures.
- **Create** `packages/engine-parser/tests/fixtures/parity/` — twin XML + JSON of one logical catalogue for the parity test.
- **Create** `packages/engine-parser/tests/json.rs` — JSON-reader integration + parity tests.
- **Modify** `packages/engine-parser/Cargo.toml` — add serde deps.
- **Modify** `packages/engine-parser/src/raw/mod.rs` — `pub mod parse_json; pub use parse_json::parse_raw_json;`
- **Modify** `packages/engine-parser/src/lib.rs` — `Format` enum, `read_input` returns `(Vec<u8>, Format)`, `parse_bytes_fmt`, thread `Format` through `parse_system`/`parse_file`/`parse_system_files`; keep `parse_bytes(bytes, is_zip)` as a wrapper.

---

### Task 1: serde deps + full DTO tree + `parse_raw_json` scalar skeleton

**Files:**
- Modify: `packages/engine-parser/Cargo.toml`
- Create: `packages/engine-parser/src/raw/parse_json.rs`
- Modify: `packages/engine-parser/src/raw/mod.rs`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Produces: `pub fn parse_raw_json(bytes: &[u8], diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError>` (the `diags` param is unused until Task 5's `associations` drop; declared now so the signature is stable across the plan); DTO structs `JsonRoot`, `JsonCat`, `JsonEntry`, `JsonGroup`, `JsonEntryLink`, `JsonCost`, `JsonConstraint`, `JsonModifier`, `JsonCondition`, `JsonConditionGroup`, `JsonProfile`, `JsonCharacteristic`, `JsonCategoryEntry`, `JsonForce`, `JsonCategoryLink`, `JsonCatalogueLink`, `JsonCostType`, `JsonRule` (all `#[derive(Deserialize, Default)]`, `#[serde(default, rename_all = "camelCase")]`).
- Consumes: `RawCatalogue`, `ParseError`, `Diagnostic` from crate.

- [ ] **Step 1: Add serde deps.** In `packages/engine-parser/Cargo.toml` under `[dependencies]` add:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Write the failing test** in `packages/engine-parser/tests/json.rs`:

```rust
use engine_parser::raw::parse_raw_json;

#[test]
fn parses_root_scalars_from_catalogue_wrapper() {
    let json = br#"{"catalogue":{"type":"catalogue","id":"cat.x","name":"X","revision":7,"gameSystemId":"gs.1"}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    assert_eq!((raw.id.as_str(), raw.name.as_str(), raw.revision), ("cat.x", "X", 7));
    assert_eq!(raw.game_system_id.as_deref(), Some("gs.1"));
}

#[test]
fn parses_gamesystem_wrapper_and_errors_on_neither() {
    let gs = br#"{"gameSystem":{"id":"gs.1","name":"GS","revision":2}}"#;
    assert_eq!(parse_raw_json(gs, &mut Vec::new()).unwrap().id, "gs.1");
    assert!(parse_raw_json(br#"{"other":{}}"#, &mut Vec::new()).is_err());
}
```

- [ ] **Step 3: Run test to verify it fails.** Run: `cargo test -p engine-parser --test json`. Expected: FAIL (`parse_raw_json` / `raw` module path unresolved).

- [ ] **Step 4: Create `src/raw/parse_json.rs`** with the full DTO tree and scalar mapping. (Fields not yet mapped are still declared so the tree deserializes; later tasks add their mapping.)

```rust
use std::collections::{BTreeMap, HashMap};
use serde::Deserialize;
use crate::raw::model::*;
use crate::{Diagnostic, ParseError};

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonRoot { catalogue: Option<JsonCat>, game_system: Option<JsonCat> }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCat {
    id: String, name: String, revision: i64, game_system_id: Option<String>,
    cost_types: Vec<JsonCostType>,
    category_entries: Vec<JsonCategoryEntry>,
    rules: Vec<JsonRule>, shared_rules: Vec<JsonRule>,
    shared_selection_entries: Vec<JsonEntry>,
    shared_selection_entry_groups: Vec<JsonGroup>,
    selection_entries: Vec<JsonEntry>,
    entry_links: Vec<JsonEntryLink>,
    catalogue_links: Vec<JsonCatalogueLink>,
    force_entries: Vec<JsonForce>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCostType { id: String, name: String }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCategoryEntry { id: String, name: String }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonRule { id: String, name: String, alias: String, description: String }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonEntry {
    id: String, name: String, #[serde(rename = "type")] entry_type: String, hidden: bool,
    costs: Vec<JsonCost>, category_links: Vec<JsonCategoryLink>,
    constraints: Vec<JsonConstraint>, modifiers: Vec<JsonModifier>,
    selection_entries: Vec<JsonEntry>, selection_entry_groups: Vec<JsonGroup>,
    entry_links: Vec<JsonEntryLink>, profiles: Vec<JsonProfile>,
    rules: Vec<JsonRule>, associations: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonGroup {
    id: String, name: String, default_selection_entry_id: String, hidden: bool,
    selection_entries: Vec<JsonEntry>, selection_entry_groups: Vec<JsonGroup>,
    entry_links: Vec<JsonEntryLink>, constraints: Vec<JsonConstraint>,
    modifiers: Vec<JsonModifier>, profiles: Vec<JsonProfile>, rules: Vec<JsonRule>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonEntryLink {
    id: String, target_id: String, #[serde(rename = "type")] link_type: String,
    hidden: bool, modifiers: Vec<JsonModifier>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCatalogueLink { target_id: String, import_root_entries: bool }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonForce {
    id: String, name: String, constraints: Vec<JsonConstraint>,
    category_links: Vec<JsonCategoryLink>, rules: Vec<JsonRule>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCategoryLink { target_id: String, primary: bool, constraints: Vec<JsonConstraint> }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCost { #[serde(rename = "typeId")] type_id: String, value: f64 }

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonConstraint {
    id: String, #[serde(rename = "type")] kind: String, value: f64, field: String,
    scope: String, include_child_selections: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonModifier {
    #[serde(rename = "type")] kind: String, field: String,
    value: serde_json::Value,
    conditions: Vec<JsonCondition>, condition_groups: Vec<JsonConditionGroup>,
    repeats: Vec<serde_json::Value>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCondition {
    #[serde(rename = "type")] comparator: String, field: String, scope: String,
    value: f64, child_id: String, include_child_selections: bool,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonConditionGroup {
    #[serde(rename = "type")] kind: String,
    conditions: Vec<JsonCondition>, condition_groups: Vec<JsonConditionGroup>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonProfile {
    id: String, name: String, type_name: String, characteristics: Vec<JsonCharacteristic>,
}

#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonCharacteristic { name: String, #[serde(rename = "$text")] text: String }

/// Parse BS-JSON bytes (catalogue or gameSystem wrapper) into a RawCatalogue,
/// the same target the XML parser produces. Diagnostics are collected by the
/// caller in later stages; the only diagnostic emitted here (dropped
/// `associations`) is accumulated into a thread-local-free out param added in Task 5.
pub fn parse_raw_json(bytes: &[u8], _diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError> {
    let root: JsonRoot = serde_json::from_slice(bytes)
        .map_err(|e| ParseError::Io(format!("invalid catalogue JSON: {e}")))?;
    let cat = root.catalogue.or(root.game_system)
        .ok_or_else(|| ParseError::Io("JSON has neither `catalogue` nor `gameSystem`".into()))?;
    Ok(map_cat(cat))
}

fn map_cat(c: JsonCat) -> RawCatalogue {
    RawCatalogue {
        id: c.id,
        name: c.name,
        revision: c.revision,
        game_system_id: c.game_system_id,
        ..Default::default()
    }
}
```

(In Task 5, `_diags` is renamed to `diags` and threaded into `map_cat`/`map_entry` where the `associations` drop is emitted. Tasks 2-4 keep `map_cat`'s scalar-only signature; only Task 5 threads `diags` into the tree walk.)

- [ ] **Step 5: Register the module.** In `packages/engine-parser/src/raw/mod.rs` add `pub mod parse_json;` and `pub use parse_json::parse_raw_json;` (match the existing `pub use` style in that file).

- [ ] **Step 6: Run tests to verify they pass.** Run: `cargo test -p engine-parser --test json`. Expected: both tests PASS. Then `cargo test -p engine-parser` — golden and all existing tests still PASS.

- [ ] **Step 7: Commit.**

```bash
git add packages/engine-parser/Cargo.toml packages/engine-parser/Cargo.lock \
  packages/engine-parser/src/raw/parse_json.rs packages/engine-parser/src/raw/mod.rs \
  packages/engine-parser/tests/json.rs
git commit -m "feat(parser): JSON reader scaffolding — DTO tree + root scalars"
```

---

### Task 2: costTypes, categoryEntries, rules → maps

**Files:**
- Modify: `packages/engine-parser/src/raw/parse_json.rs`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Consumes: `JsonCat`, `JsonRule`, `JsonCostType`, `JsonCategoryEntry` from Task 1.
- Produces: `map_cat` now fills `cost_types`, `categories`, `rules`; helper `fn collect_rules(cat: &JsonCat, out: &mut BTreeMap<String,String>)`.

- [ ] **Step 1: Write the failing test:**

```rust
#[test]
fn maps_costtypes_categories_and_nested_rules() {
    let json = br#"{"gameSystem":{"id":"gs","name":"GS","revision":1,
      "costTypes":[{"id":"pts","name":"pts"},{"id":"dp","name":"Detachment Points"}],
      "categoryEntries":[{"id":"cat.hq","name":"HQ"}],
      "sharedRules":[{"id":"r1","name":"Oath","alias":"","description":"Re-roll hits."}],
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "rules":[{"id":"r2","name":"Deep Strike","alias":"","description":"Arrive from reserves."}]}]}}"#;
    let raw = parse_raw_json(json).unwrap();
    assert_eq!(raw.cost_types.get("dp").map(String::as_str), Some("Detachment Points"));
    assert_eq!(raw.categories.get("cat.hq").map(String::as_str), Some("HQ"));
    assert_eq!(raw.rules.get("Oath").map(String::as_str), Some("Re-roll hits."));
    assert_eq!(raw.rules.get("Deep Strike").map(String::as_str), Some("Arrive from reserves."));
}
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cargo test -p engine-parser --test json maps_costtypes`. Expected: FAIL (maps empty).

- [ ] **Step 3: Implement.** Replace `map_cat` and add helpers in `parse_json.rs`:

```rust
fn map_cat(c: JsonCat) -> RawCatalogue {
    let mut cost_types = HashMap::new();
    for ct in &c.cost_types { cost_types.insert(ct.id.clone(), ct.name.clone()); }
    let mut categories = HashMap::new();
    for ce in &c.category_entries { categories.insert(ce.id.clone(), ce.name.clone()); }
    let mut rules = BTreeMap::new();
    collect_rules(&c, &mut rules);
    RawCatalogue {
        id: c.id.clone(), name: c.name.clone(), revision: c.revision,
        game_system_id: c.game_system_id.clone(),
        cost_types, categories, rules,
        ..Default::default()
    }
}

/// Rules live at top level (rules/sharedRules) AND nested inside entries/groups/
/// forces. Key by `name` and, when present, also by `alias` — mirroring the XML
/// parser's `read_all_rules` flat capture. Later (non-empty) descriptions win on
/// duplicate keys, matching insertion-order-last semantics of the XML pass.
fn collect_rules(c: &JsonCat, out: &mut BTreeMap<String, String>) {
    for r in c.rules.iter().chain(c.shared_rules.iter()) { insert_rule(r, out); }
    for e in c.shared_selection_entries.iter().chain(c.selection_entries.iter()) {
        collect_rules_entry(e, out);
    }
    for g in &c.shared_selection_entry_groups { collect_rules_group(g, out); }
    for f in &c.force_entries { for r in &f.rules { insert_rule(r, out); } }
}
fn insert_rule(r: &JsonRule, out: &mut BTreeMap<String, String>) {
    if !r.name.is_empty() { out.insert(r.name.clone(), r.description.clone()); }
    if !r.alias.is_empty() { out.insert(r.alias.clone(), r.description.clone()); }
}
fn collect_rules_entry(e: &JsonEntry, out: &mut BTreeMap<String, String>) {
    for r in &e.rules { insert_rule(r, out); }
    for c in e.selection_entries.iter() { collect_rules_entry(c, out); }
    for g in &e.selection_entry_groups { collect_rules_group(g, out); }
}
fn collect_rules_group(g: &JsonGroup, out: &mut BTreeMap<String, String>) {
    for r in &g.rules { insert_rule(r, out); }
    for c in g.selection_entries.iter() { collect_rules_entry(c, out); }
    for sg in &g.selection_entry_groups { collect_rules_group(sg, out); }
}
```

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser --test json`. Expected: PASS (all json tests). `cargo test -p engine-parser` still green.

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/raw/parse_json.rs packages/engine-parser/tests/json.rs
git commit -m "feat(parser): JSON reader — costTypes, categories, nested rules"
```

---

### Task 3: profiles + characteristics (`$text`)

**Files:**
- Modify: `packages/engine-parser/src/raw/parse_json.rs`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Consumes: `JsonProfile`, `JsonCharacteristic`.
- Produces: `fn map_profiles(ps: &[JsonProfile]) -> Vec<RawProfile>`.

- [ ] **Step 1: Write the failing test:**

```rust
#[test]
fn maps_profiles_with_text_characteristics() {
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit","profiles":[
        {"id":"p1","name":"U","typeName":"Unit","characteristics":[
          {"name":"T","typeId":"t","$text":"6"},{"name":"InSv","typeId":"i","$text":"4+"}]}]}]}}"#;
    let raw = parse_raw_json(json).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    let p = &u.profiles[0];
    assert_eq!((p.name.as_str(), p.type_name.as_str()), ("U", "Unit"));
    assert_eq!(p.characteristics.iter().find(|c| c.name == "InSv").unwrap().value, "4+");
}
```

(This test also asserts `entries` is populated — implemented in Task 5. It is written now to lock the `$text`→`value` mapping; if Tasks are executed strictly in order it will still fail until Task 5. Executors running out of order: implement `map_profiles` in this task and rely on Task 5's `map_entry` to wire profiles in. To keep this task independently green, the Step-1 test below is the profile-only unit test; the entry-level assertion is duplicated in Task 5.)

Independently-green test for THIS task:

```rust
#[test]
fn profile_text_maps_to_characteristic_value() {
    use engine_parser::raw::parse_raw_json;
    // gameSystem with a shared profile exercises map_profiles without needing entries.
    let json = br#"{"gameSystem":{"id":"gs","name":"GS","revision":1,
      "sharedProfiles":[{"id":"p1","name":"Halved","typeName":"Abilities","characteristics":[
        {"name":"Description","typeId":"d","$text":"Halve the damage."}]}]}}"#;
    let raw = parse_raw_json(json).unwrap();
    // shared profiles are surfaced onto the catalogue-level shared profile list in Task 3.
    assert!(raw.rules.is_empty()); // sanity: parses
    // Assert via a dedicated accessor added below.
    assert_eq!(engine_parser::raw::parse_json_test_first_shared_profile_char(&raw), Some("Halve the damage.".to_string()));
}
```

To avoid adding test-only accessors, prefer testing `map_profiles` directly. Make `map_profiles` and a `shared_profiles: Vec<JsonProfile>` field visible to an in-file `#[cfg(test)] mod tests`:

- [ ] **Step 2: Add `shared_profiles` to `JsonCat`** (field: `shared_profiles: Vec<JsonProfile>`) — game systems carry `sharedProfiles`. Not mapped into `RawCatalogue` (the XML `RawCatalogue` has no shared-profile pool; profiles attach to entries). It exists only so `map_profiles` has a test subject and so unknown-field tolerance is explicit.

- [ ] **Step 3: Implement `map_profiles` + in-file unit test.** Add to `parse_json.rs`:

```rust
fn map_profiles(ps: &[JsonProfile]) -> Vec<RawProfile> {
    ps.iter().map(|p| RawProfile {
        id: p.id.clone(), name: p.name.clone(), type_name: p.type_name.clone(),
        characteristics: p.characteristics.iter()
            .map(|c| RawCharacteristic { name: c.name.clone(), value: c.text.clone() })
            .collect(),
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn map_profiles_uses_text_as_value() {
        let p = JsonProfile {
            id: "p".into(), name: "U".into(), type_name: "Unit".into(),
            characteristics: vec![JsonCharacteristic { name: "InSv".into(), text: "4+".into() }],
        };
        let out = map_profiles(std::slice::from_ref(&p));
        assert_eq!(out[0].characteristics[0].value, "4+");
        assert_eq!(out[0].type_name, "Unit");
    }
}
```

Remove the speculative Step-1 accessor test; the in-file `map_profiles_uses_text_as_value` is the independently-green gate for this task.

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser`. Expected: `map_profiles_uses_text_as_value` PASS, all existing green.

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/raw/parse_json.rs
git commit -m "feat(parser): JSON reader — profiles + \$text characteristics"
```

---

### Task 4: costs, constraints, conditions, condition groups, modifiers

**Files:**
- Modify: `packages/engine-parser/src/raw/parse_json.rs`
- Test: `packages/engine-parser/tests/json.rs` (in-file `mod tests`)

**Interfaces:**
- Consumes: `JsonCost`, `JsonConstraint`, `JsonModifier`, `JsonCondition`, `JsonConditionGroup`.
- Produces: `fn map_costs`, `fn map_constraints`, `fn map_modifiers`, `fn map_conditions`, `fn map_condition_groups`, and `fn modifier_value(v: &serde_json::Value) -> (f64, String)`.

- [ ] **Step 1: Write the failing in-file test** (append to `#[cfg(test)] mod tests`):

```rust
#[test]
fn modifier_value_handles_bool_number_string() {
    assert_eq!(modifier_value(&serde_json::json!(true)), (0.0, "true".to_string()));
    assert_eq!(modifier_value(&serde_json::json!(3)), (3.0, "3".to_string()));
    assert_eq!(modifier_value(&serde_json::json!("-1")), (-1.0, "-1".to_string()));
    assert_eq!(modifier_value(&serde_json::json!("x2")), (0.0, "x2".to_string()));
}

#[test]
fn map_modifier_carries_repeats_and_nested_conditions() {
    let m = JsonModifier {
        kind: "set".into(), field: "hidden".into(), value: serde_json::json!(true),
        conditions: vec![JsonCondition { comparator: "instanceOf".into(), field: "selections".into(),
            scope: "roster".into(), value: 1.0, child_id: "x".into(), include_child_selections: true }],
        condition_groups: vec![], repeats: vec![serde_json::json!({})],
    };
    let out = map_modifiers(std::slice::from_ref(&m));
    assert_eq!((out[0].kind.as_str(), out[0].value, out[0].value_raw.as_str()), ("set", 0.0, "true"));
    assert!(out[0].has_repeats);
    assert_eq!(out[0].conditions[0].comparator, "instanceOf");
    assert_eq!(out[0].conditions[0].child_id, "x");
}
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p engine-parser modifier_value`. Expected: FAIL (undefined).

- [ ] **Step 3: Implement** in `parse_json.rs`:

```rust
fn map_costs(cs: &[JsonCost]) -> Vec<RawCost> {
    cs.iter().map(|c| RawCost { type_id: c.type_id.clone(), value: c.value }).collect()
}
fn map_constraints(cs: &[JsonConstraint]) -> Vec<RawConstraint> {
    cs.iter().map(|c| RawConstraint {
        id: c.id.clone(), kind: c.kind.clone(), value: c.value, field: c.field.clone(),
        scope: c.scope.clone(), include_child_selections: c.include_child_selections,
    }).collect()
}
/// BS-JSON encodes a modifier's `value` as bool (field="hidden"), number, or
/// string. RawModifier needs both the numeric value (for cost/limit modifiers)
/// and the raw string (for field="hidden"/"category", parsed downstream in to_ir).
fn modifier_value(v: &serde_json::Value) -> (f64, String) {
    match v {
        serde_json::Value::Bool(b) => (0.0, b.to_string()),
        serde_json::Value::Number(n) => (n.as_f64().unwrap_or(0.0), n.to_string()),
        serde_json::Value::String(s) => (s.parse::<f64>().unwrap_or(0.0), s.clone()),
        _ => (0.0, String::new()),
    }
}
fn map_conditions(cs: &[JsonCondition]) -> Vec<RawCondition> {
    cs.iter().map(|c| RawCondition {
        comparator: c.comparator.clone(), field: c.field.clone(), scope: c.scope.clone(),
        value: c.value, child_id: c.child_id.clone(),
        include_child_selections: c.include_child_selections,
    }).collect()
}
fn map_condition_groups(gs: &[JsonConditionGroup]) -> Vec<RawConditionGroup> {
    gs.iter().map(|g| RawConditionGroup {
        kind: g.kind.clone(),
        conditions: map_conditions(&g.conditions),
        groups: map_condition_groups(&g.condition_groups),
    }).collect()
}
fn map_modifiers(ms: &[JsonModifier]) -> Vec<RawModifier> {
    ms.iter().map(|m| {
        let (value, value_raw) = modifier_value(&m.value);
        RawModifier {
            kind: m.kind.clone(), field: m.field.clone(), value, value_raw,
            conditions: map_conditions(&m.conditions),
            condition_groups: map_condition_groups(&m.condition_groups),
            has_repeats: !m.repeats.is_empty(),
        }
    }).collect()
}
```

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser`. Expected: both new tests PASS, all existing green.

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/raw/parse_json.rs
git commit -m "feat(parser): JSON reader — costs, constraints, modifiers, conditions"
```

---

### Task 5: entries, groups, entryLinks, catalogueLinks, forces (full tree) + `associations` drop

**Files:**
- Modify: `packages/engine-parser/src/raw/parse_json.rs`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Consumes: all mappers from Tasks 2-4; `parse_raw_json`'s stable `(bytes, diags)` signature from Task 1.
- Produces: `parse_raw_json` now returns a fully-populated `RawCatalogue` and emits the `associations` drop through its existing `diags` param (`_diags` → `diags`, threaded into `map_cat`/`map_entry`/`map_group`). No signature change.
- Helpers: `fn map_entry`, `fn map_group`, `fn map_entry_link`, `fn map_category_links`, `fn map_force`.

- [ ] **Step 1: Write the failing test** in `tests/json.rs`:

```rust
use engine_parser::Diagnostic;

#[test]
fn maps_full_entry_tree_with_links_groups_and_associations_drop() {
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,
      "catalogueLinks":[{"targetId":"lib.1","importRootEntries":true}],
      "sharedSelectionEntries":[{"id":"e.w","name":"Bolter","type":"upgrade",
        "costs":[{"typeId":"pts","value":5}],"associations":[{"x":1}]}],
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "categoryLinks":[{"targetId":"cat.hq","primary":true}],
        "constraints":[{"id":"c1","type":"max","value":1,"field":"selections","scope":"parent"}],
        "selectionEntryGroups":[{"id":"g","name":"Wargear",
          "constraints":[{"id":"g.max","type":"max","value":1,"field":"selections","scope":"parent"}],
          "entryLinks":[{"id":"l1","targetId":"e.w","type":"selectionEntry"}]}]}],
      "forceEntries":[{"id":"f","name":"Army",
        "constraints":[{"id":"fc","type":"min","value":1,"field":"selections","scope":"force"}],
        "categoryLinks":[{"targetId":"cat.hq","primary":false}]}]}}"#;
    let mut diags = Vec::new();
    let raw = parse_raw_json(json, &mut diags).unwrap();
    assert_eq!(raw.catalogue_links[0].target_id, "lib.1");
    assert!(raw.catalogue_links[0].import_root_entries);
    assert_eq!(raw.shared_entries[0].costs[0].value, 5.0);
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.category_links[0].target_id, "cat.hq");
    assert_eq!(u.constraints[0].kind, "max");
    let g = &u.groups[0];
    assert_eq!(g.entry_links[0].target_id, "e.w");
    assert_eq!((raw.force_entries[0].name.as_str(), raw.force_entries[0].constraints[0].kind.as_str()), ("Army", "min"));
    assert!(diags.iter().any(|d| d.code == "entry.associations_dropped" && d.message.contains("e.w")));
}
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p engine-parser --test json maps_full_entry_tree`. Expected: FAIL (signature mismatch / empty entries).

- [ ] **Step 3: Implement.** Update imports (`use crate::Diagnostic;`), change `parse_raw_json` signature, and add mappers:

```rust
pub fn parse_raw_json(bytes: &[u8], diags: &mut Vec<Diagnostic>) -> Result<RawCatalogue, ParseError> {
    let root: JsonRoot = serde_json::from_slice(bytes)
        .map_err(|e| ParseError::Io(format!("invalid catalogue JSON: {e}")))?;
    let cat = root.catalogue.or(root.game_system)
        .ok_or_else(|| ParseError::Io("JSON has neither `catalogue` nor `gameSystem`".into()))?;
    Ok(map_cat(cat, diags))
}

fn map_cat(c: JsonCat, diags: &mut Vec<Diagnostic>) -> RawCatalogue {
    let mut cost_types = HashMap::new();
    for ct in &c.cost_types { cost_types.insert(ct.id.clone(), ct.name.clone()); }
    let mut categories = HashMap::new();
    for ce in &c.category_entries { categories.insert(ce.id.clone(), ce.name.clone()); }
    let mut rules = BTreeMap::new();
    collect_rules(&c, &mut rules);
    RawCatalogue {
        id: c.id.clone(), name: c.name.clone(), revision: c.revision,
        game_system_id: c.game_system_id.clone(),
        cost_types, categories, rules,
        shared_entries: c.shared_selection_entries.iter().map(|e| map_entry(e, diags)).collect(),
        shared_groups: c.shared_selection_entry_groups.iter().map(|g| map_group(g, diags)).collect(),
        entries: c.selection_entries.iter().map(|e| map_entry(e, diags)).collect(),
        force_entries: c.force_entries.iter().map(map_force).collect(),
        catalogue_links: c.catalogue_links.iter()
            .map(|l| RawCatalogueLink { target_id: l.target_id.clone(), import_root_entries: l.import_root_entries })
            .collect(),
        entry_links: c.entry_links.iter().map(map_entry_link).collect(),
    }
}

fn map_entry(e: &JsonEntry, diags: &mut Vec<Diagnostic>) -> RawEntry {
    if !e.associations.is_empty() {
        diags.push(Diagnostic {
            code: "entry.associations_dropped".into(),
            message: format!("entry {} associations dropped (unsupported)", e.id),
        });
    }
    RawEntry {
        id: e.id.clone(), name: e.name.clone(), entry_type: e.entry_type.clone(), hidden: e.hidden,
        costs: map_costs(&e.costs),
        category_links: map_category_links(&e.category_links),
        constraints: map_constraints(&e.constraints),
        modifiers: map_modifiers(&e.modifiers),
        entries: e.selection_entries.iter().map(|c| map_entry(c, diags)).collect(),
        groups: e.selection_entry_groups.iter().map(|g| map_group(g, diags)).collect(),
        entry_links: e.entry_links.iter().map(map_entry_link).collect(),
        profiles: map_profiles(&e.profiles),
    }
}

fn map_group(g: &JsonGroup, diags: &mut Vec<Diagnostic>) -> RawGroup {
    RawGroup {
        id: g.id.clone(), name: g.name.clone(),
        default_selection_entry_id: g.default_selection_entry_id.clone(), hidden: g.hidden,
        entries: g.selection_entries.iter().map(|c| map_entry(c, diags)).collect(),
        groups: g.selection_entry_groups.iter().map(|sg| map_group(sg, diags)).collect(),
        entry_links: g.entry_links.iter().map(map_entry_link).collect(),
        constraints: map_constraints(&g.constraints),
        modifiers: map_modifiers(&g.modifiers),
        profiles: map_profiles(&g.profiles),
    }
}

fn map_entry_link(l: &JsonEntryLink) -> RawEntryLink {
    RawEntryLink {
        id: l.id.clone(), target_id: l.target_id.clone(), link_type: l.link_type.clone(),
        hidden: l.hidden, modifiers: map_modifiers(&l.modifiers),
    }
}

fn map_category_links(ls: &[JsonCategoryLink]) -> Vec<RawCategoryLink> {
    ls.iter().map(|l| RawCategoryLink {
        target_id: l.target_id.clone(), primary: l.primary,
        constraints: map_constraints(&l.constraints),
    }).collect()
}

fn map_force(f: &JsonForce) -> RawForce {
    RawForce {
        id: f.id.clone(), name: f.name.clone(),
        constraints: map_constraints(&f.constraints),
        category_links: map_category_links(&f.category_links),
    }
}
```

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser`. Expected: the full-tree test PASSES; the in-file `mod tests` from Tasks 3-4 still pass. (No external caller of `parse_raw_json` exists yet, so the signature change compiles.)

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/raw/parse_json.rs packages/engine-parser/tests/json.rs
git commit -m "feat(parser): JSON reader — full entry/group/link/force tree + associations drop"
```

---

### Task 6: Format dispatch in `lib.rs` (`.json` → JSON reader)

**Files:**
- Modify: `packages/engine-parser/src/lib.rs`
- Create: `packages/engine-parser/tests/fixtures/mini11e.catalogue.json`, `packages/engine-parser/tests/fixtures/mini11e.gamesystem.json`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Consumes: `parse_raw_json(bytes, diags)` (Task 5).
- Produces: `enum Format { Xml, XmlZip, Json }`; `read_input(path) -> Result<(Vec<u8>, Format), ParseError>`; `parse_bytes_fmt(bytes, Format, diags) -> Result<IrCatalogue-ish>` internal; public `parse_file`/`parse_system_files` unchanged signatures but dispatch on `Format`. `parse_bytes(bytes, is_zip)` retained as a wrapper mapping `is_zip` → `Xml`/`XmlZip`.

- [ ] **Step 1: Create fixtures.** `packages/engine-parser/tests/fixtures/mini11e.gamesystem.json`:

```json
{"gameSystem":{"type":"gameSystem","id":"gs.11e","name":"WH40K 11e","revision":1,
  "costTypes":[{"id":"pts","name":"pts"},{"id":"dp","name":"Detachment Points"}],
  "categoryEntries":[{"id":"cat.hq","name":"HQ"}],
  "forceEntries":[{"id":"f.army","name":"Army",
    "constraints":[{"id":"fc.hq.min","type":"min","value":1,"field":"selections","scope":"force"}],
    "categoryLinks":[{"targetId":"cat.hq","primary":false}]}]}}
```

`packages/engine-parser/tests/fixtures/mini11e.catalogue.json`:

```json
{"catalogue":{"type":"catalogue","id":"cat.11e","name":"Mini 11e","revision":1,"gameSystemId":"gs.11e",
  "selectionEntries":[{"id":"e.cap","name":"Captain","type":"model",
    "categoryLinks":[{"targetId":"cat.hq","primary":true}],
    "costs":[{"typeId":"pts","value":90}],
    "profiles":[{"id":"p","name":"Captain","typeName":"Unit","characteristics":[
      {"name":"T","typeId":"t","$text":"4"},{"name":"InSv","typeId":"i","$text":"4+"}]}],
    "selectionEntryGroups":[{"id":"g.wg","name":"Wargear",
      "constraints":[{"id":"g.wg.max","type":"max","value":1,"field":"selections","scope":"parent"}],
      "selectionEntries":[
        {"id":"e.sword","name":"Sword","type":"upgrade","costs":[{"typeId":"pts","value":5}]},
        {"id":"e.axe","name":"Axe","type":"upgrade","costs":[{"typeId":"pts","value":10}]}]}]}]}}
```

- [ ] **Step 2: Write the failing test** in `tests/json.rs`:

```rust
use engine_parser::parse_system_files;
use std::path::Path;

#[test]
fn parse_system_files_reads_json_faction_plus_gamesystem() {
    let (ir, diags) = parse_system_files(
        Path::new("tests/fixtures/mini11e.catalogue.json"),
        &[Path::new("tests/fixtures/mini11e.gamesystem.json")],
        None,
    ).unwrap();
    // The Captain surfaces as a root with its HQ category and points cost.
    let cap = ir.entries.iter().find(|e| e.id == "e.cap").expect("captain root");
    assert!(cap.children.iter().any(|c| c.id == "e.sword"));
    let wg = cap.groups.iter().find(|g| g.id == "g.wg").expect("wargear group emitted");
    assert_eq!(wg.constraints.len(), 1);
    assert!(!diags.iter().any(|d| d.code == "entry.associations_dropped"));
}
```

- [ ] **Step 3: Run to verify it fails.** Run: `cargo test -p engine-parser --test json parse_system_files_reads_json`. Expected: FAIL (`.json` currently routed through `to_xml`, which errors on JSON bytes).

- [ ] **Step 4: Implement `Format` dispatch** in `src/lib.rs`. Replace `read_input` and add `parse_bytes_fmt`; route `parse_bytes`, `parse_system`, `parse_file`, `parse_system_files` through it.

```rust
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Format { Xml, XmlZip, Json }

/// Read a file into owned bytes with a size cap; format detected by extension.
fn read_input(path: &Path) -> Result<(Vec<u8>, Format), ParseError> {
    let bytes = read_capped(path)?; // existing capped read (rename the current body)
    let fmt = match path.extension().and_then(|e| e.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("catz") | Some("gstz") | Some("rosz") | Some("zip") => Format::XmlZip,
        Some("json") => Format::Json,
        _ => Format::Xml,
    };
    Ok((bytes, fmt))
}

/// Parse in-memory bytes of a known format into a RawCatalogue, then resolve+map.
fn raw_of(bytes: &[u8], fmt: Format, diags: &mut Vec<Diagnostic>) -> Result<crate::raw::RawCatalogue, ParseError> {
    match fmt {
        Format::Json => crate::raw::parse_raw_json(bytes, diags),
        Format::Xml | Format::XmlZip => {
            let xml = to_xml(bytes, fmt == Format::XmlZip)?;
            crate::raw::parse_raw(&xml)
        }
    }
}

pub fn parse_bytes(input: &[u8], is_zip: bool) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(input)?;
    let mut diags = Vec::new();
    let fmt = if is_zip { Format::XmlZip } else { Format::Xml };
    let raw = raw_of(input, fmt, &mut diags)?;
    let resolved = crate::resolve::resolve_with_diags(raw, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}
```

For `parse_system`, thread a per-input `Format`: change its signature to accept `(&[u8], Format)` tuples internally, and build the primary + supporting via `raw_of(..)` with each input's format, then `merge_supporting`, `resolve_with_diags`, `to_ir`. Update `parse_file` (single input: `let (bytes, fmt) = read_input(path)?;` then a `parse_bytes_fmt` that mirrors `parse_bytes` but takes `Format`) and `parse_system_files` (map each path through `read_input`, carry its `Format`). Keep the deadline/worker-thread wrappers exactly as they are.

Concretely, add:

```rust
fn parse_bytes_fmt(input: &[u8], fmt: Format) -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(input)?;
    let mut diags = Vec::new();
    let raw = raw_of(input, fmt, &mut diags)?;
    let resolved = crate::resolve::resolve_with_diags(raw, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}

fn parse_system_fmt(primary: (&[u8], Format), supporting: &[(&[u8], Format)])
  -> Result<(IrCatalogue, Vec<Diagnostic>), ParseError> {
    check_size(primary.0)?;
    let mut diags = Vec::new();
    let mut cat = raw_of(primary.0, primary.1, &mut diags)?;
    for &(s_bytes, s_fmt) in supporting {
        check_size(s_bytes)?;
        let s_cat = raw_of(s_bytes, s_fmt, &mut diags)?;
        crate::raw::merge_supporting(&mut cat, s_cat, &mut diags);
    }
    let resolved = crate::resolve::resolve_with_diags(cat, &mut diags)?;
    let (ir, map_diags) = crate::ir::to_ir(&resolved);
    diags.extend(map_diags);
    Ok((ir, diags))
}
```

Rewire `parse_file` to call `parse_bytes_fmt(&bytes, fmt)` and `parse_system_files` to build `(bytes, fmt)` tuples and call `parse_system_fmt`. Retain the public `parse_system((&[u8],bool), &[(&[u8],bool)])` signature as a thin wrapper mapping `bool`→`Format` so existing tests/callers of `parse_system` compile unchanged. `raw::parse_raw`, `RawCatalogue`, and `merge_supporting` must be reachable from `lib.rs` (add `pub(crate) use` in `raw/mod.rs` if not already).

- [ ] **Step 5: Run tests.** Run: `cargo test -p engine-parser`. Expected: `parse_system_files_reads_json_faction_plus_gamesystem` PASSES; golden + zip-parity + all existing tests PASS (XML path unchanged).

- [ ] **Step 6: Commit.**

```bash
git add packages/engine-parser/src/lib.rs packages/engine-parser/src/raw/mod.rs \
  packages/engine-parser/tests/fixtures/mini11e.catalogue.json \
  packages/engine-parser/tests/fixtures/mini11e.gamesystem.json \
  packages/engine-parser/tests/json.rs
git commit -m "feat(parser): dispatch .json inputs to the JSON reader"
```

---

### Task 7: XML/JSON parity test (binding correctness gate)

**Files:**
- Create: `packages/engine-parser/tests/fixtures/parity/twin.cat`, `packages/engine-parser/tests/fixtures/parity/twin.json`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Consumes: `parse_bytes`, `parse_system_files`.

- [ ] **Step 1: Author twin fixtures.** Create the SAME logical single-file catalogue twice. `twin.cat` (BattleScribe XML) and `twin.json` (BS-JSON) must describe an identical catalogue: one gameSystemId, two categories, one unit entry with a points cost, a profile with two characteristics, and a wargear group (max 1) holding two upgrade entries with costs. Author both by hand so the logical content matches exactly. (Keep it single-file: no catalogueLinks, so no supporting file is needed and `parse_bytes` suffices.)

`twin.cat`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="Twin" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="model">
      <costs><cost name="pts" typeId="pts" value="90"/></costs>
      <profiles><profile id="p" name="U" typeName="Unit" typeId="pt">
        <characteristics>
          <characteristic name="T" typeId="t">4</characteristic>
          <characteristic name="InSv" typeId="i">4+</characteristic>
        </characteristics></profile></profiles>
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Wargear">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <selectionEntries>
            <selectionEntry id="e.a" name="A" type="upgrade"><costs><cost name="pts" typeId="pts" value="5"/></costs></selectionEntry>
            <selectionEntry id="e.b" name="B" type="upgrade"><costs><cost name="pts" typeId="pts" value="10"/></costs></selectionEntry>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>
```

`twin.json`:

```json
{"catalogue":{"type":"catalogue","id":"c","name":"Twin","revision":1,"gameSystemId":"gs",
  "selectionEntries":[{"id":"e.u","name":"U","type":"model",
    "costs":[{"typeId":"pts","value":90}],
    "profiles":[{"id":"p","name":"U","typeName":"Unit","typeId":"pt","characteristics":[
      {"name":"T","typeId":"t","$text":"4"},{"name":"InSv","typeId":"i","$text":"4+"}]}],
    "selectionEntryGroups":[{"id":"g","name":"Wargear",
      "constraints":[{"id":"g.max","type":"max","value":1,"field":"selections","scope":"parent"}],
      "selectionEntries":[
        {"id":"e.a","name":"A","type":"upgrade","costs":[{"typeId":"pts","value":5}]},
        {"id":"e.b","name":"B","type":"upgrade","costs":[{"typeId":"pts","value":10}]}]}]}]}}
```

- [ ] **Step 2: Write the parity test** in `tests/json.rs`:

```rust
#[test]
fn xml_and_json_produce_identical_ir() {
    let (xml_ir, _) = engine_parser::parse_bytes(
        include_bytes!("fixtures/parity/twin.cat"), false).unwrap();
    let (json_ir, _) = engine_parser::parse_bytes(
        include_bytes!("fixtures/parity/twin.json"), false).unwrap();
    // parse_bytes routes .json only by extension via read_input; these in-memory
    // calls both use Format::Xml, so parse the JSON one through the JSON path
    // explicitly instead:
    let (json_ir, _) = {
        let mut diags = Vec::new();
        let raw = engine_parser::raw::parse_raw_json(include_bytes!("fixtures/parity/twin.json"), &mut diags).unwrap();
        // resolve + to_ir via a tiny helper exposed for tests, OR use parse file path.
        engine_parser::parse_bytes(include_bytes!("fixtures/parity/twin.json"), false).map(|_| ()).ok();
        panic!("replace with file-based parse — see Step 3");
    };
    assert_eq!(serde_json::to_value(&xml_ir).unwrap(), serde_json::to_value(&json_ir).unwrap());
}
```

The `include_bytes!` + `parse_bytes(_, false)` route can't dispatch JSON (it's byte-based, no extension). Use the file-path API so extension dispatch runs:

```rust
#[test]
fn xml_and_json_produce_identical_ir() {
    use std::path::Path;
    let (xml_ir, _) = engine_parser::parse_file(Path::new("tests/fixtures/parity/twin.cat"), None).unwrap();
    let (json_ir, _) = engine_parser::parse_file(Path::new("tests/fixtures/parity/twin.json"), None).unwrap();
    assert_eq!(
        serde_json::to_value(&xml_ir).unwrap(),
        serde_json::to_value(&json_ir).unwrap(),
        "JSON front-end must produce IR identical to the XML front-end",
    );
}
```

(Delete the first draft; the file-based version is the real test. `serde_json` is already a dev-usable dep after Task 1.)

- [ ] **Step 3: Run to verify it fails, then passes.** Run: `cargo test -p engine-parser --test json xml_and_json_produce_identical_ir`. If any field diverges, the assertion prints the diff — reconcile the JSON mapping (Tasks 2-5) until IR matches. Expected final: PASS.

- [ ] **Step 4: Commit.**

```bash
git add packages/engine-parser/tests/fixtures/parity/ packages/engine-parser/tests/json.rs
git commit -m "test(parser): XML/JSON parity — identical IR from both front-ends"
```

---

### Task 8: Real-data verification (tangible, not committed)

**Files:** none committed (real BSData is gitignored/large). This task is a documented verification run.

- [ ] **Step 1: Clone 11e data (network).**

```bash
git clone --depth 1 --branch main --single-branch https://github.com/BSData/wh40k-11e.git /private/tmp/wh40k-11e
```

- [ ] **Step 2: Parse real Space Marines 11e end-to-end.**

```bash
cd packages/engine-parser
cargo run --quiet --bin muster-parse \
  "/private/tmp/wh40k-11e/Imperium - Space Marines.json" \
  "/private/tmp/wh40k-11e/Warhammer 40,000.json" \
  > /tmp/sm11e.ir.json 2> /tmp/sm11e.diags.txt
```

Expected: exit 0; `/tmp/sm11e.ir.json` is a non-trivial IR (tens of root entries); `/tmp/sm11e.diags.txt` ends with a `diagnostics: N` line.

- [ ] **Step 3: Inspect the tangible result.** Confirm: a non-zero root/unit count; the Enhancements group carries a roster-scope max-3; `Detachment Points` costs appear on task-force entries; the only diagnostics are the expected classes (`entry.associations_dropped`, any `condition.comparator_unmapped` for genuinely novel comparators). Record the counts in the PR/commit description. Optionally pack (`scripts/pack-ir.mjs`) and load into the web inspector to view 11e units.

- [ ] **Step 4: No commit** (verification only). If Step 3 surfaces an unexpected drop class, open a follow-up — do NOT expand this reader's scope.

---

## Self-Review

**Spec coverage:**
- JSON→RawCatalogue for both roots → Tasks 1, 5. ✅
- serde DTO approach → Task 1. ✅
- costTypes/categories/rules, profiles/`$text`, costs/constraints/modifiers/conditions, entries/groups/links/forces → Tasks 2-5. ✅
- `associations` loud drop; `includeChildForces` ignored; `instanceOf`/`notInstanceOf` need no work → Task 5 (drop) + Global Constraints (comparators handled by existing `to_ir`). ✅
- Format dispatch by extension, pipeline needs no logic change → Task 6. ✅
- Parity test as binding gate → Task 7. ✅
- Real-data verification (tangible) → Task 8. ✅
- Non-goals (zipped JSON, edition UX, DP budget, InSv chip, prod repoint) → not implemented, per spec. ✅

**Placeholder scan:** No TBD/TODO. Task 3 and Task 7 each contain a deliberately-discarded first-draft test with an explicit instruction to delete it in favor of the real one that follows; both real tests are complete. No "add error handling"-style hand-waving.

**Type consistency:** `parse_raw_json(bytes, &mut Vec<Diagnostic>)` is stable from Task 1 onward (the `diags` param is `_diags` until Task 5 uses it), so no call site churns. Mapper names (`map_cat`, `map_entry`, `map_group`, `map_entry_link`, `map_category_links`, `map_force`, `map_costs`, `map_constraints`, `map_modifiers`, `map_conditions`, `map_condition_groups`, `map_profiles`, `modifier_value`, `collect_rules`) are consistent across tasks. `map_cat` gains a `diags` param in Task 5 (scalar-only through Tasks 2-4); it is an internal helper with a single caller (`parse_raw_json`), so this is contained. `Format` enum + `read_input`/`raw_of`/`parse_bytes_fmt`/`parse_system_fmt` names consistent in Task 6.
