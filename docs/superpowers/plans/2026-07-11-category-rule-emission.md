# categoryNames & ruleTexts Emission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Rust parser emits `IrCatalogue.categoryNames` (catId→name) and `IrCatalogue.ruleTexts` (ruleName/alias→description), which the domain schema and web already consume, so real catalogues show role/keyword names and rule tooltips instead of GUIDs/placeholders.

**Architecture:** Two thin additions in `engine-parser`. (1) Raw layer: a flat second pass `read_all_rules(bytes)` collects every `<rule>` definition's `<description>` (keyed by `name` and by `<alias>`), stored on `RawCatalogue.rules`; `merge_supporting` unions it (primary wins) like `categories`. (2) IR layer: `to_ir` copies `categories`→`categoryNames` and `rules`→`ruleTexts` onto `IrCatalogue` as `BTreeMap` (deterministic), each `skip_serializing_if` empty. No domain/web/resolve changes.

**Tech Stack:** Rust (quick-xml 0.41, serde), `#![forbid(unsafe_code)]`. Cargo tests + golden fixture. Node/pnpm monorepo turbo for the cross-package green check.

## Global Constraints

- Change ONLY `packages/engine-parser` (Rust) and its `tests/fixtures/golden/mini40k.ir.json`. Do NOT touch `@muster/domain`, `apps/web`, `@muster/engine-eval`, `@muster/roster`, or the `.cat`/`.catz`/`.gst` fixtures.
- Serde: `#[serde(rename_all = "camelCase")]` already on `IrCatalogue`; new fields serialize as `categoryNames` / `ruleTexts`. Both `#[serde(skip_serializing_if = "BTreeMap::is_empty")]`.
- Determinism: use `BTreeMap<String,String>` (never `HashMap`) for the emitted maps so golden output is byte-stable.
- Rule text extraction must reuse the existing `read_text_until(r, b"...")` helper (handles quick-xml 0.41 `GeneralRef` entities). Do NOT hand-roll entity decoding.
- Keep `#![forbid(unsafe_code)]`; no new dependencies.
- Identifiers/comments in English; commit messages in English with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: Raw layer reads rule definitions (name/alias → description)

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs` (add `rules` field + `BTreeMap` import)
- Modify: `packages/engine-parser/src/raw/parse.rs` (add `read_all_rules` + `read_rule_body`; call at end of `parse_raw`)
- Modify: `packages/engine-parser/src/raw/merge.rs` (union `rules`)
- Test: `packages/engine-parser/tests/raw_parse.rs` (new tests)

**Interfaces:**
- Produces: `RawCatalogue.rules: BTreeMap<String, String>` — populated by `parse_raw`, unioned by `merge_supporting`. Task 2 consumes it.

- [ ] **Step 1: Add the `rules` field to `RawCatalogue`**

In `packages/engine-parser/src/raw/model.rs`, at the top ensure the import includes `BTreeMap`:

```rust
use std::collections::{BTreeMap, HashMap};
```

(If the file currently has `use std::collections::HashMap;`, replace it with the line above.)

Then add the field to `RawCatalogue` (after `categories`):

```rust
    pub categories: HashMap<String, String>,   // id -> name
    pub rules: BTreeMap<String, String>,       // rule name / alias -> description text
```

- [ ] **Step 2: Write the failing raw-reader test**

Add to `packages/engine-parser/tests/raw_parse.rs` (append; keep existing tests). If the crate exposes `parse_raw`/`RawCatalogue` only internally, use the existing test entry point in that file as a model — the reader is exercised through `parse_raw`. Use `engine_parser::raw::parse_raw` if it is `pub`; otherwise add these as `#[cfg(test)] mod tests` inside `parse.rs`. (Check how `raw_parse.rs` currently reaches the parser and follow that path.)

Test content (adapt the import path to match the existing file):

```rust
#[test]
fn reads_nested_rule_by_name_and_alias() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <selectionEntries>
        <selectionEntry id="u" name="Unit" type="unit">
          <rules>
            <rule id="r1" name="Pistol">
              <description>Can shoot in Engagement.</description>
              <alias>PISTOL</alias>
            </rule>
          </rules>
        </selectionEntry>
      </selectionEntries>
    </catalogue>"#;
    let cat = engine_parser::raw::parse_raw(xml).unwrap();
    assert_eq!(cat.rules.get("Pistol").map(String::as_str), Some("Can shoot in Engagement."));
    assert_eq!(cat.rules.get("PISTOL").map(String::as_str), Some("Can shoot in Engagement."));
}

#[test]
fn rule_without_description_is_skipped() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <sharedRules>
        <rule id="r2" name="Empty"/>
        <rule id="r3" name="HasText"><description>&quot;quoted&quot; text</description></rule>
      </sharedRules>
    </catalogue>"#;
    let cat = engine_parser::raw::parse_raw(xml).unwrap();
    assert!(cat.rules.get("Empty").is_none());
    assert_eq!(cat.rules.get("HasText").map(String::as_str), Some("\"quoted\" text"));
}
```

If `engine_parser::raw::parse_raw` / `RawCatalogue.rules` are not public, make the minimum visibility change needed (`pub` on the `raw` module's `parse_raw` re-export, matching how other tests in `raw_parse.rs` access the parser). Prefer following the existing access pattern already used by that test file.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test -p engine-parser --test raw_parse reads_nested_rule_by_name_and_alias`
Expected: FAIL (either compile error for missing `rules` field usage, or the assertion fails because `rules` is empty).

- [ ] **Step 4: Implement `read_all_rules` + `read_rule_body` and wire into `parse_raw`**

In `packages/engine-parser/src/raw/parse.rs`, add `BTreeMap` to the reader's collections import if needed (add `use std::collections::BTreeMap;` near the top if not present).

At the END of `parse_raw`, just before `Ok(cat)`, add:

```rust
    // Rule definitions live both in top-level <sharedRules>/<rules> (game system)
    // and nested inside selectionEntries/forceEntries (faction rules). The main
    // structural loop above skips nested <rules>; a flat second pass captures every
    // <rule> definition regardless of nesting.
    cat.rules = read_all_rules(bytes)?;
    Ok(cat)
```

Add these two functions (place them near `read_text_until`):

```rust
/// Second flat pass collecting every rule definition's text, keyed by the rule's
/// `name` and (when present) its `<alias>`. <rule> elements are definitions that
/// carry a <description>; <infoLink> references have no description and are ignored
/// because they are not <rule> elements. Self-closing <rule/> has no body and is
/// skipped. Keyed into a BTreeMap for deterministic serialization downstream.
fn read_all_rules(bytes: &[u8]) -> Result<BTreeMap<String, String>, ParseError> {
    let mut r = SafeXmlReader::from_bytes(bytes);
    let mut out: BTreeMap<String, String> = BTreeMap::new();
    while let Some(ev) = r.read_event()? {
        if let Event::Start(e) = ev.event {
            if e.local_name().as_ref() == b"rule" {
                let name = attr(&e, b"name");
                let (desc, alias) = read_rule_body(&mut r)?;
                if let Some(desc) = desc.filter(|d| !d.is_empty()) {
                    if let Some(name) = name.filter(|n| !n.is_empty()) {
                        out.insert(name, desc.clone());
                    }
                    if let Some(alias) = alias.filter(|a| !a.is_empty()) {
                        out.insert(alias, desc);
                    }
                }
            }
        }
    }
    Ok(out)
}

/// Read a <rule>'s children until </rule>, returning (description, alias) text.
fn read_rule_body(r: &mut SafeXmlReader) -> Result<(Option<String>, Option<String>), ParseError> {
    let mut desc: Option<String> = None;
    let mut alias: Option<String> = None;
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Start(e) => match e.local_name().as_ref() {
                    b"description" => desc = Some(read_text_until(r, b"description")?),
                    b"alias" => alias = Some(read_text_until(r, b"alias")?),
                    other => {
                        let name = other.to_vec();
                        skip_element(r, &name)?;
                    }
                },
                // Self-closing children (e.g. <alias/>) carry no text.
                Event::Empty(_) => {}
                Event::End(end) if end.local_name().as_ref() == b"rule" => {
                    return Ok((desc, alias))
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in rule".to_string(),
                ))
            }
        }
    }
}
```

Note: `read_all_rules` takes `bytes` — confirm `parse_raw`'s parameter is named `bytes` (it is: `pub fn parse_raw(bytes: &[u8])`). The reader is created via `SafeXmlReader::from_bytes(bytes)`, matching the existing call in `parse_raw`.

- [ ] **Step 5: Run both raw tests to verify they pass**

Run: `cargo test -p engine-parser --test raw_parse reads_nested_rule_by_name_and_alias rule_without_description_is_skipped`
Expected: PASS.

- [ ] **Step 6: Union `rules` in `merge_supporting`**

In `packages/engine-parser/src/raw/merge.rs`, directly after the existing `categories` union loop:

```rust
    for (k, v) in supporting.categories {
        primary.categories.entry(k).or_insert(v);
    }
    for (k, v) in supporting.rules {
        primary.rules.entry(k).or_insert(v);
    }
```

- [ ] **Step 7: Add a merge test for rules**

Append to the `#[cfg(test)] mod tests` in `merge.rs` (follow the existing `unions_maps_and_appends_forces` style):

```rust
    #[test]
    fn unions_rules_primary_wins() {
        let mut primary = RawCatalogue {
            id: "cat".into(), game_system_id: Some("sys".into()),
            rules: std::collections::BTreeMap::from([("Pistol".to_string(), "primary".to_string())]),
            ..Default::default()
        };
        let supporting = RawCatalogue {
            id: "sup".into(), game_system_id: Some("sys".into()),
            rules: std::collections::BTreeMap::from([
                ("Pistol".to_string(), "supporting".to_string()),
                ("Leader".to_string(), "gst text".to_string()),
            ]),
            ..Default::default()
        };
        let mut diags = Vec::new();
        merge_supporting(&mut primary, supporting, &mut diags);
        assert_eq!(primary.rules.get("Pistol").unwrap(), "primary"); // primary wins
        assert_eq!(primary.rules.get("Leader").unwrap(), "gst text"); // gst rule folded in
    }
```

- [ ] **Step 8: Run the raw + merge tests**

Run: `cargo test -p engine-parser --test raw_parse` then `cargo test -p engine-parser merge`
Expected: all PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/engine-parser/src/raw/model.rs packages/engine-parser/src/raw/parse.rs packages/engine-parser/src/raw/merge.rs packages/engine-parser/tests/raw_parse.rs
git commit -m "feat(parser): read rule definitions (name/alias -> description) via flat pass

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: IR emits categoryNames & ruleTexts; regenerate golden

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs` (add two fields to `IrCatalogue` + `BTreeMap` import)
- Modify: `packages/engine-parser/src/ir/map.rs` (populate them in `to_ir`)
- Modify: `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json` (regenerate)
- Test: `packages/engine-parser/tests/map.rs` (new `to_ir` test)

**Interfaces:**
- Consumes: `RawCatalogue.categories` (existing) and `RawCatalogue.rules` (Task 1).
- Produces: `IrCatalogue.category_names` / `IrCatalogue.rule_texts` (`BTreeMap<String,String>`), serialized as `categoryNames` / `ruleTexts`, omitted when empty.

- [ ] **Step 1: Write the failing `to_ir` test**

Append to `packages/engine-parser/tests/map.rs` (follow the existing access pattern for `to_ir`/`RawCatalogue` in that file):

```rust
#[test]
fn emits_category_names_and_rule_texts() {
    let cat = engine_parser::raw::RawCatalogue {
        id: "c".into(), name: "C".into(), game_system_id: Some("g".into()), revision: 1,
        categories: std::collections::HashMap::from([("cat.hq".to_string(), "HQ".to_string())]),
        rules: std::collections::BTreeMap::from([("Pistol".to_string(), "text".to_string())]),
        ..Default::default()
    };
    let (ir, _diags) = engine_parser::ir::to_ir(&cat);
    let v = serde_json::to_value(&ir).unwrap();
    assert_eq!(v["categoryNames"]["cat.hq"], "HQ");
    assert_eq!(v["ruleTexts"]["Pistol"], "text");
}

#[test]
fn omits_empty_category_and_rule_maps() {
    let cat = engine_parser::raw::RawCatalogue {
        id: "c".into(), name: "C".into(), game_system_id: Some("g".into()), revision: 1,
        ..Default::default()
    };
    let (ir, _diags) = engine_parser::ir::to_ir(&cat);
    let v = serde_json::to_value(&ir).unwrap();
    assert!(v.get("categoryNames").is_none());
    assert!(v.get("ruleTexts").is_none());
}
```

Adapt `engine_parser::raw::RawCatalogue` / `engine_parser::ir::to_ir` paths to match how `map.rs` currently imports them (it already calls `to_ir` — reuse that import).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p engine-parser --test map emits_category_names_and_rule_texts`
Expected: FAIL (compile error — `category_names`/`rule_texts` fields don't exist yet, or `categoryNames` missing in the value).

- [ ] **Step 3: Add the fields to `IrCatalogue`**

In `packages/engine-parser/src/ir/model.rs`, ensure the top has:

```rust
use serde::Serialize;
use std::collections::BTreeMap;
```

Add to the `IrCatalogue` struct, after `force_constraints`:

```rust
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub force_constraints: Vec<IrConstraint>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub category_names: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub rule_texts: BTreeMap<String, String>,
```

- [ ] **Step 4: Populate them in `to_ir`**

In `packages/engine-parser/src/ir/map.rs`, extend the `IrCatalogue { ... }` literal in `to_ir` (after `force_constraints,`):

```rust
        entries,
        force_constraints,
        category_names: cat.categories.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        rule_texts: cat.rules.clone(),
```

(`cat.categories` is a `HashMap`; `.collect()` into the field's `BTreeMap` sorts keys deterministically. `cat.rules` is already a `BTreeMap`.)

- [ ] **Step 5: Run the `to_ir` tests to verify they pass**

Run: `cargo test -p engine-parser --test map emits_category_names_and_rule_texts omits_empty_category_and_rule_maps`
Expected: PASS.

- [ ] **Step 6: Regenerate the golden fixture**

The golden test will now fail because `mini40k.cat` has 3 `<categoryEntry>` → `categoryNames` now appears. Regenerate the committed golden JSON from the parser itself:

Run:
```bash
cargo run -q -p engine-parser --bin muster-parse packages/engine-parser/tests/fixtures/mini40k.cat 2>/dev/null > packages/engine-parser/tests/fixtures/golden/mini40k.ir.json
```

Then inspect the diff: `git diff packages/engine-parser/tests/fixtures/golden/mini40k.ir.json` — it MUST show ONLY an added `categoryNames` object (the 3 mini40k categories) and NO other changes. `ruleTexts` MUST NOT appear (the fixture has no `<rule>`). If anything else changed, stop and investigate before continuing.

- [ ] **Step 7: Run the golden + zip-equivalence tests**

Run: `cargo test -p engine-parser --test golden`
Expected: both `parser_output_matches_golden` and `parses_the_zip_form_identically` PASS.

- [ ] **Step 8: Run the full crate test suite**

Run: `cargo test -p engine-parser`
Expected: ALL tests PASS (including `multi_file`, `proptest`, `smoke`). If a multi-file test asserts on output shape, update its expectation only if the change is the expected `categoryNames`/`ruleTexts` addition; otherwise investigate.

- [ ] **Step 9: Run the full monorepo test suite**

Run: `pnpm -w turbo run test`
Expected: 4/4 packages green (the TS side already accepts both fields; this confirms no cross-package break).

- [ ] **Step 10: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs packages/engine-parser/tests/fixtures/golden/mini40k.ir.json
git commit -m "feat(parser): emit categoryNames and ruleTexts on IrCatalogue

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- categoryNames emission — Task 2 Steps 3–4, tested Step 1, golden Step 6.
- ruleTexts flat-pass reading (name + alias, nested) — Task 1 Steps 4, tested Step 2.
- merge union of rules — Task 1 Steps 6–7.
- Empty maps omitted (domain default/optional compat) — Task 2 `omits_empty_...` test.
- Determinism (BTreeMap) — enforced in both struct fields and `to_ir` collect.
- Real-data tangible check — deferred to controller post-merge (not a CI task; real GW-IP IR stays out of git).

**Placeholder scan:** The only non-verbatim points are the test import paths ("adapt to match the existing file"), because the exact `pub` visibility of `parse_raw`/`to_ir`/`RawCatalogue` in the test crate is not shown here. The implementer must read `tests/raw_parse.rs` and `tests/map.rs` headers first and follow their existing import pattern. Every code block that touches `src/` is complete and verbatim.

**Type consistency:** `RawCatalogue.rules: BTreeMap<String,String>` (Task 1) is consumed by `to_ir` as `cat.rules.clone()` (Task 2). `IrCatalogue.category_names`/`rule_texts` are `BTreeMap<String,String>` in both the struct and the `to_ir` literal. `read_all_rules(bytes)` matches `parse_raw`'s `bytes: &[u8]` parameter and `SafeXmlReader::from_bytes`.

## Execution Handoff

Subagent-Driven: dispatch Task 1, review, then Task 2, review, then final whole-branch review + full turbo. (Two coupled tasks; Task 2 depends on Task 1's `RawCatalogue.rules`.)
