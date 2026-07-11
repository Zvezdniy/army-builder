# Conditional Visibility (hidden + instanceOf) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Options that don't match the current roster state (e.g. wrong-detachment enhancements) are hidden in the builder, by mapping BattleScribe `hidden` (static + `set hidden` modifiers gated by `instanceOf`/`notInstanceOf`) through parser → IR → engine-eval → web, for scopes self/force/roster.

**Architecture:** Four thin layers. (1) Domain adds `IrEntry.hidden` + `IrEntry.visibilityModifiers`. (2) Parser reads static `hidden`, maps `field="hidden"` selectionEntry modifiers into `visibilityModifiers` (strict: drop the whole modifier if any condition is unmappable — never over-hide), and remaps `instanceOf`→(atLeast,1) / `notInstanceOf`→(lessThan,1). (3) engine-eval exposes `hiddenEntryIds(roster, catalogue): Set<string>`, folding static+modifier visibility per entry via a synthetic self-node (roster/force scopes read the real roster). (4) web filters the picker and unit-config option lists by that set.

**Tech Stack:** TS (Zod domain; engine-eval + web Vitest, engine-eval 100% coverage) + Rust parser (serde, golden). ESM, strict TS.

## Global Constraints

- Shared IR shape (Rust serde camelCase MUST equal Zod field names):
  - `IrEntry.hidden`: boolean, omitted when false.
  - `IrEntry.visibilityModifiers`: array, omitted when empty.
  - `VisibilityModifier = { set: boolean, conditions?: IrCondition[], conditionGroups?: IrConditionGroup[] }`.
- Supported hidden-gate scopes: **self, force, roster** only. A `field="hidden"` modifier is emitted ONLY if ALL its conditions/condition-groups map (comparator ∈ {atLeast, atMost, equalTo, notEqualTo, greaterThan, lessThan, instanceOf, notInstanceOf}; scope ∈ {self, force, roster}; field maps). If ANY sub-condition is unmappable → drop the WHOLE modifier + `modifier.hidden_condition_unmapped` diagnostic (entry stays visible). Never drop a single condition inside a hidden gate.
- `instanceOf` → `(comparator="atLeast", value=1)`; `notInstanceOf` → `(comparator="lessThan", value=1)`. Applies to ALL conditions (cost/constraint too) — additive.
- Scope limited to hidden modifiers on `<selectionEntry>` + static `hidden` on selectionEntry/selectionEntryGroup. entryLink-hosted hidden is OUT (needs raw+resolve plumbing).
- mini40k golden byte-identical (no hidden/instanceOf in the fixture). Verify, do NOT regenerate.
- Keep `#![forbid(unsafe_code)]`; no new deps. English identifiers/comments. Commit messages in English with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Domain — VisibilityModifier + IrEntry.hidden/visibilityModifiers

**Files:**
- Create: `packages/domain/src/visibility.ts`
- Modify: `packages/domain/src/ir.ts`
- Modify: `packages/domain/src/index.ts` (barrel export)
- Test: `packages/domain/test/visibility.test.ts` (or the existing IR test file — follow the package's test layout)

**Interfaces:**
- Produces: `VisibilityModifier` type/schema; `IrEntry.hidden?: boolean`; `IrEntry.visibilityModifiers?: VisibilityModifier[]`.

- [ ] **Step 1: Write the failing schema test**

Create `packages/domain/test/visibility.test.ts` (check the domain package's test dir/glob first; if tests live elsewhere, place it accordingly):

```typescript
import { describe, it, expect } from "vitest";
import { IrEntry, VisibilityModifier } from "@muster/domain";

describe("VisibilityModifier + IrEntry visibility fields", () => {
  it("parses a VisibilityModifier with an instanceOf-derived condition", () => {
    const vm = VisibilityModifier.parse({
      set: true,
      conditions: [{ id: "c", comparator: "atLeast", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det" }],
    });
    expect(vm.set).toBe(true);
    expect(vm.conditions?.[0].comparator).toBe("atLeast");
  });

  it("defaults hidden=false and visibilityModifiers=[] on a bare entry", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.hidden).toBe(false);
    expect(e.visibilityModifiers).toEqual([]);
  });

  it("carries hidden + visibilityModifiers through IrEntry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E", hidden: true,
      visibilityModifiers: [{ set: true, conditionGroups: [{ type: "or", conditions: [
        { id: "c", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det" },
      ] }] }],
    });
    expect(e.hidden).toBe(true);
    expect(e.visibilityModifiers?.[0].conditionGroups?.[0].type).toBe("or");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/domain test -- visibility`
Expected: FAIL (`VisibilityModifier` is not exported; `hidden`/`visibilityModifiers` unknown).

- [ ] **Step 3: Create the VisibilityModifier schema**

Create `packages/domain/src/visibility.ts`:

```typescript
import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A `set hidden = <set>` gate: hidden becomes `set` when the conditions pass.
// Emitted by the parser only when every condition maps (never over-hide).
export const VisibilityModifier = z.object({
  set: z.boolean(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type VisibilityModifier = z.infer<typeof VisibilityModifier>;
```

- [ ] **Step 4: Add the fields to IrEntry**

In `packages/domain/src/ir.ts`:
- Add import near the top: `import { VisibilityModifier } from "./visibility";`
- In the `IrEntry` interface (the explicit `export interface IrEntry`), add after `profiles?: IrProfile[];`:

```typescript
  hidden?: boolean;
  visibilityModifiers?: VisibilityModifier[];
```

- In the `z.lazy(() => z.object({ ... }))` schema for `IrEntry`, add after `profiles: z.array(IrProfile).default([]),`:

```typescript
    hidden: z.boolean().default(false),
    visibilityModifiers: z.array(VisibilityModifier).default([]),
```

- [ ] **Step 5: Export from the barrel**

In `packages/domain/src/index.ts`, add an export for the new module following the existing pattern (e.g. `export * from "./visibility";` or the explicit style already used). Match how `./conditions`/`./modifiers` are exported.

- [ ] **Step 6: Run domain tests (with coverage)**

Run: `pnpm --filter @muster/domain test`
Expected: PASS, 100% coverage maintained (the three tests exercise every branch of `visibility.ts` and the new IrEntry fields).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/visibility.ts packages/domain/src/ir.ts packages/domain/src/index.ts packages/domain/test/visibility.test.ts
git commit -m "feat(domain): IrEntry.hidden + visibilityModifiers schema

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Parser — read hidden, map hidden modifiers + instanceOf/notInstanceOf

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs` (RawEntry/RawGroup `hidden`, RawModifier `value_raw`)
- Modify: `packages/engine-parser/src/raw/parse.rs` (read `hidden` attr, capture `value_raw`)
- Modify: `packages/engine-parser/src/ir/model.rs` (IrEntry `hidden` + `visibility_modifiers`; new `IrVisibilityModifier`)
- Modify: `packages/engine-parser/src/ir/map.rs` (instanceOf remap; hidden-modifier routing; strict condition mapping; emit fields)
- Test: `packages/engine-parser/tests/map.rs`, `packages/engine-parser/tests/raw_parse.rs`

**Interfaces:**
- Consumes: domain shape from Task 1 (field names `hidden`, `visibilityModifiers`; `VisibilityModifier = {set, conditions?, conditionGroups?}`).
- Produces: IR JSON with `hidden` (skip-if-false) and `visibilityModifiers` (skip-if-empty) on entries.

- [ ] **Step 1: Write failing parser tests**

Append to `packages/engine-parser/tests/map.rs`:

```rust
#[test]
fn maps_hidden_modifier_with_instance_of_roster_scope() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.enh" name="Enh" type="upgrade" hidden="false">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditions>
            <condition type="notInstanceOf" value="1" field="selections" scope="roster" childId="cat.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.enh").unwrap();
    assert_eq!(e.hidden, false);
    assert_eq!(e.visibility_modifiers.len(), 1);
    let vm = &e.visibility_modifiers[0];
    assert_eq!(vm.set, true);
    let c = &vm.conditions.as_ref().unwrap()[0];
    assert_eq!((c.comparator.as_str(), c.value), ("lessThan", 1.0)); // notInstanceOf -> lessThan 1
    assert_eq!(c.scope, "roster");
    // hidden modifiers are NOT reported as target_unmapped
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"));
}

#[test]
fn drops_hidden_modifier_with_unsupported_scope() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <modifiers>
        <modifier type="set" value="true" field="hidden">
          <conditionGroups><conditionGroup type="or"><conditions>
            <condition type="instanceOf" value="1" field="selections" scope="root-entry" childId="cat.x"/>
          </conditions></conditionGroup></conditionGroups>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    // unsupported scope -> whole modifier dropped, entry stays visible
    assert!(e.visibility_modifiers.is_empty());
    assert_eq!(e.hidden, false);
    assert!(diags.iter().any(|d| d.code == "modifier.hidden_condition_unmapped"));
}

#[test]
fn reads_static_hidden_attribute() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.h" name="H" type="upgrade" hidden="true"/>
  </selectionEntries>
</catalogue>"#;
    let (ir, _d) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.h").unwrap();
    assert_eq!(e.hidden, true);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p engine-parser --test map maps_hidden_modifier_with_instance_of_roster_scope drops_hidden_modifier_with_unsupported_scope reads_static_hidden_attribute`
Expected: FAIL (compile errors — `visibility_modifiers`/`hidden` fields don't exist).

- [ ] **Step 3: Raw model — add fields**

In `packages/engine-parser/src/raw/model.rs`:
- `RawEntry`: add `pub hidden: bool,` (after `entry_type`).
- `RawGroup`: add `pub hidden: bool,` (in its field list).
- `RawModifier`: add `pub value_raw: String,` (after `value`). Doc: raw unparsed `value` attribute, needed for `field="hidden"` where value is `"true"/"false"`.

- [ ] **Step 4: Raw parse — read hidden + value_raw**

In `packages/engine-parser/src/raw/parse.rs`:
- In `read_entry` (the `RawEntry { ... }` initializer) and the `Empty` `selectionEntry` branch in `read_entries_into`, set `hidden: attr_bool(start /* or &e */, b"hidden"),`.
- In `read_group` and the `Empty` `selectionEntryGroup` branch in `read_groups_into`, set `hidden: attr_bool(...)` on the `RawGroup { ... }` initializer.
- In `read_modifiers_into` where each `RawModifier { ... }` is built (around line 656-661), add `value_raw: attr(&e, b"value").unwrap_or_default(),` alongside the existing `value: attr_f64(&e, b"value").unwrap_or(0.0),`.

(`attr_bool` and `attr` already exist in this file.)

- [ ] **Step 5: IR model — add fields + IrVisibilityModifier**

In `packages/engine-parser/src/ir/model.rs`:
- Add a helper (top-level): `fn is_false(b: &bool) -> bool { !*b }`.
- In `IrEntry`, add (after `profiles`):

```rust
    #[serde(skip_serializing_if = "is_false")]
    pub hidden: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub visibility_modifiers: Vec<IrVisibilityModifier>,
```

- Add the new struct (near `IrModifier`):

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrVisibilityModifier {
    pub set: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}
```

- [ ] **Step 6: map.rs — instanceOf remap**

In `packages/engine-parser/src/ir/map.rs`, in `map_condition`, replace the comparator match:

```rust
    let comparator = match c.comparator.as_str() {
        "atLeast" | "atMost" | "equalTo" | "notEqualTo" | "greaterThan" | "lessThan" => c.comparator.clone(),
        other => {
            diags.push(Diagnostic {
                code: "condition.comparator_unmapped".to_string(),
                message: format!("condition on {} has unmappable comparator {}", c.child_id, other),
            });
            return None;
        }
    };
```

with:

```rust
    // instanceOf / notInstanceOf are membership flags: "has >=1 instance of childId
    // in scope" / "has 0". They map onto the existing count comparators with value 1.
    let (comparator, value) = match c.comparator.as_str() {
        "atLeast" | "atMost" | "equalTo" | "notEqualTo" | "greaterThan" | "lessThan" => (c.comparator.clone(), c.value),
        "instanceOf" => ("atLeast".to_string(), 1.0),
        "notInstanceOf" => ("lessThan".to_string(), 1.0),
        other => {
            diags.push(Diagnostic {
                code: "condition.comparator_unmapped".to_string(),
                message: format!("condition on {} has unmappable comparator {}", c.child_id, other),
            });
            return None;
        }
    };
```

Then in the `IrCondition { ... }` this function returns, change `value: c.value,` to `value,`.

- [ ] **Step 7: map.rs — strict condition mapping + hidden-modifier routing**

Add these helpers (place after `map_condition_group`):

```rust
/// Strict all-or-nothing condition-group mapping for visibility gates: if any
/// nested condition or sub-group is unmappable, the whole group fails (`?`
/// propagates None) so the caller can drop the entire hidden modifier rather
/// than silently weakening the gate (which would over-hide). Diagnostics from the
/// inner attempts are discarded here; the caller emits one `hidden_condition_unmapped`.
fn map_condition_group_strict(g: &RawConditionGroup, cat: &RawCatalogue) -> Option<IrConditionGroup> {
    let type_ = match g.kind.as_str() {
        "and" | "or" => g.kind.clone(),
        _ => return None,
    };
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &g.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for sub in &g.groups {
        condition_groups.push(map_condition_group_strict(sub, cat)?);
    }
    Some(IrConditionGroup {
        type_,
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}

/// Map a `field="hidden"` modifier into an IrVisibilityModifier. Returns None if
/// ANY condition/group is unmappable — the caller then drops the whole modifier
/// (never over-hide). `set` is the boolean the modifier writes to `hidden`.
fn map_visibility_modifier(m: &RawModifier, cat: &RawCatalogue) -> Option<IrVisibilityModifier> {
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &m.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrVisibilityModifier {
        set: m.value_raw == "true",
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}
```

In `map_entry`, add a `visibility_modifiers` accumulator and route `field="hidden"` modifiers. Change the modifier loop from:

```rust
    for (index, m) in e.modifiers.iter().enumerate() {
        let ir_mod = map_modifier(m, &e.id, index, cat, diags);
        if cat.cost_types.contains_key(&m.field) {
```

to:

```rust
    let mut visibility_modifiers: Vec<IrVisibilityModifier> = Vec::new();
    for (index, m) in e.modifiers.iter().enumerate() {
        if m.field == "hidden" {
            match map_visibility_modifier(m, cat) {
                Some(vm) => visibility_modifiers.push(vm),
                None => diags.push(Diagnostic {
                    code: "modifier.hidden_condition_unmapped".to_string(),
                    message: format!("hidden modifier on entry {} has an unmappable condition (dropped)", e.id),
                }),
            }
            continue;
        }
        let ir_mod = map_modifier(m, &e.id, index, cat, diags);
        if cat.cost_types.contains_key(&m.field) {
```

Then in the returned `IrEntry { ... }` literal, add:

```rust
        profiles,
        hidden: e.hidden,
        visibility_modifiers,
```

- [ ] **Step 8: Run parser tests**

Run: `cargo test -p engine-parser --test map`
Expected: the three new tests PASS; all existing map tests still PASS.

- [ ] **Step 9: Add a raw_parse test for hidden/value_raw**

Append to `packages/engine-parser/tests/raw_parse.rs`:

```rust
#[test]
fn reads_hidden_attr_and_modifier_value_raw() {
    let xml = br#"<catalogue id="c" name="C" gameSystemId="g" revision="1">
      <selectionEntries>
        <selectionEntry id="e" name="E" type="upgrade" hidden="true">
          <modifiers><modifier type="set" value="true" field="hidden"/></modifiers>
        </selectionEntry>
      </selectionEntries>
    </catalogue>"#;
    let cat = parse_raw(xml).unwrap();
    let e = cat.entries.iter().find(|e| e.id == "e").unwrap();
    assert!(e.hidden);
    assert_eq!(e.modifiers[0].value_raw, "true");
}
```

- [ ] **Step 10: Confirm golden unchanged + full crate green**

Run: `cargo test -p engine-parser --test golden` then `cargo test -p engine-parser`
Expected: golden byte-identical (mini40k has no hidden/instanceOf); all crate tests pass. Run `cargo clippy -p engine-parser --all-targets` and fix any warning in the files you changed (ignore pre-existing warnings in untouched files).

- [ ] **Step 11: Commit**

```bash
git add packages/engine-parser/src/raw/model.rs packages/engine-parser/src/raw/parse.rs packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs packages/engine-parser/tests/raw_parse.rs
git commit -m "feat(parser): map static hidden + hidden modifiers (instanceOf/notInstanceOf)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: engine-eval — hiddenEntryIds

**Files:**
- Modify: `packages/engine-eval/src/conditions.ts` (extract `passesGate`)
- Create: `packages/engine-eval/src/visibility.ts`
- Modify: `packages/engine-eval/src/index.ts` (barrel export)
- Test: `packages/engine-eval/test/visibility.test.ts`

**Interfaces:**
- Consumes: `IrEntry.hidden`, `IrEntry.visibilityModifiers` (Task 1 shape); `buildSymbolTable`, `buildState`, `EvalNode` (existing).
- Produces: `hiddenEntryIds(roster: Roster, catalogue: IrCatalogue): Set<string>`.

- [ ] **Step 1: Write the failing test**

Create `packages/engine-eval/test/visibility.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { hiddenEntryIds } from "@muster/engine-eval";

// Detachment category cat.det; an enhancement hidden unless the roster holds a
// detachment selection of that category (set hidden=true when 0 instances → notInstanceOf).
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.det", name: "Detachment", costs: [], categories: ["cat.det"], constraints: [], children: [] },
      {
        id: "e.enh", name: "Enhancement", costs: [], categories: [], constraints: [], children: [],
        visibilityModifiers: [{
          set: true,
          conditions: [{ id: "c1", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det" }],
        }],
      },
      { id: "e.plain", name: "Plain", costs: [], categories: [], constraints: [], children: [] },
      { id: "e.static", name: "Static", costs: [], categories: [], constraints: [], children: [], hidden: true },
    ],
  };
}
const roster = (members: string[]): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: members.map((m, i) => ({ id: `s${i}`, entryId: m, count: 1, selections: [] })),
});

describe("hiddenEntryIds", () => {
  it("hides the enhancement when no matching detachment is in the roster", () => {
    const hidden = hiddenEntryIds(roster([]), cat());
    expect(hidden.has("e.enh")).toBe(true);
  });
  it("reveals the enhancement when the detachment is present", () => {
    const hidden = hiddenEntryIds(roster(["e.det"]), cat());
    expect(hidden.has("e.enh")).toBe(false);
  });
  it("always hides a statically hidden entry", () => {
    expect(hiddenEntryIds(roster([]), cat()).has("e.static")).toBe(true);
  });
  it("never hides an entry with no visibility rules", () => {
    expect(hiddenEntryIds(roster(["e.det"]), cat()).has("e.plain")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/engine-eval test -- visibility`
Expected: FAIL (`hiddenEntryIds` not exported).

- [ ] **Step 3: Extract `passesGate` in conditions.ts**

In `packages/engine-eval/src/conditions.ts`, add an exported helper and refactor `gatePasses` to use it (behavior unchanged):

```typescript
export function passesGate(
  conditions: IrCondition[] | undefined,
  conditionGroups: IrConditionGroup[] | undefined,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  const conditionsOk = (conditions ?? []).every((c) => evaluateCondition(c, node, state, costOf));
  const groupsOk = (conditionGroups ?? []).every((g) => evaluateConditionGroup(g, node, state, costOf));
  return conditionsOk && groupsOk;
}
```

and change `gatePasses`'s body to:

```typescript
export function gatePasses(
  modifier: IrModifier,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  return passesGate(modifier.conditions, modifier.conditionGroups, node, state, costOf);
}
```

Add `IrCondition` to the `import type { ... } from "@muster/domain";` line if not already present.

- [ ] **Step 4: Create visibility.ts**

Create `packages/engine-eval/src/visibility.ts`:

```typescript
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState, type EvalNode } from "./state";
import { passesGate } from "./conditions";

// Catalogue entry ids whose effective `hidden` is true given the current roster.
// Each entry's visibility is folded from its static `hidden` plus its
// visibilityModifiers, evaluated against a synthetic self-node (roster/force
// scopes read the real roster state; self reads the synthetic entry node).
// The parser guarantees every visibilityModifier's conditions use only
// self/force/roster scopes, so no unresolved-scope case reaches here.
export function hiddenEntryIds(roster: Roster, catalogue: IrCatalogue): Set<string> {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const hidden = new Set<string>();
  for (const entry of symbols.values()) {
    const mods = entry.visibilityModifiers ?? [];
    if (mods.length === 0) {
      if (entry.hidden) hidden.add(entry.id);
      continue;
    }
    const synth: EvalNode = {
      selectionId: `synthetic:${entry.id}`,
      entry,
      count: 1,
      multiplier: 1,
      effectiveCount: 1,
      categories: entry.categories,
      parent: null,
      children: [],
    };
    let isHidden = entry.hidden ?? false;
    for (const m of mods) {
      if (passesGate(m.conditions, m.conditionGroups, synth, state)) {
        isHidden = m.set;
      }
    }
    if (isHidden) hidden.add(entry.id);
  }
  return hidden;
}
```

- [ ] **Step 5: Export from the barrel**

In `packages/engine-eval/src/index.ts`, add `export { hiddenEntryIds } from "./visibility";` (follow the file's existing export style).

- [ ] **Step 6: Run engine-eval tests (with coverage)**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all PASS, 100% coverage. The four visibility tests cover: static-only hidden (mods empty + hidden), modifier hides (gate true → set true), modifier reveals (gate false → keeps false), and no-rules entry. If coverage flags the `entry.hidden ?? false` else-branch or the `mods.length===0 && !hidden` path, the tests above already exercise both (e.plain has no mods and is not hidden; e.static has no mods and is hidden).

- [ ] **Step 7: Commit**

```bash
git add packages/engine-eval/src/conditions.ts packages/engine-eval/src/visibility.ts packages/engine-eval/src/index.ts packages/engine-eval/test/visibility.test.ts
git commit -m "feat(engine-eval): hiddenEntryIds — effective visibility per entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: web — filter picker and unit-config by hidden set

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/AddUnitPicker.tsx`
- Modify: `apps/web/src/components/UnitDetail.tsx`
- Modify: `apps/web/src/components/UnitConfig.tsx`
- Test: `apps/web/src/components/AddUnitPicker.test.tsx` (create or extend), `apps/web/src/components/UnitConfig.test.tsx` (create or extend)

**Interfaces:**
- Consumes: `hiddenEntryIds` (Task 3).
- Produces: picker and config hide entries in the set.

- [ ] **Step 1: Compute the hidden set in App and thread it down**

In `apps/web/src/App.tsx`:
- Add import: `import { evaluate, hiddenEntryIds } from "@muster/engine-eval";` (extend the existing import).
- Add: `const hiddenIds = useMemo(() => hiddenEntryIds(roster, catalogue), [roster, catalogue]);`
- Pass `hiddenIds={hiddenIds}` to `<AddUnitPicker ... />` and to `<UnitDetail ... />`.

- [ ] **Step 2: Filter the picker**

In `apps/web/src/components/AddUnitPicker.tsx`:
- Add `hiddenIds: Set<string>` to the component props type.
- Change the units line to also drop hidden:

```typescript
  const units = availableUnits(catalogue)
    .filter((u) => !hiddenIds.has(u.id))
    .filter((u) => u.name.toLowerCase().includes(q));
```

- [ ] **Step 3: Thread the set through UnitDetail to UnitConfig**

In `apps/web/src/components/UnitDetail.tsx`: add `hiddenIds: Set<string>` to its props and pass `hiddenIds={hiddenIds}` to the `<UnitConfig ... />` it renders.

In `apps/web/src/components/UnitConfig.tsx`:
- Add `hiddenIds: Set<string>` to props.
- After `const { options, groups } = optionsFor(...)`, filter options and group members:

```typescript
  const visibleOptions = options.filter((o) => !hiddenIds.has(o.id));
```

Use `visibleOptions` wherever `options` is currently mapped for rendering (the free-options list). For group members, wrap the `g.memberEntryIds.map(...)` so hidden ids are skipped, e.g. `g.memberEntryIds.filter((id) => !hiddenIds.has(id)).map(...)`. Preserve the existing `presentEntryIds`/`memberIds` logic; apply the hidden filter in addition.

- [ ] **Step 4: Write web tests**

Create/extend `apps/web/src/components/AddUnitPicker.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AddUnitPicker } from "./AddUnitPicker";
import type { IrCatalogue } from "@muster/domain";

const catalogue: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    { id: "e.shown", name: "Shown Unit", costs: [], categories: ["cat.hq"], constraints: [], children: [] },
    { id: "e.hidden", name: "Hidden Unit", costs: [], categories: ["cat.hq"], constraints: [], children: [] },
  ],
};

describe("AddUnitPicker hidden filtering", () => {
  it("omits units whose id is in hiddenIds", () => {
    render(<AddUnitPicker catalogue={catalogue} hiddenIds={new Set(["e.hidden"])} onAdd={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("Shown Unit")).not.toBeNull();
    expect(screen.queryByText("Hidden Unit")).toBeNull();
  });
});
```

(Follow the existing web test setup — check `apps/web/src/components/RosterList.test.tsx` for the render/import conventions and any test setup file. `availableUnits` treats every top-level entry as a unit; adjust the fixture if `availableUnits` requires specific shape.)

- [ ] **Step 5: Run web + full suite**

Run: `pnpm --filter @muster/web test` then `pnpm -w turbo run test`
Expected: web tests pass; 4/4 packages green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/AddUnitPicker.tsx apps/web/src/components/UnitDetail.tsx apps/web/src/components/UnitConfig.tsx apps/web/src/components/AddUnitPicker.test.tsx
git commit -m "feat(web): hide options filtered by hiddenEntryIds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Domain shape (hidden + visibilityModifiers) — Task 1.
- Static hidden read + hidden-modifier strict mapping + instanceOf/notInstanceOf remap — Task 2 (Steps 6–7), tested Steps 1/9. Never-over-hide (whole-modifier drop) — `drops_hidden_modifier_with_unsupported_scope`.
- Effective visibility (`hiddenEntryIds`) with synthetic self-node, roster/force against real state — Task 3, tested Step 1.
- Web filtering picker + config — Task 4.
- Golden unchanged — Task 2 Step 10.
- Real-data tangible check (instanceOf diagnostics drop; builder hides options) — controller post-merge (real GW-IP IR out of git).

**Placeholder scan:** The web test fixture and the exact render conventions (Task 4 Step 4) reference "follow existing test setup" — the implementer must read `RosterList.test.tsx` first. All src changes carry exact code/diffs. The `index.ts` barrel exports (Tasks 1/3) say "follow existing style" because the barrel's export idiom (star vs named) isn't shown here — the implementer matches the file.

**Type/name consistency:** Rust `visibility_modifiers`/`hidden` serialize (camelCase) to `visibilityModifiers`/`hidden`, matching the Zod `IrEntry` fields (Task 1). `IrVisibilityModifier { set, conditions, condition_groups }` → `{ set, conditions, conditionGroups }` == `VisibilityModifier`. `hiddenEntryIds(roster, catalogue)` signature identical in Task 3 (produce) and Task 4 (consume). `passesGate(conditions, conditionGroups, node, state, costOf?)` used by both `gatePasses` and `visibility.ts`.

## Execution Handoff

Subagent-Driven: Task 1 → review → Task 2 → review → Task 3 → review → Task 4 → review → final whole-branch review + full turbo. Tasks are ordered by dependency (domain shape → parser produces → engine-eval consumes → web consumes engine-eval).
