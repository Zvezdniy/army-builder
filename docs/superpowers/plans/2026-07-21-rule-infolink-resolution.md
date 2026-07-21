# Rule-InfoLink Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Rust parser record a rule attached to an entry via `<infoLink type="rule">` in that entry's `rule_names`, so missing detachment rule descriptions (Sororitas, Necrons, …) appear.

**Architecture:** An `<infoLink type="rule">` carries a `name` attribute that is exactly the key under which the rule's text is already collected into `IrCatalogue.ruleTexts`. So (unlike a profile infoLink, whose content must be resolved by id) restoring the association needs only the link's `name`: capture it in both readers, then in the resolve phase append every non-hidden rule-link name to the owning entry's `rule_names`, deduped. No schema, TypeScript, or `ruleTexts` change.

**Tech Stack:** Rust (`packages/engine-parser`), quick-xml + serde_json readers, cargo test. Verification uses Node audit scripts + the web dev server.

## Global Constraints

- Approach 1 (generic): resolve rule infoLinks on **every** entry, mirroring the existing `type="profile"` inlining in `resolve/links.rs`. The parser stays convention-agnostic — it does NOT special-case "detachment". Only the consumer (SetupWizard) knows what a detachment is.
- Use the link's own `name` as the association key; do **not** add an id→rule symbol table. Skip hidden links and empty-name links.
- Dedup: a name already present in `rule_names` (from a direct `<rule>`) is not added twice.
- No change to `ruleNames` semantics beyond "inline **and** linked rules". No new IR fields, no packing change.
- Do NOT run `scripts/update-catalogues.mjs` inside a subagent (~20 min). Do NOT run `git stash` or `git add -A`; stage explicit paths. `.claude/` stays untracked.
- Rust IR field is `rule_names` (serialized as `ruleNames`). `parse_raw(xml)` / `parse_raw_json(json, &mut Vec::new())` return a `RawCatalogue`; `parse_bytes(xml_or_json, false)` returns `(IrCatalogue, Vec<Diagnostic>)`.

---

## File Structure

- `packages/engine-parser/src/raw/model.rs` — `RawInfoLink` gains `pub name: String`.
- `packages/engine-parser/src/raw/parse.rs` — XML reader: capture the `name` attribute (two `RawInfoLink` literals).
- `packages/engine-parser/src/raw/parse_json.rs` — JSON reader: `JsonInfoLink` gains `name`; `map_info_links` copies it.
- `packages/engine-parser/src/resolve/links.rs` — new `resolve_rule_info_links` helper called from `resolve_entry`; one test-only `RawInfoLink` literal updated; new unit tests.
- `packages/engine-parser/tests/infolink.rs` — extend integration coverage (name round-trip + rule-link → ruleNames end-to-end).
- `packages/engine-parser/tests/json.rs` — JSON infoLink `name` round-trip.

Goldens (`tests/fixtures/golden/mini40k.ir.json`) are unaffected: no fixture (`mini40k.cat`, `mini11e.catalogue.json`, `parity/twin.*`) contains a `type="rule"` infoLink. If a golden test nonetheless fails, STOP and inspect — do not blindly regenerate.

---

## Task 1: Capture the infoLink `name` in both readers

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs:83-88` (RawInfoLink struct)
- Modify: `packages/engine-parser/src/raw/parse.rs:497-525` (`read_infolinks_into`, two literals)
- Modify: `packages/engine-parser/src/raw/parse_json.rs:115` (JsonInfoLink) and `380-384` (`map_info_links`)
- Modify: `packages/engine-parser/src/resolve/links.rs:1022-1023` (test-only literal — add `name`)
- Test: `packages/engine-parser/tests/infolink.rs`, `packages/engine-parser/tests/json.rs`

**Interfaces:**
- Produces: `RawInfoLink { target_id: String, link_type: String, hidden: bool, name: String }` — Task 2 reads `.name` and `.link_type`/`.hidden`.

- [ ] **Step 1: Extend the XML integration test to assert `name` round-trips**

In `packages/engine-parser/tests/infolink.rs`, in `parse_reads_shared_profiles_and_infolinks`, after the existing `target_id`/`link_type` assertion add:

```rust
    assert_eq!(u.info_links[0].name, "Invulnerable Save");
```

(The fixture's `<infoLink name="Invulnerable Save" … type="profile" …/>` already carries the name.)

- [ ] **Step 2: Add a JSON `name` round-trip test**

In `packages/engine-parser/tests/json.rs`, add:

```rust
#[test]
fn info_link_name_round_trips() {
    let json = br#"{"catalogue":{"id":"c","name":"C","revision":1,"gameSystemId":"gs",
      "selectionEntries":[{"id":"e.u","name":"U","type":"unit",
        "infoLinks":[{"id":"l","name":"The Blood of Martyrs","type":"rule","targetId":"r1"}]}]}}"#;
    let raw = parse_raw_json(json, &mut Vec::new()).unwrap();
    let u = raw.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.info_links.len(), 1);
    assert_eq!(u.info_links[0].name, "The Blood of Martyrs");
    assert_eq!(u.info_links[0].link_type, "rule");
}
```

- [ ] **Step 3: Run both tests to verify they FAIL to compile / assert**

Run: `cargo test -p engine-parser --test infolink --test json 2>&1 | tail -20`
Expected: compile error `no field 'name' on type '&RawInfoLink'` (name field does not exist yet).

- [ ] **Step 4: Add `name` to `RawInfoLink`**

In `packages/engine-parser/src/raw/model.rs`, change the struct to:

```rust
#[derive(Debug, Default, Clone)]
pub struct RawInfoLink {
    pub target_id: String,
    pub link_type: String,   // profile | rule | infoGroup
    pub hidden: bool,
    pub name: String,        // the link's display name; for a rule link this is the ruleTexts key
}
```

- [ ] **Step 5: Capture `name` in the XML reader (both literals)**

In `packages/engine-parser/src/raw/parse.rs`, in `read_infolinks_into`, add `name:` to BOTH `RawInfoLink { … }` literals (the `Event::Empty` and `Event::Start` arms):

```rust
                    dst.push(RawInfoLink {
                        target_id: attr(&e, b"targetId").unwrap_or_default(),
                        link_type: attr(&e, b"type").unwrap_or_default(),
                        hidden: attr_bool(&e, b"hidden"),
                        name: attr(&e, b"name").unwrap_or_default(),
                    });
```

(Apply the same `name:` line in the second literal inside the `Event::Start` arm.)

- [ ] **Step 6: Capture `name` in the JSON reader**

In `packages/engine-parser/src/raw/parse_json.rs`, change `JsonInfoLink` (line 115) to:

```rust
struct JsonInfoLink { target_id: String, #[serde(rename = "type")] link_type: String, hidden: bool, name: String }
```

and `map_info_links` (lines 380-384) to copy it:

```rust
fn map_info_links(ls: &[JsonInfoLink]) -> Vec<RawInfoLink> {
    ls.iter().map(|l| RawInfoLink {
        target_id: l.target_id.clone(), link_type: l.link_type.clone(), hidden: l.hidden,
        name: l.name.clone(),
    }).collect()
}
```

- [ ] **Step 7: Fix the test-only `RawInfoLink` literal in links.rs**

In `packages/engine-parser/src/resolve/links.rs` around line 1022, the `link_profile_and_infolink_reach_the_clone` test constructs a `RawInfoLink` without `name`. Add `name`:

```rust
        rich.info_links.push(RawInfoLink {
            target_id: "shared.p".into(), link_type: "profile".into(), hidden: false, name: String::new() });
```

- [ ] **Step 8: Run the tests to verify they PASS**

Run: `cargo test -p engine-parser --test infolink --test json 2>&1 | tail -20`
Expected: PASS (name round-trips in both readers).

- [ ] **Step 9: Commit**

```bash
git add packages/engine-parser/src/raw/model.rs packages/engine-parser/src/raw/parse.rs \
        packages/engine-parser/src/raw/parse_json.rs packages/engine-parser/src/resolve/links.rs \
        packages/engine-parser/tests/infolink.rs packages/engine-parser/tests/json.rs
git commit -m "$(cat <<'EOF'
feat(parser): capture the infoLink name in both readers

RawInfoLink gains a name field; the XML and JSON readers record each
<infoLink>'s name attribute. Needed to resolve type="rule" links, whose
name is the key into the global ruleTexts map. No consumer yet.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Resolve rule infoLinks into `rule_names`

**Files:**
- Modify: `packages/engine-parser/src/resolve/links.rs` (add `resolve_rule_info_links`; call it in `resolve_entry` at ~line 542; new unit tests in the `#[cfg(test)] mod tests`)
- Test: `packages/engine-parser/tests/infolink.rs` (end-to-end)

**Interfaces:**
- Consumes: `RawInfoLink.name` / `.link_type` / `.hidden` from Task 1.
- Produces: resolved `IrEntry.rule_names` now includes non-hidden rule-link names (deduped). SetupWizard already reads `ruleNames`.

- [ ] **Step 1: Write the end-to-end failing test (rule link → ruleNames)**

In `packages/engine-parser/tests/infolink.rs`, add:

```rust
#[test]
fn resolve_rule_infolink_lands_in_rule_names() {
    let xml = br#"<?xml version="1.0"?><catalogue id="c" name="C" revision="1" gameSystemId="gs"
      xmlns="http://www.battlescribe.net/schema/catalogueSchema">
      <sharedRules>
        <rule id="r.mart" name="The Blood of Martyrs"><description>Reroll.</description></rule>
      </sharedRules>
      <selectionEntries><selectionEntry id="e.det" name="Hallowed Martyrs" type="upgrade">
        <infoLinks>
          <infoLink name="The Blood of Martyrs" hidden="false" type="rule" id="l1" targetId="r.mart"/>
        </infoLinks>
      </selectionEntry></selectionEntries></catalogue>"#;
    let (ir, _diags) = parse_bytes(xml, false).unwrap();
    let d = ir.entries.iter().find(|e| e.id == "e.det").unwrap();
    assert!(d.rule_names.iter().any(|n| n == "The Blood of Martyrs"),
        "rule infoLink name is recorded in rule_names");
    // And its text is resolvable through the global rule map.
    assert_eq!(ir.rule_texts.get("The Blood of Martyrs").map(String::as_str), Some("Reroll."));
}
```

- [ ] **Step 2: Extend the existing name-less rule-link test to assert no ruleName is added**

In `packages/engine-parser/tests/infolink.rs`, in `hidden_and_non_profile_infolinks_are_not_inlined`, after the existing `u.profiles.is_empty()` assertion add:

```rust
    assert!(u.rule_names.is_empty(),
        "a rule link with no name attribute adds no rule name (nothing to key on)");
```

- [ ] **Step 3: Run the tests to verify they FAIL**

Run: `cargo test -p engine-parser --test infolink 2>&1 | tail -20`
Expected: `resolve_rule_infolink_lands_in_rule_names` FAILS (rule_names is empty — resolution not implemented).

- [ ] **Step 4: Add the `resolve_rule_info_links` helper**

In `packages/engine-parser/src/resolve/links.rs`, next to `resolve_info_links` (the profile pass, ~line 505), add:

```rust
/// Append each non-hidden `type="rule"` infoLink's name to `rule_names`, deduped
/// against names already present. Unlike a profile link (whose content is resolved
/// by id), a rule link's `name` IS the key into the global rule-text map, so no
/// symbol lookup is needed. Empty-name links (no key to record) are skipped.
fn resolve_rule_info_links(info_links: &[RawInfoLink], rule_names: &mut Vec<String>) {
    for link in info_links {
        if link.link_type != "rule" || link.hidden || link.name.is_empty() {
            continue;
        }
        if !rule_names.iter().any(|n| n == &link.name) {
            rule_names.push(link.name.clone());
        }
    }
}
```

- [ ] **Step 5: Call it from `resolve_entry`**

In `packages/engine-parser/src/resolve/links.rs`, in `resolve_entry`, immediately after the existing profile-pass line:

```rust
    resolve_info_links(&entry.info_links, symbols, diags, &mut out.profiles);
```

add:

```rust
    resolve_rule_info_links(&entry.info_links, &mut out.rule_names);
```

(`out` is `entry.clone()`, so `out.rule_names` already holds any direct `<rule>` names; the dedup in the helper prevents doubling.)

- [ ] **Step 6: Run the end-to-end tests to verify they PASS**

Run: `cargo test -p engine-parser --test infolink 2>&1 | tail -20`
Expected: PASS (both the new test and the extended name-less test).

- [ ] **Step 7: Add resolve-level unit tests (dedup, hidden, type, order)**

In `packages/engine-parser/src/resolve/links.rs`, inside `#[cfg(test)] mod tests`, add:

```rust
    fn rule_link(name: &str, hidden: bool) -> RawInfoLink {
        RawInfoLink { target_id: "t".into(), link_type: "rule".into(), hidden, name: name.into() }
    }

    #[test]
    fn rule_info_links_append_dedup_skip_hidden_and_empty() {
        let mut names = vec!["Angelic Judgement".to_string()]; // a direct <rule> already present
        let links = vec![
            rule_link("The Blood of Martyrs", false), // added
            rule_link("Angelic Judgement", false),    // dedup: already present
            rule_link("Hidden Rule", true),           // skip: hidden
            rule_link("", false),                     // skip: empty name
            RawInfoLink { target_id: "p".into(), link_type: "profile".into(), hidden: false, name: "Some Profile".into() }, // skip: not a rule
        ];
        resolve_rule_info_links(&links, &mut names);
        assert_eq!(names, vec!["Angelic Judgement", "The Blood of Martyrs"],
            "direct name kept first; one linked name appended; hidden/empty/profile skipped; no dup");
    }
```

- [ ] **Step 8: Run the parser unit + integration suite**

Run: `cargo test -p engine-parser 2>&1 | tail -25`
Expected: all pass, including the golden test (`tests/golden.rs`) unchanged. If the golden fails, STOP and inspect the diff — do not regenerate blindly.

- [ ] **Step 9: Commit**

```bash
git add packages/engine-parser/src/resolve/links.rs packages/engine-parser/tests/infolink.rs
git commit -m "$(cat <<'EOF'
feat(parser): resolve type="rule" infoLinks into rule_names

Every non-hidden rule infoLink's name is appended to the owning entry's
rule_names (deduped against direct <rule> names), mirroring the profile
infoLink pass. Restores detachment rule associations lost when a rule is
attached by reference (Sororitas Hallowed Martyrs, Necrons, etc.); the
rule text already lives in ruleTexts under that name.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Republish data & verify (controller-executed, NOT a subagent)

This task reparses/repacks the real catalogues and confirms the fix on live data. The repack is ~20 min and MUST NOT run in a subagent.

**Files:** none (regenerates gitignored `apps/web/public/catalogues/**`).

- [ ] **Step 1: Rebuild the parser release binary**

Run: `cargo build -p engine-parser --release 2>&1 | tail -3`
Expected: `Finished release`.

- [ ] **Step 2: Reparse + repack all catalogues locally**

Run: `node scripts/update-catalogues.mjs 2>&1 | tail -20`
Expected: all 34 factions × both editions rebuilt, 0 failures.

- [ ] **Step 3: Re-run the detachment audit and confirm rule associations recovered**

Run the audit at `/private/tmp/claude-502/-Users-avksentiev-Projects-army-builder/5cc503e6-7245-4304-8818-0512eadb9e43/scratchpad/det-audit.mjs`:
`node <scratchpad>/det-audit.mjs 2>&1 | grep -E "sororitas|necrons|world-eaters|chaos-daemons"`
Expected: `rulesMissing` for Adepta Sororitas drops from `5/8` toward `0/8`; Necrons `9/12` and the others drop sharply. Any residual is a genuine upstream data gap (rule with no name and no direct `<rule>`), not a regression.

- [ ] **Step 4: Browser-verify a previously-blank detachment**

With the web dev server on real data, open the setup wizard → 11th Edition → Adepta Sororitas → Detachment, select **Hallowed Martyrs**, and confirm the rule **The Blood of Martyrs** now shows its description text (was blank). Screenshot as proof.

- [ ] **Step 5: Publish**

After merge to `main`, trigger `update-catalogues.yml` (`workflow_dispatch`) so the deployed IR carries the new `ruleNames`, then spot-check a republished Sororitas IR from the Pages URL.

---

## Self-Review notes

- **Spec coverage:** readers capture name (Task 1) → resolve emits (Task 2) → republish + verify (Task 3). Dedup, hidden-skip, empty-skip, non-rule-skip all covered by Task 2 Step 7. Real-data acceptance = Task 3 Steps 3-4.
- **Type consistency:** `RawInfoLink.name: String` defined in Task 1 Step 4; consumed in Task 2 Steps 4-5,7. Rust IR field `rule_names` used throughout; `ir.rule_texts` map used in Task 2 Step 1.
- **No golden churn:** verified no fixture carries a `type="rule"` infoLink; Task 2 Step 8 guards against silent golden change.
