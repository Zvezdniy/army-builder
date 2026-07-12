# entryLink-hosted Modifiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply an entryLink's own `<modifiers>` to the inlined per-placement instance by appending them to the resolved clone's `modifiers`, so the existing modifier routing (`map_entry`, `map_group_constraint`) handles per-placement cost/constraint/error/category/hidden — instead of loudly dropping every non-hidden link modifier.

**Architecture:** Parser-only, at resolve time (`resolve/links.rs`). `resolve_entry`/`resolve_group` already return a unique per-placement clone (`out = target.clone()`), and downstream `map_entry`/`map_group_constraint` already route an entity's/group's own modifiers strictly. So the fix is: push the link's modifiers onto the resolved clone's `modifiers` (as already done for `field="hidden"`), then let the existing routing do the rest. No downstream changes.

**Tech Stack:** Rust (quick-xml + serde) parser; TypeScript (Zod domain, pure-TS engine-eval); Cargo test; Vitest.

## Global Constraints

- Per-placement isolation: modifiers are pushed onto the **cloned** `resolved` instance (`target.clone()`), never onto the shared target — a shared entry linked in two places must carry the modifier only on the placement whose link declared it.
- No new semantics: link modifiers go through the SAME strict routing as an entity's/group's own modifiers (`map_entry`: hidden→visibility, cost-type→cost.modifiers, `error`→validation rule, `category`→category modifier, constraint-id→constraint.modifiers, else→`modifier.target_unmapped`; `map_group_constraint`: strict all-or-nothing limit modifier). Do NOT change any downstream router.
- Group-link visibility stays unmodeled: a static `hidden` on a group link OR a `field="hidden"` modifier on a group link still emits `entryLink.group_hidden_unsupported`. Only NON-hidden modifiers are pushed onto the resolved group.
- Golden IR byte-identical (mini fixture has no non-hidden link modifiers).
- Code/identifiers/commit messages in English. Repo stays local (do not push).

---

### Task 1: route entryLink modifiers onto the inlined instance

**Files:**
- Modify: `packages/engine-parser/src/resolve/links.rs` (`apply_link_visibility` → `apply_link_modifiers`, entry branch ~135-165; group branch ~102-125)
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Consumes: `RawEntryLink { target_id, link_type, hidden: bool, modifiers: Vec<RawModifier> }`; `RawEntry.modifiers`, `RawGroup.modifiers` (both preserved by `.clone()` in `resolve_entry`/`resolve_group`); existing `map_entry`/`map_group_constraint` routing.
- Produces: inlined instances whose `modifiers` include the link's modifiers; no `entryLink.modifier_dropped` for representable fields.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine-parser/tests/map.rs` (helpers `parse_raw`, `resolve`, `to_ir` already imported):

```rust
#[test]
fn entrylink_cost_modifier_lands_on_inlined_instance() {
    // A link that discounts the shared entry by 2 pts on this placement.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
    </selectionEntry>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="decrement" value="2" field="pts"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    let cost = inlined.costs.iter().find(|c| c.name == "points").expect("cost present");
    let mods = cost.modifiers.as_ref().expect("cost modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("decrement", 2.0));
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn entrylink_constraint_modifier_lands_on_inlined_instance() {
    // A link that raises the shared entry's own max on this placement.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade">
      <constraints><constraint id="cc" type="max" value="1" field="selections" scope="parent"/></constraints>
    </selectionEntry>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="increment" value="1" field="cc"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let inlined = host.children.iter().find(|e| e.id == "shared").unwrap();
    let c = inlined.constraints.iter().find(|c| c.id == "cc").expect("constraint present");
    let mods = c.modifiers.as_ref().expect("constraint modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn entrylink_unrepresentable_modifier_becomes_target_unmapped() {
    // A `name` modifier is not representable → routed by map_entry to
    // modifier.target_unmapped (recategorized), NOT entryLink.modifier_dropped.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade"/>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lk" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="set" value="Master-crafted" field="name"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (_ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    assert!(diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn entrylink_modifier_isolated_to_its_placement() {
    // The same shared entry is linked into two hosts; only host_a's link carries
    // the cost modifier. host_b's inlined copy must be untouched (clone, no leak).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <sharedSelectionEntries>
    <selectionEntry id="shared" name="Wargear" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
    </selectionEntry>
  </sharedSelectionEntries>
  <selectionEntries>
    <selectionEntry id="host_a" name="A" type="unit">
      <entryLinks>
        <entryLink id="la" name="L" type="selectionEntry" targetId="shared">
          <modifiers><modifier type="decrement" value="2" field="pts"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
    <selectionEntry id="host_b" name="B" type="unit">
      <entryLinks>
        <entryLink id="lb" name="L" type="selectionEntry" targetId="shared"/>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let a = ir.entries.iter().find(|e| e.id == "host_a").unwrap()
        .children.iter().find(|e| e.id == "shared").unwrap();
    let b = ir.entries.iter().find(|e| e.id == "host_b").unwrap()
        .children.iter().find(|e| e.id == "shared").unwrap();
    assert!(a.costs[0].modifiers.is_some(), "host_a placement carries the modifier");
    assert!(b.costs[0].modifiers.is_none(), "host_b placement must be untouched");
}

#[test]
fn grouplink_constraint_modifier_lands_on_inlined_group() {
    // A group link carrying a modifier on the shared group's own limit → attached
    // via the conditional-group-limits machinery (map_group_constraint).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="sg" name="Loadout">
      <constraints><constraint id="gm" type="max" value="1" field="selections" scope="self"/></constraints>
      <selectionEntries><selectionEntry id="w" name="W" type="upgrade"/></selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lg" name="L" type="selectionEntryGroup" targetId="sg">
          <modifiers><modifier type="increment" value="1" field="gm"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let host = ir.entries.iter().find(|e| e.id == "host").unwrap();
    let g = host.groups.iter().find(|g| g.id == "sg").expect("inlined group present");
    let gc = g.constraints.iter().find(|c| c.id == "gm").expect("group constraint present");
    assert!(gc.modifiers.as_ref().map(|m| !m.is_empty()).unwrap_or(false), "group limit modifier attached");
    assert!(!diags.iter().any(|d| d.code == "entryLink.modifier_dropped"), "{:?}", diags);
}

#[test]
fn grouplink_hidden_modifier_still_unsupported() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <sharedSelectionEntryGroups>
    <selectionEntryGroup id="sg" name="Loadout">
      <constraints><constraint id="gm" type="max" value="1" field="selections" scope="self"/></constraints>
      <selectionEntries><selectionEntry id="w" name="W" type="upgrade"/></selectionEntries>
    </selectionEntryGroup>
  </sharedSelectionEntryGroups>
  <selectionEntries>
    <selectionEntry id="host" name="Host" type="unit">
      <entryLinks>
        <entryLink id="lg" name="L" type="selectionEntryGroup" targetId="sg">
          <modifiers><modifier type="set" value="true" field="hidden"/></modifiers>
        </entryLink>
      </entryLinks>
    </selectionEntries>
  </selectionEntries>
</catalogue>"#;
    let (_ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    assert!(diags.iter().any(|d| d.code == "entryLink.group_hidden_unsupported"), "{:?}", diags);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p engine-parser entrylink_cost_modifier entrylink_constraint_modifier entrylink_unrepresentable entrylink_modifier_isolated grouplink_constraint`
Expected: the cost/constraint/isolation/group tests FAIL — the link modifiers are currently dropped (`entryLink.modifier_dropped`), so nothing lands on the inlined instance. (`entrylink_unrepresentable` currently emits `entryLink.modifier_dropped` not `modifier.target_unmapped`, so it fails too. `grouplink_hidden` already passes.)

- [ ] **Step 3: Rewrite the entry branch (`apply_link_visibility` → `apply_link_modifiers`)**

In `packages/engine-parser/src/resolve/links.rs`, replace `apply_link_visibility` (lines ~143-165) with:

```rust
/// Apply an entryLink's own static `hidden` and its `<modifiers>` onto the
/// freshly-cloned inlined instance. `resolved` is unique per placement, so
/// appended modifiers never leak to the shared target. Every modifier is routed
/// downstream by map_entry exactly like one of the target's own modifiers
/// (hidden→visibility, cost-type→cost, error→validation, category→category,
/// constraint-id→constraint, else→modifier.target_unmapped) — no field is
/// special-cased or dropped here.
fn apply_link_modifiers(link: &RawEntryLink, resolved: &mut RawEntry) {
    if link.hidden {
        resolved.hidden = true;
    }
    for m in &link.modifiers {
        resolved.modifiers.push(m.clone());
    }
}
```

Update the call site in the entry branch of `resolve_link` (line ~137):

```rust
        apply_link_modifiers(link, &mut resolved);
```

- [ ] **Step 4: Rewrite the group branch**

In `resolve_link`, replace the group branch's post-resolve handling (lines ~111-125) with (making `resolved` mutable and pushing non-hidden modifiers, keeping the hidden diagnostic):

```rust
        let mut resolved = resolve_group(target, symbols, path, budget, diags, depth + 1)?;
        path.remove(&link.target_id);
        if link.hidden || link.modifiers.iter().any(|m| m.field == "hidden") {
            diags.push(Diagnostic {
                code: "entryLink.group_hidden_unsupported".to_string(),
                message: format!("entryLink to group {} carries hidden visibility; unsupported (dropped)", link.target_id),
            });
        }
        // Non-hidden link modifiers ride onto the cloned group; map_group_constraint
        // attaches any that target one of the group's own limits (per-placement
        // constraint override). Group visibility itself is not modeled, so hidden
        // modifiers are excluded (diagnosed above).
        for m in link.modifiers.iter().filter(|m| m.field != "hidden") {
            resolved.modifiers.push(m.clone());
        }
        groups.push(resolved);
```

(The `let resolved = resolve_group(...)` line becomes `let mut resolved = ...`; remove the old `for m in link.modifiers.iter().filter(...) { diags.push(...modifier_dropped...) }` loop.)

- [ ] **Step 5: Run the parser tests**

Run: `cargo test -p engine-parser`
Expected: all pass, including the six new tests and the existing `entrylink_hidden_modifier_lands_on_inlined_instance` / `entrylink_static_hidden_sets_inlined_instance_hidden` (hidden regression intact).

- [ ] **Step 6: Verify golden byte-identical**

Run: `cargo test -p engine-parser --test golden`
Expected: PASS (mini fixture has no non-hidden link modifiers).

- [ ] **Step 7: Clippy**

Run: `cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: clean (no unused-function warning — `apply_link_visibility` is renamed, not left dangling).

- [ ] **Step 8: Commit**

```bash
git add packages/engine-parser/src/resolve/links.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): route entryLink modifiers onto the inlined instance

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: cross-language contract — per-placement pricing from a link modifier

**Files:**
- Test: `packages/engine-eval/test/parser-contract.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue` (Zod), `evaluate`. A catalogue in the parser's serialized shape where one placement of a shared entry carries a `costs[].modifiers` decrement — validated via `IrCatalogue.parse`, proving the per-placement pricing that Task 1 produces evaluates end-to-end (engine's `applyModifiers` in cost resolution already handles it).
- Produces: none (leaf test).

- [ ] **Step 1: Write the test**

Append a `describe` to `packages/engine-eval/test/parser-contract.test.ts` (it already imports `IrCatalogue`, `evaluate`, `Roster`):

```ts
describe("parser IR contract — per-placement link cost modifier", () => {
  // Mirrors the parser output after routing a link's cost modifier onto the
  // inlined instance: unit A's copy of the shared wargear is discounted by 2,
  // unit B's copy is not. Proves per-placement pricing evaluates end-to-end.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [
      {
        id: "e.a", name: "A", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5, modifiers: [{ id: "m0", type: "decrement", value: 2 }] }],
        }],
      },
      {
        id: "e.b", name: "B", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5 }],
        }],
      },
    ],
  };

  const roster = (host: "e.a" | "e.b"): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: host, count: 1,
      selections: [{ id: "w", entryId: "e.wargear", count: 1, selections: [] }],
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("prices the discounted placement at 3 and the plain placement at 5", () => {
    const cat = IrCatalogue.parse(shaped);
    expect(evaluate(roster("e.a"), cat).totalPoints).toBe(3);
    expect(evaluate(roster("e.b"), cat).totalPoints).toBe(5);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @muster/engine-eval test -- parser-contract.test.ts`
Expected: PASS (the engine already applies `costs[].modifiers` in cost resolution).

- [ ] **Step 3: Run the full suites**

Run: `pnpm --filter @muster/engine-eval test && cargo test -p engine-parser`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/engine-eval/test/parser-contract.test.ts
git commit -m "test(engine-eval): cross-language contract for per-placement link cost modifier

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- entry branch pushes ALL link modifiers → `apply_link_modifiers` (Task 1 Step 3). ✓
- group branch pushes NON-hidden, keeps group-hidden diagnostic → Task 1 Step 4. ✓
- routing unchanged downstream (cost/constraint/hidden/error/category/target_unmapped) → Task 1 tests cover cost, constraint, hidden-regression, name→target_unmapped, group-constraint, group-hidden. ✓
- per-placement isolation → `entrylink_modifier_isolated_to_its_placement`. ✓
- golden byte-identical → Task 1 Step 6. ✓
- cross-language per-placement pricing → Task 2. ✓

**Type consistency:** `apply_link_modifiers(link: &RawEntryLink, resolved: &mut RawEntry)` — the entry call site passes `&mut resolved`. The group branch makes `resolved` mutable and pushes to `resolved.modifiers` (`RawGroup.modifiers` exists). Test literals use IR field names (`costs[].modifiers`, `constraints[].modifiers`, `groups[].constraints[].modifiers`) matching the domain/serde shapes.

**Placeholder scan:** none — every code step is complete.
