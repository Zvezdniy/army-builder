# Conditional Group Limits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `selectionEntryGroup` choose-N limits that carry a modifier on the limit itself (`set`/`increment`/`decrement`, gated by conditions), mirroring the already-working entry-constraint path.

**Architecture:** `IrGroupConstraint` gains an optional `modifiers` array (mirror of `IrConstraint.modifiers`). The parser maps a group's limit-modifiers **strictly** (all-or-nothing on conditions) and attaches them instead of dropping the whole constraint; if any modifier/condition is unmappable the whole constraint is dropped as today (status-quo, never partial). engine-eval's `checkGroupConstraint` applies the modifiers via the existing generic `applyModifiers` to get the effective limit before comparing. Roster-scope + modifier stays a loud drop (owner-relative gate cannot anchor an army-wide limit).

**Tech Stack:** Rust (quick-xml + serde) parser; TypeScript (Zod domain, pure-TS engine-eval); Vitest; Cargo test.

## Global Constraints

- Never miscompile / never over-enforce: a conditional group limit is enforced ONLY when its base value AND every limit-modifier AND every one of their conditions map faithfully; otherwise the whole group constraint is dropped loudly (`group.constraint_dropped`), exactly as today. No partial mapping.
- `modifiers` field is serialized only when present (`skip_serializing_if = "Option::is_none"` in Rust, `.optional()` in Zod) → the mini40k golden IR stays byte-identical (its fixture has no group limit-modifiers).
- Modifier gate is anchored on the real owner node passed to `checkGroupConstraint`.
- roster-scope group constraint carrying a limit-modifier → loud drop (documented limitation).
- Code, identifiers, commit messages in English. Repo stays local (do not push).
- Reuse existing machinery: `applyModifiers` (engine-eval/src/modifiers.ts), `map_condition` / `map_condition_group_strict` (engine-parser/src/ir/map.rs). Do not duplicate condition logic.

---

### Task 1: domain — `IrGroupConstraint.modifiers`

**Files:**
- Modify: `packages/domain/src/ir.ts:25-30`
- Test: `packages/domain/test/ir.test.ts`

**Interfaces:**
- Consumes: `IrModifier` (already imported at `packages/domain/src/ir.ts:2`).
- Produces: `IrGroupConstraint` now has optional `modifiers?: IrModifier[]`. Rust must serialize a matching `modifiers` array (Task 2); engine-eval reads `gc.modifiers` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `packages/domain/test/ir.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IrGroupConstraint } from "@muster/domain";

describe("IrGroupConstraint.modifiers", () => {
  it("parses a group constraint carrying a conditional limit modifier", () => {
    const parsed = IrGroupConstraint.parse({
      id: "g.max", type: "max", value: 1, scope: "self",
      modifiers: [{
        id: "mod.g.0", type: "increment", value: 1,
        conditions: [{
          id: "cond.atLeast.e.sgt", comparator: "atLeast", value: 1,
          field: "selections", scope: "model-or-unit", targetType: "entry",
          targetId: "e.sgt", includeChildSelections: true,
        }],
      }],
    });
    expect(parsed.modifiers?.[0]?.type).toBe("increment");
    expect(parsed.modifiers?.[0]?.value).toBe(1);
  });

  it("defaults modifiers to undefined when absent", () => {
    const parsed = IrGroupConstraint.parse({ id: "g.max", type: "max", value: 2 });
    expect(parsed.modifiers).toBeUndefined();
    expect(parsed.scope).toBe("self");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test -- ir.test.ts`
Expected: FAIL — the first case's `modifiers` is stripped/unknown (schema has no `modifiers` key yet), `parsed.modifiers?.[0]?.type` is `undefined`, assertion fails.

- [ ] **Step 3: Add the field**

In `packages/domain/src/ir.ts`, extend the `IrGroupConstraint` object (currently lines 25-30):

```ts
export const IrGroupConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number().finite(),
  scope: z.enum(["self", "roster"]).default("self"),
  modifiers: z.array(IrModifier).optional(),
});
export type IrGroupConstraint = z.infer<typeof IrGroupConstraint>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test -- ir.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the domain suite + typecheck**

Run: `pnpm --filter @muster/domain test && pnpm --filter @muster/domain exec tsc --noEmit`
Expected: all green (this package was green before; the new optional field adds no errors).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): IrGroupConstraint.modifiers (optional, mirrors IrConstraint)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: parser — strict limit-modifier mapping + attach to group constraint

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs:66-74` (add `modifiers` to `IrGroupConstraint`)
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_entry` call site ~line 118-121; `collect_groups` ~199-206; `map_group` ~167-187; `map_group_constraint` ~211-243; new `map_modifier_strict`)
- Test: `packages/engine-parser/tests/map.rs` (new tests + update `emits_nested_group_but_drops_points_field_and_modifier_limit`)

**Interfaces:**
- Consumes: `RawGroup.modifiers: Vec<RawModifier>` (raw/model.rs:42), `RawModifier { kind, field, value, conditions, condition_groups, has_repeats }` (raw/model.rs:59-65), existing `map_condition(c, cat, diags) -> Option<IrCondition>` (map.rs:371), `map_condition_group_strict(g, cat) -> Option<IrConditionGroup>` (map.rs:439). `IrModifier` struct (ir/model.rs:102).
- Produces: `IrGroupConstraint` serialized with a camelCase `modifiers` array whose elements match the domain `IrModifier` shape from Task 1. Consumed by engine-eval in Task 3.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine-parser/tests/map.rs` (helpers `parse_raw`, `resolve`, `to_ir` are already imported at the top of the file — reuse them):

```rust
#[test]
fn maps_group_limit_modifier_with_mappable_condition() {
    // A group max=1 with an increment-by-1 modifier gated by "have >=1 of e.sgt".
    // The condition (atLeast/selections/self) maps, so the whole rule is emitted.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Wargear">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="atLeast" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries>
            <selectionEntry id="e.w" name="W" type="upgrade"/>
            <selectionEntry id="e.sgt" name="Sgt" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = u.groups.iter().find(|g| g.id == "g").expect("group with limit modifier now emitted");
    let c = &g.constraints[0];
    assert_eq!((c.type_.as_str(), c.value), ("max", 1.0));
    let mods = c.modifiers.as_ref().expect("limit modifier attached");
    assert_eq!(mods.len(), 1);
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    assert_eq!(mods[0].conditions.as_ref().unwrap().len(), 1);
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"), "unexpected drop: {:?}", diags);
}

#[test]
fn drops_group_limit_modifier_with_unmappable_condition() {
    // The modifier's condition uses an unmappable comparator ("childOf"), so the
    // whole group constraint is dropped rather than enforced with a partial gate.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Wargear">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="parent"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="childOf" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.iter().all(|g| g.id != "g"), "constraint with unmappable modifier must be dropped");
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
}

#[test]
fn drops_roster_scope_group_constraint_with_limit_modifier() {
    // A roster-scope limit with an owner-relative gate cannot be anchored → drop.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g" name="Relics">
          <constraints><constraint id="g.max" type="max" value="1" field="selections" scope="roster"/></constraints>
          <modifiers>
            <modifier type="increment" field="g.max" value="1">
              <conditions>
                <condition type="atLeast" value="1" field="selections" scope="self" childId="e.sgt"/>
              </conditions>
            </modifier>
          </modifiers>
          <selectionEntries><selectionEntry id="e.w" name="W" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.groups.iter().all(|g| g.id != "g"), "roster-scope + modifier must be dropped");
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p engine-parser maps_group_limit_modifier_with_mappable_condition drops_group_limit_modifier_with_unmappable_condition drops_roster_scope_group_constraint_with_limit_modifier`
Expected: `maps_group_limit_modifier_with_mappable_condition` FAILS at compile (`c.modifiers` field does not exist on `IrGroupConstraint`) — the whole test binary won't compile yet. That compile failure is the expected "red".

- [ ] **Step 3: Add the `modifiers` field to the Rust struct**

In `packages/engine-parser/src/ir/model.rs`, extend `IrGroupConstraint` (lines 66-74) to mirror `IrConstraint.modifiers` (lines 96-97). `IrModifier` is defined later in the same file — no import needed:

```rust
#[derive(Debug, Serialize)]
pub struct IrGroupConstraint {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
    #[serde(skip_serializing_if = "is_self")]
    pub scope: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modifiers: Option<Vec<IrModifier>>,
}
```

- [ ] **Step 4: Add `map_modifier_strict` and rewire `map_group_constraint`**

In `packages/engine-parser/src/ir/map.rs`, add this helper next to `map_modifier` (after the `map_modifier` fn, ~line 363):

```rust
/// Strict all-or-nothing modifier mapping for constraint LIMIT modifiers.
/// Returns None (so the caller drops the whole constraint) if the modifier has
/// repeats, or if any of its conditions/condition-groups is unmappable — a
/// conditional limit whose gate is only partially represented could over- or
/// under-enforce, so we enforce it fully or not at all. Mirrors
/// `map_condition_group_strict` for visibility. Inner diagnostics are discarded;
/// the caller emits a single drop diagnostic.
fn map_modifier_strict(m: &RawModifier, owner_id: &str, index: usize, cat: &RawCatalogue) -> Option<IrModifier> {
    if m.has_repeats {
        return None;
    }
    let mut sink: Vec<Diagnostic> = Vec::new();
    let conditions: Vec<IrCondition> = m.conditions.iter()
        .filter_map(|c| map_condition(c, cat, &mut sink))
        .collect();
    if conditions.len() != m.conditions.len() {
        return None; // at least one condition was unmappable
    }
    let mut condition_groups: Vec<IrConditionGroup> = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrModifier {
        id: format!("mod.{}.{}", owner_id, index),
        type_: m.kind.clone(),
        value: m.value,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}
```

Then replace the modifier-drop block in `map_group_constraint` (currently lines 239-243):

```rust
    let has_limit_mod = g.modifiers.iter().any(|m| m.field == c.id);
    let modifiers = if has_limit_mod {
        if scope == "roster" {
            diags.push(drop("roster-scope limit carries a modifier (unsupported)".to_string()));
            return None;
        }
        let mut mapped: Vec<IrModifier> = Vec::new();
        for (index, m) in g.modifiers.iter().enumerate() {
            if m.field != c.id {
                continue;
            }
            match map_modifier_strict(m, &g.id, index, cat) {
                Some(im) => mapped.push(im),
                None => {
                    diags.push(drop("has an unmappable modifier on its limit".to_string()));
                    return None;
                }
            }
        }
        Some(mapped)
    } else {
        None
    };
    Some(IrGroupConstraint { id: c.id.clone(), type_: c.kind.clone(), value: c.value, scope, modifiers })
```

Update `map_group_constraint`'s signature to take `cat`:

```rust
fn map_group_constraint(c: &RawConstraint, g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrGroupConstraint> {
```

- [ ] **Step 5: Thread `cat` through `map_group` and `collect_groups`**

In `packages/engine-parser/src/ir/map.rs`:

`map_group` (line 167) — add `cat` and pass it down:

```rust
fn map_group(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>) -> Option<IrGroup> {
    let member_entry_ids: Vec<String> = g.entries.iter().map(|e| e.id.clone()).collect();
    let mut constraints: Vec<IrGroupConstraint> = Vec::new();
    for c in &g.constraints {
        if let Some(gc) = map_group_constraint(c, g, cat, diags) {
            constraints.push(gc);
        }
    }
    // ... rest unchanged
```

`collect_groups` (line 199) — add `cat` and pass it down (both the `map_group` call and the recursion):

```rust
fn collect_groups(g: &RawGroup, cat: &RawCatalogue, diags: &mut Vec<Diagnostic>, out: &mut Vec<IrGroup>) {
    if let Some(ir_group) = map_group(g, cat, diags) {
        out.push(ir_group);
    }
    for sub in &g.groups {
        collect_groups(sub, cat, diags, out);
    }
}
```

`map_entry` call site (line 120) — pass `cat`:

```rust
    for g in &e.groups {
        flatten_group_members(g, cat, diags, &mut children);
        collect_groups(g, cat, diags, &mut groups);
    }
```

- [ ] **Step 6: Update the pre-existing test that assumed modifier-on-limit is always dropped**

`emits_nested_group_but_drops_points_field_and_modifier_limit` (map.rs:171) has a `g.mod` group whose modifier (`<modifier type="increment" field="g.mod.max" value="1"/>`, no conditions) is now mappable → `g.mod` is emitted with modifiers, and only `g.pts` (points field) is dropped. Rename and update it:

```rust
#[test]
fn emits_group_with_unconditional_limit_modifier_drops_only_points_field() {
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
    // nested inner group still emitted
    let inner = u.groups.iter().find(|g| g.id == "g.inner").expect("nested group must be emitted");
    assert_eq!(inner.member_entry_ids, vec!["e.c"]);
    // g.mod now emits WITH its unconditional increment modifier attached
    let gmod = u.groups.iter().find(|g| g.id == "g.mod").expect("modifier-on-limit group now emitted");
    let mods = gmod.constraints[0].modifiers.as_ref().expect("modifier attached");
    assert_eq!((mods[0].type_.as_str(), mods[0].value), ("increment", 1.0));
    // g.pts (points field) still dropped; g.outer (constraint-less) not emitted
    assert!(u.groups.iter().all(|g| g.id != "g.pts"));
    assert!(u.groups.iter().all(|g| g.id != "g.outer"), "constraint-less outer group is not emitted");
    for id in ["e.a", "e.b", "e.c"] {
        assert!(u.children.iter().any(|c| c.id == id), "member {} lost", id);
    }
    // exactly one loud drop remains: the points-field group
    assert_eq!(diags.iter().filter(|d| d.code == "group.constraint_dropped").count(), 1, "{:?}", diags);
}
```

- [ ] **Step 7: Run the parser tests**

Run: `cargo test -p engine-parser`
Expected: all pass, including the three new tests and the updated `emits_group_with_unconditional_limit_modifier_drops_only_points_field`.

- [ ] **Step 8: Verify the golden IR is byte-identical**

Run: `cargo test -p engine-parser --test golden`
Expected: PASS (mini40k fixture has no group limit-modifiers, so `modifiers` is `None` and skip-serialized).

- [ ] **Step 9: Clippy**

Run: `cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: no warnings.

- [ ] **Step 10: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): attach strict-mapped modifiers to group limits (was dropped)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: engine-eval — apply modifiers to the group limit

**Files:**
- Modify: `packages/engine-eval/src/groups.ts`
- Test: `packages/engine-eval/test/groups.test.ts`

**Interfaces:**
- Consumes: `applyModifiers(base: number, modifiers: IrModifier[] | undefined, node: EvalNode | null, state: EvalState, costOf?) => number` (engine-eval/src/modifiers.ts:6); `IrGroupConstraint.modifiers` (Task 1).
- Produces: `checkGroupConstraint` now compares `actual` against the modifier-adjusted `limit`. Same signature as today: `checkGroupConstraint(gc, node, group, state)`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `packages/engine-eval/test/groups.test.ts` (the file already imports `evaluate` and the domain types). This builds a captain whose Wargear group has `max 1`, incremented by 1 when the captain also carries `e.sgt` (a member of the same group), gated by an `atLeast 1 e.sgt` condition in `self` scope with `includeChildSelections`:

```ts
function modCat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
        categories: ["cat.hq"], constraints: [], children: [
          { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.sgt", name: "Sergeant", costs: [], categories: [], constraints: [], children: [], groups: [] },
        ],
        groups: [{
          id: "g.wargear", name: "Wargear",
          memberEntryIds: ["e.sword", "e.axe"],
          constraints: [{
            id: "g.wargear.max", type: "max", value: 1, scope: "self",
            modifiers: [{
              id: "mod.g.0", type: "increment", value: 1,
              conditions: [{
                id: "cond.atLeast.e.sgt", comparator: "atLeast", value: 1,
                field: "selections", scope: "self", targetType: "entry",
                targetId: "e.sgt", includeChildSelections: true,
              }],
            }],
          }],
        }],
      },
    ],
  } as unknown as IrCatalogue;
}

function capWith(members: string[]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "cap", entryId: "e.captain", count: 1,
      selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })),
    }],
  } as unknown as Roster;
}

describe("conditional group limits (modifier on the limit)", () => {
  it("gate fails: base max=1 enforced (2 wargear → group.max exceeds max 1)", () => {
    const r = evaluate(capWith(["e.sword", "e.axe"]), modCat());
    const issue = r.issues.find((i) => i.constraintId === "g.wargear.max");
    expect(issue?.code).toBe("group.max");
    expect(issue?.message).toContain("exceeds max 1");
    expect(r.valid).toBe(false);
  });

  it("gate passes: sergeant raises max to 2, so 2 wargear is legal", () => {
    const r = evaluate(capWith(["e.sword", "e.axe", "e.sgt"]), modCat());
    expect(r.issues.some((i) => i.constraintId === "g.wargear.max")).toBe(false);
    expect(r.valid).toBe(true);
  });

  it("gate passes but limit still binds: 3 wargear exceeds the raised max 2", () => {
    const r = evaluate(capWith(["e.sword", "e.axe", "e.axe", "e.sgt"]), modCat());
    const issue = r.issues.find((i) => i.constraintId === "g.wargear.max");
    expect(issue?.code).toBe("group.max");
    expect(issue?.message).toContain("exceeds max 2");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/engine-eval test -- groups.test.ts`
Expected: FAIL — the "gate passes" test fails because `checkGroupConstraint` compares against the raw `gc.value` (1), so 2 wargear is wrongly flagged; the "exceeds max 2" test also fails (message says `max 1`).

- [ ] **Step 3: Apply modifiers to the limit**

Rewrite `packages/engine-eval/src/groups.ts` to compute the effective limit via `applyModifiers`:

```ts
import type { IrGroup, IrGroupConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { applyModifiers } from "./modifiers";

// A group choose-N aggregates the owner's direct member children (self scope) or,
// for a roster-scope limit, every selected member across the whole roster. The
// limit itself may carry modifiers (set/increment/decrement) gated by conditions
// evaluated against the owner node.
export function checkGroupConstraint(
  gc: IrGroupConstraint,
  node: EvalNode,
  group: IrGroup,
  state: EvalState,
): Issue | null {
  const isRoster = gc.scope === "roster";
  const actual = isRoster
    ? state.all.reduce(
        (sum, n) => (group.memberEntryIds.includes(n.entry.id) ? sum + n.effectiveCount : sum),
        0,
      )
    : node.children.reduce(
        (sum, c) => (group.memberEntryIds.includes(c.entry.id) ? sum + c.effectiveCount : sum),
        0,
      );
  const limit = applyModifiers(gc.value, gc.modifiers, node, state);
  const violated = gc.type === "max" ? actual > limit : actual < limit;
  if (!violated) return null;

  const message =
    gc.type === "max"
      ? `Too many in "${group.name}": ${actual} exceeds max ${limit}`
      : `Not enough in "${group.name}": ${actual} below min ${limit}`;

  return {
    severity: "error",
    code: gc.type === "max" ? "group.max" : "group.min",
    message,
    selectionId: isRoster ? undefined : node.selectionId,
    entryId: isRoster ? undefined : node.entry.id,
    constraintId: gc.id,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/engine-eval test -- groups.test.ts`
Expected: PASS — all conditional-limit tests plus the existing group tests.

- [ ] **Step 5: Run the full engine-eval suite**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all green (existing group/roster/evaluate tests unaffected — non-modifier constraints have `gc.modifiers === undefined`, so `applyModifiers` returns the base value unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/groups.ts packages/engine-eval/test/groups.test.ts
git commit -m "feat(engine-eval): apply modifiers to group limits (conditional choose-N)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: cross-language contract — parser-shaped IR enforces a conditional group limit

**Files:**
- Test: `packages/engine-eval/test/parser-contract.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue` (Zod, `@muster/domain`), `evaluate` (`@muster/engine-eval`). The catalogue object is written in the parser's EXACT emitted JSON shape (camelCase, `modifiers` array elements = `{id,type,value,conditions:[{...}]}`), validated by `IrCatalogue.parse` — proving the domain accepts what the parser (Task 2) serializes and the engine (Task 3) enforces it.
- Produces: none (leaf test).

- [ ] **Step 1: Write the failing test**

Append to `packages/engine-eval/test/parser-contract.test.ts` a new `describe` using a hand-authored catalogue in the parser's serialized shape (it does NOT touch the golden fixture, which stays byte-identical):

```ts
describe("parser IR contract — conditional group limit", () => {
  // Mirrors the parser's serialized shape for a group max=1 whose limit carries
  // an increment-by-1 modifier gated by "unit has >=1 e.sgt". Validated by Zod,
  // then evaluated — proving parser output → domain → engine enforcement.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [{
      id: "e.captain", name: "Captain", type: "unit",
      costs: [{ name: "points", value: 90 }], categories: [], constraints: [],
      children: [
        { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
        { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
        { id: "e.sgt", name: "Sergeant", costs: [], categories: [], constraints: [], children: [], groups: [] },
      ],
      groups: [{
        id: "g.wargear", name: "Wargear", memberEntryIds: ["e.sword", "e.axe"],
        constraints: [{
          id: "g.wargear.max", type: "max", value: 1, scope: "self",
          modifiers: [{
            id: "mod.g.wargear.0", type: "increment", value: 1,
            conditions: [{
              comparator: "atLeast", value: 1, field: "selections", scope: "self",
              targetType: "entry", targetId: "e.sgt", includeChildSelections: true,
              id: "cond.atLeast.e.sgt",
            }],
          }],
        }],
      }],
    }],
  };

  const roster = (members: string[]): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "cap", entryId: "e.captain", count: 1,
      selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })),
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("enforces base max when the gate is absent, relaxes it when present", () => {
    const cat = IrCatalogue.parse(shaped);
    const withoutSgt = evaluate(roster(["e.sword", "e.axe"]), cat);
    expect(withoutSgt.issues.some((i) => i.constraintId === "g.wargear.max")).toBe(true);

    const withSgt = evaluate(roster(["e.sword", "e.axe", "e.sgt"]), cat);
    expect(withSgt.issues.some((i) => i.constraintId === "g.wargear.max")).toBe(false);
    expect(withSgt.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails (before Tasks 1-3 land) / passes (after)**

Run: `pnpm --filter @muster/engine-eval test -- parser-contract.test.ts`
Expected after Tasks 1-3: PASS. (If run in isolation before Task 1, Zod strips `modifiers` and the "relaxes" case fails — confirming the assertion is meaningful.)

- [ ] **Step 3: Run the full engine-eval + domain + parser suites**

Run: `pnpm --filter @muster/engine-eval test && pnpm --filter @muster/domain test && cargo test -p engine-parser`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/engine-eval/test/parser-contract.test.ts
git commit -m "test(engine-eval): cross-language contract for conditional group limits

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- domain `IrGroupConstraint.modifiers` → Task 1. ✓
- parser `model.rs` field + `map_modifier_strict` + `map_group_constraint` attach + roster-drop + `cat` threading → Task 2. ✓
- strict all-or-nothing (repeats/unmappable condition → drop whole constraint) → Task 2 Step 4 (`map_modifier_strict`) + `drops_group_limit_modifier_with_unmappable_condition` test. ✓
- engine-eval `checkGroupConstraint` applies `applyModifiers` → Task 3. ✓
- roster-scope + modifier → drop → Task 2 (`drops_roster_scope_group_constraint_with_limit_modifier`). ✓
- golden byte-identical → Task 2 Step 8. ✓
- cross-language contract → Task 4. ✓

**Type consistency:** `map_group_constraint(c, g, cat, diags)` new signature is updated at its only caller `map_group` (Task 2 Step 5), which itself gains `cat` and is updated at its caller `collect_groups`, updated at its caller `map_entry`. `checkGroupConstraint` signature is unchanged (already takes `state`). `applyModifiers(base, modifiers, node, state)` matches its definition. `IrModifier` field names (`id`/`type`/`value`/`conditions`/`conditionGroups`) consistent across domain literal (Task 1), Rust struct (existing), and test literals (Tasks 3, 4).

**Placeholder scan:** none — every code step is complete.
