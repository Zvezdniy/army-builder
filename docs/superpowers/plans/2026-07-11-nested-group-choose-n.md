# Nested Group Choose-N Emission — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The parser emits an `IrGroup` for every nested `<selectionEntryGroup>` that carries a mappable choose-N limit (not just top-level groups), so nested wargear "choose N" limits enforce in the builder instead of being silently dropped.

**Architecture:** One src change in `packages/engine-parser/src/ir/map.rs`: replace the "map top-level group, drop nested" logic with a recursive `collect_groups` that emits an `IrGroup` for each group in the tree (each with its DIRECT entry members as `memberEntryIds`). Members of all levels are already flattened into the owning entry's `children`, and engine-eval enforces `entry.groups` as a flat per-owner count — so nested groups need no engine-eval or domain-schema change.

**Tech Stack:** Rust (serde), `#![forbid(unsafe_code)]`; Cargo tests + golden fixture; pnpm turbo for the cross-package green check. engine-eval is TypeScript (Vitest, 100% coverage) — only a behavior-lock test is added there, no source change.

## Global Constraints

- Source change ONLY in `packages/engine-parser/src/ir/map.rs`. Test changes in `packages/engine-parser/tests/map.rs` and `packages/engine-eval/test/groups.test.ts`. Do NOT change `@muster/domain`, `packages/engine-eval/src/**`, `apps/web`, or the `.cat`/`.catz`/`.gst` fixtures.
- Preserve never-miscompile: a group constraint is emitted only through the existing `map_group_constraint`, which already loudly drops non-`selections` field, non-group-local scope, and modifier-on-limit. A parent group still counts only its DIRECT entry members (documented limitation, unchanged from today) — do NOT attempt to count nested selections into a parent's limit.
- Additive to top-level behavior: mini40k golden MUST stay byte-identical (the fixture has no nested groups). Verify.
- Keep `#![forbid(unsafe_code)]`; no new dependencies. English identifiers/comments; commit message in English with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: Recursively emit nested group choose-N constraints

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs` (add `collect_groups`, drop `drop_group_constraints`, adjust `map_entry` loop and `map_group`)
- Test: `packages/engine-parser/tests/map.rs` (rewrite one existing test, add two)
- Test: `packages/engine-eval/test/groups.test.ts` (add one behavior-lock test)

**Interfaces:**
- Produces: `IrEntry.groups` now contains an `IrGroup` for each nested `<selectionEntryGroup>` with a mappable limit (in addition to top-level groups). `IrGroup` shape is unchanged.

- [ ] **Step 1: Update the existing test that asserts nested constraints are dropped**

In `packages/engine-parser/tests/map.rs`, the test `drops_group_points_and_modifier_and_nested_constraints` (around line 171) currently asserts nested constraints are dropped and `u.groups.is_empty()`. Under the new behavior the nested `g.inner` (a `selections` max, group-local scope) IS emitted, while `g.pts` (points field) and `g.mod` (modifier-on-limit) still drop. Replace that whole test function with:

```rust
#[test]
fn emits_nested_group_but_drops_points_field_and_modifier_limit() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.pts" name="Pts">
          <constraints><constraint id="g.pts.max" type="max" value="30" field="pts" scope="parent"/></constraints>
          <selectionEntries><selectionEntry id="e.a" name="A" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
        <selectionEntryGroup id="g.mod" name="Mod">
          <constraints><constraint id="g.mod.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers><modifier type="increment" field="g.mod.max" value="1"/></modifiers>
          <selectionEntries><selectionEntry id="e.b" name="B" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
        <selectionEntryGroup id="g.outer" name="Outer">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.inner" name="Inner">
              <constraints><constraint id="g.inner.max" type="max" value="1" field="selections" scope="parent"/></constraints>
              <selectionEntries><selectionEntry id="e.c" name="C" type="upgrade"/></selectionEntries>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let raw = resolve(parse_raw(xml).unwrap()).unwrap();
    let (ir, diags) = to_ir(&raw);
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // The nested group's selections limit is now emitted (no longer dropped).
    let inner = u.groups.iter().find(|g| g.id == "g.inner").expect("nested group must be emitted");
    assert_eq!(inner.member_entry_ids, vec!["e.c"]);
    assert_eq!(inner.constraints.len(), 1);
    assert_eq!((inner.constraints[0].type_.as_str(), inner.constraints[0].value), ("max", 1.0));
    // g.pts (points field) and g.mod (modifier-on-limit) still produce no IrGroup.
    assert!(u.groups.iter().all(|g| g.id != "g.pts" && g.id != "g.mod"));
    assert!(u.groups.iter().all(|g| g.id != "g.outer"), "constraint-less outer group is not emitted");
    // members still flattened
    for id in ["e.a", "e.b", "e.c"] {
        assert!(u.children.iter().any(|c| c.id == id), "member {} lost", id);
    }
    // exactly two loud drops remain: points-field and modifier-on-limit
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 2, "{:?}", diags);
}
```

- [ ] **Step 2: Add tests for deeper nesting and roster-scope drop**

Append to `packages/engine-parser/tests/map.rs`:

```rust
#[test]
fn emits_group_constraint_two_levels_deep() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.l1" name="L1">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.l2" name="L2">
              <selectionEntryGroups>
                <selectionEntryGroup id="g.l3" name="L3">
                  <constraints><constraint id="g.l3.max" type="max" value="2" field="selections" scope="parent"/></constraints>
                  <selectionEntries><selectionEntry id="e.deep" name="Deep" type="upgrade"/></selectionEntries>
                </selectionEntryGroup>
              </selectionEntryGroups>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = u.groups.iter().find(|g| g.id == "g.l3").expect("deeply nested group emitted");
    assert_eq!(g.member_entry_ids, vec!["e.deep"]);
    assert_eq!((g.constraints[0].type_.as_str(), g.constraints[0].value), ("max", 2.0));
    assert!(u.children.iter().any(|c| c.id == "e.deep"), "deep member flattened");
}

#[test]
fn nested_group_roster_scope_still_drops() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.outer" name="Outer">
          <selectionEntryGroups>
            <selectionEntryGroup id="g.inner" name="Inner">
              <constraints><constraint id="g.inner.max" type="max" value="1" field="selections" scope="roster"/></constraints>
              <selectionEntries><selectionEntry id="e.x" name="X" type="upgrade"/></selectionEntries>
            </selectionEntryGroup>
          </selectionEntryGroups>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.is_empty(), "roster-scope nested limit must not map: {:?}", u.groups);
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1);
}
```

- [ ] **Step 3: Run the map tests to verify they fail**

Run: `cargo test -p engine-parser --test map emits_nested_group emits_group_constraint_two_levels_deep nested_group_roster_scope_still_drops`
Expected: FAIL (nested groups are currently dropped, so `g.inner`/`g.l3` are not found; the rewritten drop-test's `expect("nested group must be emitted")` panics).

- [ ] **Step 4: Implement recursive group emission in `map.rs`**

In `packages/engine-parser/src/ir/map.rs`:

(a) In `map_entry`, replace the group loop:

```rust
    for g in &e.groups {
        flatten_group_members(g, cat, diags, &mut children);
        if let Some(ir_group) = map_group(g, diags) {
            groups.push(ir_group);
        }
    }
```

with:

```rust
    for g in &e.groups {
        flatten_group_members(g, cat, diags, &mut children);
        collect_groups(g, diags, &mut groups);
    }
```

(b) Remove the nested-drop loop at the TOP of `map_group`. Change its opening from:

```rust
fn map_group(g: &RawGroup, diags: &mut Vec<Diagnostic>) -> Option<IrGroup> {
    for sub in &g.groups {
        drop_group_constraints(sub, diags);
    }
    let member_entry_ids: Vec<String> = g.entries.iter().map(|e| e.id.clone()).collect();
```

to:

```rust
fn map_group(g: &RawGroup, diags: &mut Vec<Diagnostic>) -> Option<IrGroup> {
    let member_entry_ids: Vec<String> = g.entries.iter().map(|e| e.id.clone()).collect();
```

Also update `map_group`'s doc comment: its members are the group's DIRECT entries; nested sub-groups are emitted separately by `collect_groups`, not dropped.

(c) Add `collect_groups` (place it right after `map_group`):

```rust
/// Emit an IrGroup for `g` and every nested sub-group that carries a mappable
/// choose-N limit. Members of all levels are flattened into the owning entry's
/// children (see flatten_group_members), and each group's memberEntryIds are its
/// DIRECT entry members, so engine-eval's flat per-owner count enforces each
/// group's local choose-N independently. Nested sub-group limits used to be
/// dropped wholesale (`drop_group_constraints`); they are now mapped like any
/// other group. A parent group still counts only its direct entry members, not
/// selections made inside its sub-groups — an intentional, pre-existing modeling
/// limitation, never a miscompile (the parent's own limit is still enforced over
/// its direct members).
fn collect_groups(g: &RawGroup, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrGroup>) {
    if let Some(ir_group) = map_group(g, diags) {
        out.push(ir_group);
    }
    for sub in &g.groups {
        collect_groups(sub, diags, out);
    }
}
```

(d) Delete the now-unused `drop_group_constraints` function entirely.

- [ ] **Step 5: Run the map tests to verify they pass**

Run: `cargo test -p engine-parser --test map`
Expected: ALL map tests PASS, including the rewritten `emits_nested_group_but_drops_points_field_and_modifier_limit`, the two new tests, and the unchanged `maps_group_choose_n_and_flattens_members` / `min_and_max_group_constraints_both_map` / `drops_group_constraint_with_non_group_local_scope`.

- [ ] **Step 6: Confirm the golden fixture is unchanged**

Run: `cargo test -p engine-parser --test golden`
Expected: PASS with no fixture change (mini40k has no nested groups). If it fails on drift, run `git diff` on nothing should be needed — the source change is additive and mini40k's only group is top-level, so a golden failure means a real regression; STOP and investigate rather than regenerating.

- [ ] **Step 7: Run the full crate test suite**

Run: `cargo test -p engine-parser`
Expected: ALL pass (map, golden, multi_file, proptest, raw_parse, smoke, resolve, etc.).

- [ ] **Step 8: Add an engine-eval behavior-lock test (no src change)**

engine-eval enforces `entry.groups` flatly, so a nested group emitted as a flat IrGroup already enforces. Lock this with a test. Append to `packages/engine-eval/test/groups.test.ts`:

```typescript
describe("nested group emitted as a flat IrGroup enforces independently", () => {
  // Simulates the parser output for a unit with an outer group (choose ≤2 of its
  // direct members) plus a nested inner group (choose ≤1 of its own members) —
  // both flat in entry.groups, members all flattened into the entry's children.
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.u", name: "Unit", costs: [{ name: "points", value: 10 }],
        categories: [], constraints: [], children: [
          { id: "e.a", name: "A", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.b", name: "B", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.i1", name: "I1", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.i2", name: "I2", costs: [], categories: [], constraints: [], children: [], groups: [] },
        ],
        groups: [
          { id: "g.outer", name: "Outer", memberEntryIds: ["e.a", "e.b"], constraints: [{ id: "g.outer.max", type: "max", value: 2 }] },
          { id: "g.inner", name: "Inner", memberEntryIds: ["e.i1", "e.i2"], constraints: [{ id: "g.inner.max", type: "max", value: 1 }] },
        ],
      },
    ],
  };
  const roster = (members: string[]): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{ id: "u", entryId: "e.u", count: 1, selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })) }],
  });

  it("flags the nested group's max independently of the outer group", () => {
    const r = evaluate(roster(["e.i1", "e.i2"]), cat); // 2 in inner, max 1
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.constraintId === "g.inner.max")).toBe(true);
  });

  it("passes when each group is within its own limit", () => {
    const r = evaluate(roster(["e.a", "e.b", "e.i1"]), cat); // outer 2/2, inner 1/1
    expect(r.valid).toBe(true);
  });
});
```

(`IrCatalogue`, `Roster`, and `evaluate` are already imported at the top of the file.)

- [ ] **Step 9: Run the full monorepo test suite**

Run: `pnpm -w turbo run test`
Expected: 4/4 packages green (engine-parser, engine-eval, domain, roster, web as applicable), engine-eval still at 100% coverage.

- [ ] **Step 10: Commit**

```bash
git add packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs packages/engine-eval/test/groups.test.ts
git commit -m "feat(parser): emit nested selectionEntryGroup choose-N limits

Recursively map every group in the tree (not just top-level) to a flat
IrGroup with its direct members; nested wargear choose-N limits now
enforce. engine-eval/domain unchanged (flat per-owner enforcement).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Recursive emission of nested groups — Task 1 Step 4 (`collect_groups`), tested Steps 1–2.
- Per-constraint drops preserved (points-field, modifier-on-limit, roster-scope) — retained `map_group_constraint`; tested by rewritten drop-test (Step 1) and `nested_group_roster_scope_still_drops` (Step 2).
- Deep nesting — `emits_group_constraint_two_levels_deep` (Step 2).
- No engine-eval/domain change; flat enforcement — behavior-lock test Step 8.
- Golden unchanged — Step 6.
- Real-data diagnostic drop (4850→~279) and builder enforcement — controller's manual tangible check post-merge (real GW-IP IR stays out of git).

**Placeholder scan:** none — all code blocks and commands are concrete.

**Type consistency:** `collect_groups(g: &RawGroup, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrGroup>)` matches `map_group(g, diags) -> Option<IrGroup>` and the `groups: Vec<IrGroup>` accumulator in `map_entry`. `IrGroup` shape unchanged, so the engine-eval test literals match the domain schema. `drop_group_constraints` is removed and has no remaining callers after Step 4(a)/(b).
