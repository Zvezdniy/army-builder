# entryLink-hosted hidden — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the `hidden` attribute and `<modifiers>` that live on a BattleScribe `<entryLink>` and apply the hidden ones to the inlined instance, so link-hosted (detachment-gated) visibility survives resolution.

**Architecture:** Parser-only change. `RawEntryLink` gains `hidden` + `modifiers`; `read_entrylinks_into` reads them (descending into a Start entryLink's body); `resolve_link` applies the link's static hidden + `field="hidden"` modifiers onto the freshly-cloned inlined `RawEntry` (per-placement), then the existing `map_entry` path turns them into `IrEntry.visibilityModifiers`. Non-hidden and group-level link visibility are dropped loudly with diagnostics. Domain, engine-eval, and web are untouched.

**Tech Stack:** Rust (quick-xml + serde), `#![forbid(unsafe_code)]`, clippy `-D warnings`; cargo test.

## Global Constraints

- **Never miscompile / never over-hide**: link hidden-modifiers flow through the EXISTING strict `map_visibility_modifier` (maps only if ALL conditions supported, else the whole modifier drops → entry stays visible). Do NOT add a new mapping path. Static hidden combines as `resolved.hidden = resolved.hidden || link.hidden` (only ever adds hiding).
- Parser only. Do NOT modify `packages/domain`, `packages/engine-eval`, or `apps/web`.
- Reuse existing helpers `attr_bool` and `read_modifiers_into` (both in `raw/parse.rs`). Do NOT duplicate modifier-parsing logic.
- clippy clean (no `assert_eq!(x, true)` — use `assert!`).
- Golden `mini40k.ir.json` must stay byte-identical (fixture has no link-hosted hidden). If it changes, stop and investigate.
- `RawModifier` fields: `kind, field, value, value_raw, conditions, condition_groups, has_repeats`. `field == "hidden"` marks a visibility modifier.
- New diagnostic codes: `entryLink.modifier_dropped` (non-hidden modifier on a link), `entryLink.group_hidden_unsupported` (hidden visibility on a group-link).
- Commit messages/code/identifiers in English.

---

### Task 1: raw capture — `RawEntryLink` fields + `read_entrylinks_into`

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs:47` (RawEntryLink struct)
- Modify: `packages/engine-parser/src/raw/parse.rs:624-650` (read_entrylinks_into)
- Test: `packages/engine-parser/tests/raw_parse.rs`

**Interfaces:**
- Produces: `RawEntryLink { target_id: String, link_type: String, hidden: bool, modifiers: Vec<RawModifier> }`. Consumed by Task 2 (resolve).

- [ ] **Step 1: Write the failing raw tests**

Append to `packages/engine-parser/tests/raw_parse.rs`:

```rust
#[test]
fn entrylink_carries_hidden_attr_and_modifiers() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared" hidden="true">
          <modifiers>
            <modifier type="set" value="true" field="hidden">
              <conditions>
                <condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="cat.x"/>
              </conditions>
            </modifier>
          </modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = engine_parser::raw::parse_raw(xml).unwrap();
    let host = raw.entries.iter().find(|e| e.id == "host").unwrap();
    let lk = &host.entry_links[0];
    assert_eq!(lk.target_id, "shared");
    assert!(lk.hidden);
    assert_eq!(lk.modifiers.len(), 1);
    assert_eq!(lk.modifiers[0].field, "hidden");
    assert_eq!(lk.modifiers[0].conditions.len(), 1);
}

#[test]
fn empty_entrylink_has_hidden_attr_no_modifiers() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared" hidden="true"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = engine_parser::raw::parse_raw(xml).unwrap();
    let host = raw.entries.iter().find(|e| e.id == "host").unwrap();
    let lk = &host.entry_links[0];
    assert!(lk.hidden);
    assert!(lk.modifiers.is_empty());
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p engine-parser --test raw_parse`
Expected: FAIL — `RawEntryLink` has no `hidden`/`modifiers` fields (compile error).

- [ ] **Step 3: Add the fields**

In `packages/engine-parser/src/raw/model.rs`, change the `RawEntryLink` struct (line 47) from:

```rust
#[derive(Debug, Default, Clone)] pub struct RawEntryLink { pub target_id: String, pub link_type: String }
```

to:

```rust
#[derive(Debug, Default, Clone)] pub struct RawEntryLink { pub target_id: String, pub link_type: String, pub hidden: bool, pub modifiers: Vec<RawModifier> }
```

- [ ] **Step 4: Read hidden + modifiers in `read_entrylinks_into`**

In `packages/engine-parser/src/raw/parse.rs`, replace the body of `read_entrylinks_into` (the `loop { match r.read_event()? { ... } }`) so a Start entryLink descends into its body. Replace lines 628-649 with:

```rust
    loop {
        match r.read_event()? {
            Some(ev) => match ev.event {
                Event::Empty(e) if e.local_name().as_ref() == b"entryLink" => {
                    dst.push(RawEntryLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        modifiers: Vec::new(),
                    });
                }
                Event::Start(e) if e.local_name().as_ref() == b"entryLink" => {
                    let mut link = RawEntryLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        modifiers: Vec::new(),
                    };
                    // Read the link body: pick up its <modifiers>, skip anything else,
                    // stop at </entryLink>.
                    loop {
                        match r.read_event()? {
                            Some(inner) => match inner.event {
                                Event::Start(m) if m.local_name().as_ref() == b"modifiers" => {
                                    read_modifiers_into(&mut link.modifiers, r)?;
                                }
                                Event::End(end) if end.local_name().as_ref() == b"entryLink" => break,
                                Event::Start(other) => skip_element(r, other.local_name().as_ref())?,
                                None => return Err(ParseError::MalformedXml(
                                    "unexpected EOF in entryLink".to_string(),
                                )),
                                _ => {}
                            },
                            None => return Err(ParseError::MalformedXml(
                                "unexpected EOF in entryLink".to_string(),
                            )),
                        }
                    }
                    dst.push(link);
                }
                Event::End(end) if end.local_name().as_ref() == b"entryLinks" => return Ok(()),
                Event::Start(e) => {
                    skip_element(r, e.local_name().as_ref())?;
                }
                _ => {}
            },
            None => {
                return Err(ParseError::MalformedXml(
                    "unexpected EOF in entryLinks".to_string(),
                ))
            }
        }
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p engine-parser --test raw_parse`
Expected: PASS (both new tests + all pre-existing raw_parse tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine-parser/src/raw/model.rs packages/engine-parser/src/raw/parse.rs packages/engine-parser/tests/raw_parse.rs
git commit -m "feat(parser): RawEntryLink captures hidden attr + modifiers"
```

---

### Task 2: resolve — apply link hidden to the inlined instance

**Files:**
- Modify: `packages/engine-parser/src/resolve/links.rs:96-127` (resolve_link) + new helper
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Consumes: `RawEntryLink.hidden`, `RawEntryLink.modifiers` (Task 1).
- Produces: inlined instances carry link-hosted hidden as `IrEntry.visibilityModifiers` / `IrEntry.hidden`; diagnostics `entryLink.modifier_dropped`, `entryLink.group_hidden_unsupported`.

- [ ] **Step 1: Write the failing resolve/map tests**

Append to `packages/engine-parser/tests/map.rs` (existing pattern: `to_ir(&resolve(parse_raw(xml).unwrap()).unwrap())`):

```rust
#[test]
fn entrylink_hidden_modifier_lands_on_inlined_instance() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers>
            <modifier type="set" value="true" field="hidden">
              <conditions>
                <condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="cat.x"/>
              </conditions>
            </modifier>
          </modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    assert_eq!(inlined.visibility_modifiers.len(), 1, "link hidden modifier must land on the inlined instance");
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"));
}

#[test]
fn entrylink_static_hidden_sets_inlined_instance_hidden() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared" hidden="true"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    assert!(inlined.hidden);
}

#[test]
fn entrylink_non_hidden_modifier_is_dropped_loudly() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Enh" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers>
            <modifier type="increment" field="pts" value="5"/>
          </modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    assert!(inlined.visibility_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "entryLink.modifier_dropped"));
}

#[test]
fn group_link_hidden_modifier_is_unsupported_diagnostic() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="grp" name="G"/>
  </sharedSelectionEntryGroups>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntryGroup" targetId="grp">
          <modifiers>
            <modifier type="set" value="true" field="hidden">
              <conditions>
                <condition type="notInstanceOf" value="1" field="selections" scope="ancestor" childId="cat.x"/>
              </conditions>
            </modifier>
          </modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (_ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    assert!(diags.iter().any(|d| d.code == "entryLink.group_hidden_unsupported"));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p engine-parser --test map`
Expected: FAIL — link modifiers are currently discarded; the inlined instance has no visibility modifier / hidden, and neither diagnostic is emitted.

- [ ] **Step 3: Add `apply_link_visibility` and wire it into `resolve_link`**

In `packages/engine-parser/src/resolve/links.rs`, add this helper (place it just below `resolve_link`, before `resolve_entry`):

```rust
/// Apply an entryLink's own visibility (static `hidden` + `field="hidden"`
/// modifiers) onto the freshly-cloned inlined instance. `resolved` is unique
/// per placement, so appended modifiers never leak to the shared target.
/// Non-hidden modifiers on a link (cost/constraint) are a separate slice —
/// dropped loudly here rather than silently.
fn apply_link_visibility(link: &RawEntryLink, resolved: &mut RawEntry, diags: &mut Vec<Diagnostic>) {
    if link.hidden {
        resolved.hidden = true;
    }
    for m in &link.modifiers {
        if m.field == "hidden" {
            resolved.modifiers.push(m.clone());
        } else {
            diags.push(Diagnostic {
                code: "entryLink.modifier_dropped".to_string(),
                message: format!(
                    "entryLink to {} has a non-hidden modifier (field {}); dropped",
                    link.target_id, m.field
                ),
            });
        }
    }
}
```

Then wire it into `resolve_link`. In the entry branch (the `else { ... }` around line 113-125), after `let resolved = resolve_entry(...)?;` and `path.remove(...)`, change `resolved` to `mut` and apply the helper before pushing:

```rust
    } else {
        let target = match symbols.entry(&link.target_id) {
            Some(t) => t,
            None => { diags.push(unresolved_link_diag(&link.target_id)); return Ok(()); }
        };
        if path.contains(&link.target_id) {
            return Err(ParseError::ReferenceCycle(link.target_id.clone()));
        }
        path.insert(link.target_id.clone());
        let mut resolved = resolve_entry(target, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        apply_link_visibility(link, &mut resolved, diags);
        children.push(resolved);
    }
```

And in the group branch (the `if link.link_type == "selectionEntryGroup" { ... }` block), after the group is resolved and pushed, diagnose any link-hosted visibility (which cannot attach to a flattened group). Insert immediately after `groups.push(resolved);`:

```rust
        if link.hidden || link.modifiers.iter().any(|m| m.field == "hidden") {
            diags.push(Diagnostic {
                code: "entryLink.group_hidden_unsupported".to_string(),
                message: format!("entryLink to group {} carries hidden visibility; unsupported (dropped)", link.target_id),
            });
        }
        for m in link.modifiers.iter().filter(|m| m.field != "hidden") {
            diags.push(Diagnostic {
                code: "entryLink.modifier_dropped".to_string(),
                message: format!("entryLink to group {} has a non-hidden modifier (field {}); dropped", link.target_id, m.field),
            });
        }
```

(Confirm `Diagnostic` and `RawEntry`/`RawModifier` are in scope in `links.rs`; add `use` imports if the compiler flags them — follow the existing import style at the top of the file.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p engine-parser --test map`
Expected: the four new tests PASS.

- [ ] **Step 5: Confirm the golden is byte-identical + full suite + clippy**

Run: `cargo test -p engine-parser && cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: ALL green (including the golden test — no fixture change), clippy clean. If the golden test fails, STOP and report: the fixture unexpectedly contains link-hosted hidden.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-parser/src/resolve/links.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): apply entryLink-hosted hidden to inlined instance"
```

---

### Task 3: real-catalogue evidence (verification only)

**Files:** none.

- [ ] **Step 1: Parse the real SM catalogue and confirm the win**

If a scratchpad real catalogue is available, run `muster-parse` on it and confirm:
- inlined instances now carry link-hosted `visibilityModifiers` (spot-check that total `visibilityModifiers` count rose vs. before, or that ~16 Enhancement links now map),
- `entryLink.modifier_dropped` ≈ 36 (the deferred cost-on-link),
- `entryLink.group_hidden_unsupported` ≈ 1,
- no panic, no golden drift.

This is evidence for the final report, not a committed test.

---

## Self-Review

**Spec coverage:**
- `RawEntryLink` += hidden + modifiers → Task 1 Step 3. ✓
- `read_entrylinks_into` reads hidden attr + descends for modifiers (Start vs Empty) → Task 1 Step 4. ✓
- `apply_link_visibility` (static hidden OR; append hidden modifiers; drop non-hidden loudly) → Task 2 Step 3. ✓
- Group-link hidden → `entryLink.group_hidden_unsupported`; group-link non-hidden → `entryLink.modifier_dropped` → Task 2 Step 3. ✓
- Downstream untouched (map_entry existing path turns appended hidden modifiers into visibilityModifiers) — no domain/eval/web tasks. ✓
- Golden byte-identical → Task 2 Step 5. ✓
- Never-over-hide via existing strict mapping + `resolved.hidden || link.hidden` → Global Constraints + helper. ✓
- Real-SM evidence → Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code step is concrete. ✓

**Type consistency:** `RawEntryLink { target_id, link_type, hidden, modifiers }` used identically in parse (Task 1) and resolve (Task 2). `apply_link_visibility(&RawEntryLink, &mut RawEntry, &mut Vec<Diagnostic>)` matches its one call site. `RawModifier.field`/`.clone()` match the model. Diagnostic codes are spelled identically in the helper, the group branch, and the assertions. ✓
