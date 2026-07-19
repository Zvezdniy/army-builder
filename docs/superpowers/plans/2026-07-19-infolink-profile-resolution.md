# infoLink Profile Resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `<infoLink type="profile">` references (currently ignored) by inlining the referenced shared profile into the owning entry/group, so units whose invuln (and other abilities) are linked rather than inlined regain those profiles.

**Architecture:** Mirror the existing entryLink resolution machinery. Read `<sharedProfiles>` into a `RawCatalogue.shared_profiles` pool and `<infoLinks>` into `info_links` on entries/groups; carry the pool across merged libraries; index it in `SymbolTable`; during resolve, inline each `type="profile"` infoLink's target into the node's `profiles` (tolerant on miss). The JSON front-end reads the same fields so both produce identical `RawCatalogue`. Downstream (`to_ir`, pack, web) is unchanged.

**Tech Stack:** Rust (quick-xml parser, serde JSON reader), `cargo test`.

## Global Constraints

- The 10e/XML path stays behavior-identical for catalogues WITHOUT infoLinks: `parser_output_matches_golden` (mini40k has no infoLinks/sharedProfiles) MUST stay green, and the zip-parity test MUST stay green.
- The XML/JSON parity gate (`xml_and_json_produce_identical_ir`) MUST stay green; both front-ends must populate `info_links`/`shared_profiles` identically.
- Scope is `type="profile"` infoLinks ONLY. `type="rule"` (rule text is already globally captured by `read_all_rules`) and `type="infoGroup"` are skipped silently.
- Unresolved infoLink target → tolerant `Diagnostic { code: "infolink.unresolved", … }` + drop; NEVER an error, NEVER an invented profile. Mirrors `entryLink.unresolved`.
- A `hidden="true"` profile infoLink is skipped (not inlined).
- Duplicate profile ids in the pool → first-wins, NO error (unlike duplicate entry/group ids which are a hard error).
- `RawProfile` is `#[derive(Clone)]`; inlining is a clone.
- Work on branch `feat/infolink-profile-resolution` (spec already committed there). Run `cargo` from inside `packages/engine-parser/`.

## Target types (in `packages/engine-parser/src/raw/model.rs`)

```rust
RawCatalogue { …, shared_entries: Vec<RawEntry>, shared_groups: Vec<RawGroup>, entries: Vec<RawEntry>, … }
RawEntry { id, name, entry_type, hidden, costs, category_links, constraints, modifiers, entries, groups, entry_links, profiles }
RawGroup { id, name, default_selection_entry_id, hidden, entries, groups, entry_links, constraints, modifiers, profiles }
RawProfile { id: String, name: String, type_name: String, characteristics: Vec<RawCharacteristic> }   // derives Debug, Default, Clone
```

## File Structure

- **Modify** `src/raw/model.rs` — add `RawInfoLink`; `info_links` on `RawEntry`/`RawGroup`; `shared_profiles` on `RawCatalogue`.
- **Modify** `src/raw/parse.rs` — read `<sharedProfiles>` (parameterize `read_profiles_into` end-tag) and `<infoLinks>` (new `read_infolinks_into`).
- **Modify** `src/raw/merge.rs` — carry `shared_profiles` across supporting files.
- **Modify** `src/resolve/symbols.rs` — profile pool + `profile(id)` accessor.
- **Modify** `src/resolve/links.rs` — inline `type="profile"` infoLinks during resolve.
- **Modify** `src/raw/parse_json.rs` — JSON DTOs read `infoLinks`/`sharedProfiles`.
- **Modify** `tests/fixtures/parity/twin.cat` + `twin.json` — add an infoLink case.
- **Test** `tests/infolink.rs` (new) — end-to-end resolution tests.

---

### Task 1: Raw model + parse reads `<sharedProfiles>` and `<infoLinks>`

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs`
- Modify: `packages/engine-parser/src/raw/parse.rs`
- Test: `packages/engine-parser/tests/infolink.rs` (create)

**Interfaces:**
- Produces: `pub struct RawInfoLink { pub target_id: String, pub link_type: String, pub hidden: bool }`; `RawEntry.info_links: Vec<RawInfoLink>`; `RawGroup.info_links: Vec<RawInfoLink>`; `RawCatalogue.shared_profiles: Vec<RawProfile>`; `parse_raw` populates all three from XML. `read_profiles_into` gains a `container_end: &[u8]` param.
- Consumes: existing `RawProfile`, `read_profile`, `SafeXmlReader`, `attr`, `attr_bool`.

- [ ] **Step 1: Write the failing test** — create `packages/engine-parser/tests/infolink.rs`:

```rust
use engine_parser::raw::parse_raw;

const XML: &[u8] = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedProfiles>
    <profile id="p.inv" name="Invulnerable Save" typeName="Abilities">
      <characteristics><characteristic name="Description">4+</characteristic></characteristics>
    </profile>
  </sharedProfiles>
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="model">
      <infoLinks>
        <infoLink name="Invulnerable Save" hidden="false" type="profile" id="l1" targetId="p.inv"/>
      </infoLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;

#[test]
fn parse_reads_shared_profiles_and_infolinks() {
    let cat = parse_raw(XML).unwrap();
    assert_eq!(cat.shared_profiles.len(), 1);
    assert_eq!(cat.shared_profiles[0].id, "p.inv");
    assert_eq!(cat.shared_profiles[0].name, "Invulnerable Save");
    let u = cat.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.info_links.len(), 1);
    assert_eq!((u.info_links[0].target_id.as_str(), u.info_links[0].link_type.as_str()), ("p.inv", "profile"));
    assert!(!u.info_links[0].hidden);
}
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p engine-parser --test infolink`. Expected: compile error (`shared_profiles`/`info_links` fields don't exist).

- [ ] **Step 3: Add model fields.** In `src/raw/model.rs`, add to `RawEntry` (after `profiles`) and `RawGroup` (after `profiles`) the field `pub info_links: Vec<RawInfoLink>,`. Add to `RawCatalogue` (after `entry_links`) `pub shared_profiles: Vec<RawProfile>,`. Add the struct near the other Raw* link structs:

```rust
#[derive(Debug, Default, Clone)]
pub struct RawInfoLink {
    pub target_id: String,
    pub link_type: String,   // profile | rule | infoGroup
    pub hidden: bool,
}
```

- [ ] **Step 4: Parameterize `read_profiles_into` with an end tag.** In `src/raw/parse.rs`, change the signature to `fn read_profiles_into(dst: &mut Vec<RawProfile>, r: &mut SafeXmlReader, container_end: &[u8]) -> Result<(), ParseError>` and change the end check line from `Event::End(end) if end.local_name().as_ref() == b"profiles"` to `Event::End(end) if end.local_name().as_ref() == container_end`. Update the two existing call sites: `read_profiles_into(&mut entry.profiles, r)` → `read_profiles_into(&mut entry.profiles, r, b"profiles")?` (line ~177) and `read_profiles_into(&mut group.profiles, r)` → `read_profiles_into(&mut group.profiles, r, b"profiles")?` (line ~255).

- [ ] **Step 5: Read `<sharedProfiles>` at catalogue level.** In `parse_raw`'s top-level `Event::Start` match (after the `b"sharedSelectionEntryGroups"` arm, ~line 55), add:

```rust
                b"sharedProfiles" => {
                    read_profiles_into(&mut cat.shared_profiles, &mut r, b"sharedProfiles")?
                }
```

- [ ] **Step 6: Read `<infoLinks>` in entries and groups.** Add a reader modeled on `read_cataloguelinks_into` (infoLinks are normally self-closing; a rare one with children has them skipped). Handle `Empty` and `Start` in SEPARATE match arms so the borrow of `e` is clean:

```rust
fn read_infolinks_into(dst: &mut Vec<RawInfoLink>, r: &mut SafeXmlReader) -> Result<(), ParseError> {
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Empty(e) if e.local_name().as_ref() == b"infoLink" => {
                    dst.push(RawInfoLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                    });
                }
                Event::Start(e) if e.local_name().as_ref() == b"infoLink" => {
                    dst.push(RawInfoLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                    });
                    skip_element(r, b"infoLink")?; // consume the (rare) child subtree
                }
                Event::End(end) if end.local_name().as_ref() == b"infoLinks" => return Ok(()),
                Event::Start(e) => { skip_element(r, e.local_name().as_ref())?; }
                _ => {}
            },
            None => return Err(ParseError::MalformedXml("unexpected EOF in infoLinks".to_string())),
        }
    }
}
```

Wire it in `read_entry`'s match (after the `b"profiles"` arm, ~line 177) and `read_group`'s match (after `b"profiles"`, ~line 255):

```rust
                    b"infoLinks" => read_infolinks_into(&mut entry.info_links, r)?,   // in read_entry
                    b"infoLinks" => read_infolinks_into(&mut group.info_links, r)?,   // in read_group
```

Ensure `RawInfoLink` is imported where `parse.rs` references the Raw types (add to the existing `use super::model::{…}` list).

- [ ] **Step 7: Run tests.** Run: `cargo test -p engine-parser --test infolink` → PASS. Then `cargo test -p engine-parser` → golden + all existing still PASS (mini40k has no infoLinks/sharedProfiles, so its IR is unchanged).

- [ ] **Step 8: Commit.**

```bash
git add packages/engine-parser/src/raw/model.rs packages/engine-parser/src/raw/parse.rs packages/engine-parser/tests/infolink.rs
git commit -m "feat(parser): read <sharedProfiles> and <infoLinks> into the raw model"
```

---

### Task 2: Merge carries `shared_profiles` across supporting files

**Files:**
- Modify: `packages/engine-parser/src/raw/merge.rs`
- Test: `packages/engine-parser/src/raw/merge.rs` (in-file `#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `RawCatalogue.shared_profiles` (Task 1).
- Produces: `merge_supporting` appends the supporting file's `shared_profiles` (dedup by id, primary wins).

- [ ] **Step 1: Write the failing test** — append to `merge.rs`'s `#[cfg(test)] mod tests`:

```rust
#[test]
fn merge_carries_shared_profiles_dedup_by_id() {
    use crate::raw::model::RawProfile;
    let mut primary = RawCatalogue { id: "p".into(), game_system_id: Some("gs".into()),
        shared_profiles: vec![RawProfile { id: "keep".into(), name: "P".into(), ..Default::default() }],
        ..Default::default() };
    let supporting = RawCatalogue { id: "gs".into(),
        shared_profiles: vec![
            RawProfile { id: "keep".into(), name: "DUP".into(), ..Default::default() }, // deduped (primary wins)
            RawProfile { id: "new".into(), name: "Q".into(), ..Default::default() },
        ], ..Default::default() };
    let mut diags = Vec::new();
    merge_supporting(&mut primary, supporting, &mut diags);
    assert!(primary.shared_profiles.iter().any(|p| p.id == "new"));
    let keep: Vec<_> = primary.shared_profiles.iter().filter(|p| p.id == "keep").collect();
    assert_eq!(keep.len(), 1, "dup id not added twice");
    assert_eq!(keep[0].name, "P", "primary definition wins");
}
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p engine-parser merge_carries_shared_profiles`. Expected: FAIL (`new` absent — supporting shared_profiles dropped).

- [ ] **Step 3: Implement.** In `merge.rs::merge_supporting`, after the `shared_groups` loop (~line 71, before the "Union maps" comment) add:

```rust
    // Carry shared profiles (the pool infoLink type="profile" resolves against),
    // deduping by id — primary's definition wins, mirroring shared_entries/groups.
    let mut seen_profiles: std::collections::HashSet<String> =
        primary.shared_profiles.iter().map(|p| p.id.clone()).collect();
    for p in supporting.shared_profiles {
        if seen_profiles.insert(p.id.clone()) {
            primary.shared_profiles.push(p);
        }
    }
```

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser merge_carries_shared_profiles` → PASS; `cargo test -p engine-parser` → all green.

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/raw/merge.rs
git commit -m "feat(parser): merge carries shared profiles across supporting files"
```

---

### Task 3: SymbolTable profile pool

**Files:**
- Modify: `packages/engine-parser/src/resolve/symbols.rs`
- Test: `packages/engine-parser/src/resolve/symbols.rs` (in-file `mod tests`)

**Interfaces:**
- Consumes: `RawCatalogue.shared_profiles` (Task 1), `RawProfile`.
- Produces: `SymbolTable::profile(&self, id: &str) -> Option<&RawProfile>`; the pool is populated from `cat.shared_profiles` plus every profile found while walking shared entries/groups; duplicate ids first-wins.

- [ ] **Step 1: Write the failing test** — append to `symbols.rs`'s `mod tests`:

```rust
#[test]
fn indexes_shared_and_inline_profiles_first_wins() {
    use crate::raw::model::RawProfile;
    let prof = |id: &str, name: &str| RawProfile { id: id.into(), name: name.into(), ..Default::default() };
    let mut shared_entry = entry("e.s");
    shared_entry.profiles.push(prof("p.inline", "Inline"));
    let cat = RawCatalogue {
        id: "c".into(),
        shared_profiles: vec![prof("p.pool", "Pool"), prof("p.pool", "DUP")], // first wins
        shared_entries: vec![shared_entry],
        ..Default::default()
    };
    let st = SymbolTable::build(&cat).unwrap();
    assert_eq!(st.profile("p.pool").map(|p| p.name.as_str()), Some("Pool"));
    assert_eq!(st.profile("p.inline").map(|p| p.name.as_str()), Some("Inline"));
    assert!(st.profile("nope").is_none());
}
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p engine-parser indexes_shared_and_inline_profiles`. Expected: FAIL (`profile` method missing).

- [ ] **Step 3: Implement.** In `symbols.rs`:

Add `use crate::raw::{RawCatalogue, RawEntry, RawGroup, RawProfile};` (extend the existing import with `RawProfile`). Add a `profiles` field to the struct and thread it through `build`/`walk_entry`/`walk_group`:

```rust
pub struct SymbolTable {
    entries: HashMap<String, RawEntry>,
    groups: HashMap<String, RawGroup>,
    profiles: HashMap<String, RawProfile>,
}
```

In `build`:

```rust
        let mut entries = HashMap::new();
        let mut groups = HashMap::new();
        let mut profiles = HashMap::new();
        for p in &cat.shared_profiles {
            profiles.entry(p.id.clone()).or_insert_with(|| p.clone()); // first-wins
        }
        for entry in &cat.shared_entries {
            walk_entry(entry, &mut entries, &mut groups, &mut profiles)?;
        }
        for group in &cat.shared_groups {
            walk_group(group, &mut entries, &mut groups, &mut profiles)?;
        }
        Ok(SymbolTable { entries, groups, profiles })
```

Add the accessor:

```rust
    /// Look up a profile by id (infoLink type="profile" target).
    pub fn profile(&self, id: &str) -> Option<&RawProfile> {
        self.profiles.get(id)
    }
```

Extend `walk_entry`/`walk_group` to take `profiles: &mut HashMap<String, RawProfile>` and index each node's own profiles (first-wins, never error) before recursing:

```rust
// in walk_entry, after inserting the entry:
    for p in &entry.profiles {
        profiles.entry(p.id.clone()).or_insert_with(|| p.clone());
    }
// in walk_group, after the id-insert block:
    for p in &group.profiles {
        profiles.entry(p.id.clone()).or_insert_with(|| p.clone());
    }
```

Thread the new `profiles` arg through the recursive `walk_entry`/`walk_group` calls (each recursion passes `profiles`).

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser --lib symbols` (or the test name) → PASS; `cargo test -p engine-parser` → all green (existing symbols tests still pass — the profile arg is additive).

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/resolve/symbols.rs
git commit -m "feat(parser): index a profile pool in SymbolTable"
```

---

### Task 4: Resolve inlines `type="profile"` infoLinks

**Files:**
- Modify: `packages/engine-parser/src/resolve/links.rs`
- Test: `packages/engine-parser/tests/infolink.rs`

**Interfaces:**
- Consumes: `SymbolTable::profile` (Task 3), `RawInfoLink` (Task 1), `RawEntry.info_links`/`RawGroup.info_links`.
- Produces: after `resolve`, an entry/group with a `type="profile"` infoLink has the target profile appended to its `profiles`; `info_links` cleared; unresolved → `infolink.unresolved` diagnostic.

- [ ] **Step 1: Write the failing test** — append to `tests/infolink.rs`:

This test reuses the module-level `XML` const from Task 1 (same file — it already
carries a sharedProfile "Invulnerable Save" + entry `e.u` with the infoLink), so it
exercises the full parse→resolve→to_ir path:

```rust
use engine_parser::parse_bytes;

#[test]
fn resolve_inlines_profile_infolink_end_to_end() {
    let (ir, diags) = parse_bytes(XML, false).unwrap_or_else(|e| panic!("{e:?}"));
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // The linked "Invulnerable Save" profile is now inlined and surfaced in IR.
    assert!(u.profiles.iter().any(|p| p.name == "Invulnerable Save"),
        "linked profile inlined into the entry's profiles");
    assert!(!diags.iter().any(|d| d.code == "infolink.unresolved"));
}
```

Also add the unresolved + hidden/non-profile tests:

```rust
#[test]
fn unresolved_profile_infolink_is_diagnosed_not_fatal() {
    let xml = br#"<?xml version="1.0"?><catalogue id="c" name="C" revision="1" gameSystemId="gs"
      xmlns="http://www.battlescribe.net/schema/catalogueSchema">
      <selectionEntries><selectionEntry id="e.u" name="U" type="model">
        <infoLinks><infoLink type="profile" targetId="absent" hidden="false"/></infoLinks>
      </selectionEntry></selectionEntries></catalogue>"#;
    let (ir, diags) = parse_bytes(xml, false).unwrap();
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.profiles.iter().all(|p| p.name != "Invulnerable Save"));
    assert!(diags.iter().any(|d| d.code == "infolink.unresolved" && d.message.contains("absent")));
}

#[test]
fn hidden_and_non_profile_infolinks_are_not_inlined() {
    let xml = br#"<?xml version="1.0"?><catalogue id="c" name="C" revision="1" gameSystemId="gs"
      xmlns="http://www.battlescribe.net/schema/catalogueSchema">
      <sharedProfiles>
        <profile id="p.hidden" name="Hidden Inv" typeName="Abilities">
          <characteristics><characteristic name="Description">4+</characteristic></characteristics></profile>
        <profile id="p.rule" name="Deep Strike" typeName="Abilities">
          <characteristics><characteristic name="Description">x</characteristic></characteristics></profile>
      </sharedProfiles>
      <selectionEntries><selectionEntry id="e.u" name="U" type="model">
        <infoLinks>
          <infoLink type="profile" targetId="p.hidden" hidden="true"/>
          <infoLink type="rule" targetId="p.rule" hidden="false"/>
        </infoLinks>
      </selectionEntry></selectionEntries></catalogue>"#;
    let (ir, _diags) = parse_bytes(xml, false).unwrap();
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.profiles.is_empty(), "hidden profile link and rule-type link are not inlined");
}
```

- [ ] **Step 2: Run to verify it fails.** Run: `cargo test -p engine-parser --test infolink resolve_inlines_profile`. Expected: FAIL (linked profile not present in IR — infoLinks not yet resolved).

- [ ] **Step 3: Implement.** In `src/resolve/links.rs`:

Extend the import: `use crate::raw::{RawCatalogue, RawEntry, RawEntryLink, RawGroup, RawInfoLink, RawProfile};`

Add a helper (a profile is a leaf — no budget/path/recursion needed):

```rust
/// Inline each `type="profile"` infoLink's target profile into `profiles`.
/// Non-`profile` link types are skipped (rule text is global; infoGroup unmodeled);
/// hidden links are skipped; an unresolvable target is diagnosed and dropped.
fn resolve_info_links(
    info_links: &[RawInfoLink], symbols: &SymbolTable,
    diags: &mut Vec<Diagnostic>, profiles: &mut Vec<RawProfile>,
) {
    for link in info_links {
        if link.link_type != "profile" || link.hidden {
            continue;
        }
        match symbols.profile(&link.target_id) {
            Some(p) => profiles.push(p.clone()),
            None => diags.push(Diagnostic {
                code: "infolink.unresolved".to_string(),
                message: format!("infoLink target {} not found (dropped)", link.target_id),
            }),
        }
    }
}
```

In `resolve_entry`, after the `for link in &entry.entry_links { … }` loop and before `out.entries = children;`, add:

```rust
    resolve_info_links(&entry.info_links, symbols, diags, &mut out.profiles);
```

and after `out.entry_links = Vec::new();` add `out.info_links = Vec::new();`.

In `resolve_group`, likewise: after the `for link in &group.entry_links { … }` loop, add `resolve_info_links(&group.info_links, symbols, diags, &mut out.profiles);`, and after `out.entry_links = Vec::new();` add `out.info_links = Vec::new();`. (`out` is `entry.clone()`/`group.clone()`, so `out.profiles` already holds the node's own profiles; we append the inlined ones.)

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser --test infolink` → all PASS; `cargo test -p engine-parser` → golden + parity + all green.

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/resolve/links.rs packages/engine-parser/tests/infolink.rs
git commit -m "feat(parser): resolve type=profile infoLinks by inlining the shared profile"
```

---

### Task 5: JSON reader parity — read infoLinks + sharedProfiles

**Files:**
- Modify: `packages/engine-parser/src/raw/parse_json.rs`
- Modify: `packages/engine-parser/tests/fixtures/parity/twin.cat`, `twin.json`
- Test: `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Consumes: `RawInfoLink`, `RawCatalogue.shared_profiles` (Task 1); the parity test `xml_and_json_produce_identical_ir` (existing).
- Produces: JSON DTOs `JsonInfoLink`; `info_links` on `JsonEntry`/`JsonGroup`; `shared_profiles` on `JsonCat`; mapped into the raw model so both front-ends produce identical `RawCatalogue`.

- [ ] **Step 1: Add the infoLink case to the twin parity fixtures.** In `tests/fixtures/parity/twin.cat`, inside `<catalogue>` add a `<sharedProfiles>` block and inside the `<selectionEntry id="e.u" …>` add an `<infoLinks>`:

```xml
  <sharedProfiles>
    <profile id="p.inv" name="Invulnerable Save" typeName="Abilities" typeId="pt2">
      <characteristics><characteristic name="Description" typeId="d">4+</characteristic></characteristics>
    </profile>
  </sharedProfiles>
```

and within `e.u`:

```xml
      <infoLinks><infoLink name="Invulnerable Save" hidden="false" type="profile" id="il1" targetId="p.inv"/></infoLinks>
```

In `tests/fixtures/parity/twin.json`, add the identical content: on the catalogue object `"sharedProfiles":[{"id":"p.inv","name":"Invulnerable Save","typeName":"Abilities","typeId":"pt2","characteristics":[{"name":"Description","typeId":"d","$text":"4+"}]}]`, and on the `e.u` entry `"infoLinks":[{"id":"il1","name":"Invulnerable Save","type":"profile","hidden":false,"targetId":"p.inv"}]`.

- [ ] **Step 2: Run the parity test to verify it fails.** Run: `cargo test -p engine-parser --test json xml_and_json_produce_identical_ir`. Expected: FAIL — the XML side now inlines the "Invulnerable Save" profile into `e.u` (Task 4), but the JSON side drops the infoLink/sharedProfiles (DTOs don't read them) → IR differs.

- [ ] **Step 3: Implement JSON DTO reading.** In `src/raw/parse_json.rs`:

Add the DTO:

```rust
#[derive(Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct JsonInfoLink { target_id: String, #[serde(rename = "type")] link_type: String, hidden: bool }
```

Add fields: on `JsonCat` add `shared_profiles: Vec<JsonProfile>,`; on `JsonEntry` and `JsonGroup` add `info_links: Vec<JsonInfoLink>,`.

Map them. Add a helper:

```rust
fn map_info_links(ls: &[JsonInfoLink]) -> Vec<RawInfoLink> {
    ls.iter().map(|l| RawInfoLink {
        target_id: l.target_id.clone(), link_type: l.link_type.clone(), hidden: l.hidden,
    }).collect()
}
```

In `map_cat`, populate `shared_profiles: map_profiles(&c.shared_profiles),` on the `RawCatalogue`. In `map_entry`, add `info_links: map_info_links(&e.info_links),`. In `map_group`, add `info_links: map_info_links(&g.info_links),`. Import `RawInfoLink` (extend the `use crate::raw::model::*;` — it is a glob, so `RawInfoLink` is already in scope once Task 1 defines it; no import change needed).

- [ ] **Step 4: Run tests.** Run: `cargo test -p engine-parser --test json xml_and_json_produce_identical_ir` → PASS (both front-ends now inline the profile identically). Then `cargo test -p engine-parser` → all green.

- [ ] **Step 5: Commit.**

```bash
git add packages/engine-parser/src/raw/parse_json.rs packages/engine-parser/tests/fixtures/parity/twin.cat packages/engine-parser/tests/fixtures/parity/twin.json
git commit -m "feat(parser): JSON reader reads infoLinks + sharedProfiles (XML/JSON parity)"
```

---

### Task 6: Real-data verification (tangible, not committed)

**Files:** none committed.

- [ ] **Step 1: Ensure the wh40k-10e clone.** If `/private/tmp/bsdata-clone/Imperium - Space Wolves.cat` is absent:

```bash
git clone --depth 1 --branch main --single-branch https://github.com/BSData/wh40k-10e.git /private/tmp/bsdata-clone
```

- [ ] **Step 2: Parse real Space Wolves end-to-end.**

```bash
cd packages/engine-parser
cargo run --quiet --bin muster-parse \
  "/private/tmp/bsdata-clone/Imperium - Space Wolves.cat" \
  "/private/tmp/bsdata-clone/Warhammer 40,000.gst" \
  > /tmp/sw.ir.json 2> /tmp/sw.diags.txt
```

Expected: exit 0.

- [ ] **Step 3: Confirm Logan Grimnar now carries the invuln profile.**

```bash
python3 - <<'PY'
import json
ir=json.load(open("/tmp/sw.ir.json"))
def find(entries,name):
    for e in entries:
        if e.get("name")==name: return e
        r=find(e.get("children",[]),name)
        if r: return r
    return None
logan=find(ir["entries"],"Logan Grimnar")
profs=[p for p in (logan or {}).get("profiles",[]) if p.get("name")=="Invulnerable Save"]
print("Logan invuln profiles:", profs)
PY
```

Expected: a non-empty list with an "Invulnerable Save" Abilities profile (Description ~"4+"). Also grep the diags for the residual `infolink.unresolved` count: `grep -c infolink.unresolved /tmp/sw.diags.txt` — record it (a low number is fine; a large one means the profile pool misses a source, worth a follow-up).

- [ ] **Step 4: Spot-check a Custodes unit** (26 invuln links): repeat Steps 2–3 with `Imperium - Adeptus Custodes.cat` and confirm a Custodes unit (e.g. "Custodian Guard") now carries a 4+ "Invulnerable Save" profile.

- [ ] **Step 5: No commit** (verification only). Record the results (Logan ✓, Custodes ✓, residual unresolved count) in the PR/merge description.

---

## Self-Review

**Spec coverage:**
- Read `<sharedProfiles>` + `<infoLinks>` → Task 1. ✅
- Merge shared profiles → Task 2. ✅
- Profile pool in SymbolTable → Task 3. ✅
- Resolve `type="profile"` (tolerant, hidden-skip, non-profile-skip, clear links) → Task 4. ✅
- JSON reader parity → Task 5. ✅
- Real-data verification (Logan, Custodes) → Task 6. ✅
- Non-goals (rule/infoGroup, wargear provenance, republish) → not implemented, per spec. ✅
- Duplicate-profile-id first-wins → Task 3 (pool) + Task 2 (merge). ✅

**Placeholder scan:** No TBD/TODO, no discarded drafts. Every code step is complete and copy-ready.

**Type consistency:** `RawInfoLink { target_id, link_type, hidden }` used consistently across parse (Task 1), symbols is unaffected, resolve (Task 4), JSON map (Task 5). `SymbolTable::profile(id) -> Option<&RawProfile>` defined Task 3, consumed Task 4. `read_profiles_into(dst, r, container_end)` new 3-arg signature (Task 1) used by both existing call sites and the new sharedProfiles site. `resolve_info_links(info_links, symbols, diags, profiles)` defined and called in Task 4. JSON `map_info_links` / `shared_profiles`/`info_links` DTO fields consistent in Task 5.
