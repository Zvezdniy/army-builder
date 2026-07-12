# Conditional Category Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce BattleScribe `field="category"` `type="add"`/`"remove"` modifiers — conditional category membership (e.g. a unit gains a detachment keyword when that detachment is taken) — which the engine currently drops, so category-based limits/conditions count the effective membership.

**Architecture:** Mirror the validation-rules/visibility infra. `IrCategoryModifier = {type: "add"|"remove", categoryId, conditions?, conditionGroups?}` on `IrEntry.categoryModifiers`. The parser maps them STRICTLY (all-or-nothing on conditions) else drops the whole modifier loudly. engine-eval resolves effective membership (`static ∪ added(gate) \ removed(gate)`) into the ALREADY-SEPARATE `EvalNode.categories` field via a new `resolveCategories(state)` step run right after `buildState`; every downstream category aggregation already reads `node.categories`, so nothing else changes.

**Tech Stack:** Rust (quick-xml + serde) parser; TypeScript (Zod domain, pure-TS engine-eval); Vitest; Cargo test.

## Global Constraints

- Never miscompile / never over-enforce: a category modifier is applied ONLY when EVERY condition/conditionGroup maps faithfully; any unmappable part → the whole modifier is dropped loudly (`modifier.category_condition_unmapped`) and membership is unchanged. No partial mapping. (Adding a category can newly trip a `max` — correct only if the add is faithful.)
- Only `type="add"` and `type="remove"` map. `set-primary` → `modifier.category_set_primary_unsupported` + drop (it does not change membership). Any other type → `modifier.category_type_unsupported` + drop.
- The category id is the modifier's raw string value (`m.value_raw`).
- `resolveCategories` is TWO-PHASE (compute all effective sets reading static membership, THEN assign) so the result is order-independent. It runs AFTER `buildState` and BEFORE `resolveCosts`.
- `entry.categories` is NEVER mutated — `resolveCategories` assigns a NEW array to `node.categories` (the entry's array is shared across inlined duplicates).
- No-op invariant: an entry with no category modifiers yields `node.categories` identical to `entry.categories` (no behavior change; existing tests stay green).
- New serialized fields appear only when present (`skip_serializing_if = "Vec::is_empty"` / `.default([])`) → mini40k golden IR byte-identical.
- Reuse existing machinery: parser `map_condition`/`map_condition_group_strict`; engine `passesGate`. No duplicated condition logic.
- Code/identifiers/commit messages in English. Repo stays local (do not push).

---

### Task 1: domain — `IrCategoryModifier` + `IrEntry.categoryModifiers`

**Files:**
- Create: `packages/domain/src/category-modifiers.ts`
- Modify: `packages/domain/src/index.ts` (add export)
- Modify: `packages/domain/src/ir.ts` (import; `IrEntry` interface after `validationRules?`; Zod object after `validationRules`)
- Test: `packages/domain/test/category-modifiers.test.ts`

**Interfaces:**
- Consumes: `IrCondition`, `IrConditionGroup` from `./conditions`.
- Produces: `IrCategoryModifier` = `{type: "add"|"remove", categoryId: string, conditions?: IrCondition[], conditionGroups?: IrConditionGroup[]}`; `IrEntry.categoryModifiers?: IrCategoryModifier[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/category-modifiers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IrCategoryModifier, IrEntry } from "@muster/domain";

describe("IrCategoryModifier", () => {
  it("parses an add with a gating condition", () => {
    const parsed = IrCategoryModifier.parse({
      type: "add", categoryId: "cat.keyword",
      conditions: [{
        id: "cond.atLeast.det", comparator: "atLeast", value: 1,
        field: "selections", scope: "roster", targetType: "entry",
        targetId: "e.det", includeChildSelections: true,
      }],
    });
    expect(parsed.type).toBe("add");
    expect(parsed.categoryId).toBe("cat.keyword");
    expect(parsed.conditions?.[0]?.comparator).toBe("atLeast");
  });

  it("defaults IrEntry.categoryModifiers to [] when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.categoryModifiers).toEqual([]);
  });

  it("carries categoryModifiers on an entry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E",
      categoryModifiers: [{ type: "remove", categoryId: "cat.x" }],
    });
    expect(e.categoryModifiers?.[0]?.type).toBe("remove");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test -- category-modifiers.test.ts`
Expected: FAIL — `IrCategoryModifier` not exported; `IrEntry` has no `categoryModifiers`.

- [ ] **Step 3: Create the domain module**

Create `packages/domain/src/category-modifiers.ts`:

```ts
import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A conditional category-membership change (BattleScribe `field="category"`
// modifier): when the conditions pass, the entry gains (`add`) or loses
// (`remove`) `categoryId`. Emitted by the parser only when every condition maps.
export const IrCategoryModifier = z.object({
  type: z.enum(["add", "remove"]),
  categoryId: z.string(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrCategoryModifier = z.infer<typeof IrCategoryModifier>;
```

- [ ] **Step 4: Export it from the domain index**

In `packages/domain/src/index.ts`, add:

```ts
export * from "./category-modifiers";
```

- [ ] **Step 5: Add `categoryModifiers` to `IrEntry`**

In `packages/domain/src/ir.ts`:

Add the import near the top (next to the `IrValidationRule` import):

```ts
import { IrCategoryModifier } from "./category-modifiers";
```

Add to the `IrEntry` interface (after `validationRules?: IrValidationRule[];`):

```ts
  categoryModifiers?: IrCategoryModifier[];
```

Add to the Zod object (after `validationRules: z.array(IrValidationRule).default([])`):

```ts
    categoryModifiers: z.array(IrCategoryModifier).default([]),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test -- category-modifiers.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the domain suite + typecheck**

Run: `pnpm --filter @muster/domain test && pnpm --filter @muster/domain exec tsc --noEmit`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/category-modifiers.ts packages/domain/src/index.ts packages/domain/src/ir.ts packages/domain/test/category-modifiers.test.ts
git commit -m "feat(domain): IrCategoryModifier + IrEntry.categoryModifiers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: parser — map `field="category"` modifiers

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs` (add `IrCategoryModifier` struct; add `category_modifiers` to `IrEntry`)
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_entry` modifier loop; new `map_category_modifier`)
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Consumes: `RawModifier { kind, field, value_raw, conditions, condition_groups }`; existing `map_condition`, `map_condition_group_strict`.
- Produces: `IrEntry` serialized with a camelCase `categoryModifiers` array of `{type, categoryId, conditions?, conditionGroups?}` matching Task 1.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine-parser/tests/map.rs`:

```rust
#[test]
fn maps_category_add_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <modifiers>
        <modifier type="add" value="cat.keyword" field="category">
          <conditions>
            <condition type="atLeast" value="1" field="selections" scope="roster" childId="e.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert_eq!(u.category_modifiers.len(), 1, "{:?}", diags);
    assert_eq!(u.category_modifiers[0].type_, "add");
    assert_eq!(u.category_modifiers[0].category_id, "cat.keyword");
    assert_eq!(u.category_modifiers[0].conditions.as_ref().unwrap().len(), 1);
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
}

#[test]
fn drops_category_modifier_with_unmappable_condition() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <modifiers>
        <modifier type="add" value="cat.keyword" field="category">
          <conditions>
            <condition type="atLeast" value="1" field="selections" scope="8da0-4570-c3c-819f" childId="e.det"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.category_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.category_condition_unmapped"), "{:?}", diags);
}

#[test]
fn drops_set_primary_category_modifier() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="Unit" type="unit">
      <modifiers>
        <modifier type="set-primary" value="cat.keyword" field="category"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let u = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(u.category_modifiers.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.category_set_primary_unsupported"), "{:?}", diags);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p engine-parser maps_category_add_modifier drops_category_modifier_with_unmappable_condition drops_set_primary_category_modifier`
Expected: compile failure — `IrEntry` has no `category_modifiers` field. That is the expected red.

- [ ] **Step 3: Add the Rust structs**

In `packages/engine-parser/src/ir/model.rs`, add `category_modifiers` to `IrEntry` (after `validation_rules`):

```rust
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub category_modifiers: Vec<IrCategoryModifier>,
```

Add a new struct near `IrValidationRule`:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrCategoryModifier {
    #[serde(rename = "type")]
    pub type_: String,
    pub category_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}
```

- [ ] **Step 4: Add `map_category_modifier` and the category branch**

In `packages/engine-parser/src/ir/map.rs`, add this fn next to `map_validation_rule`:

```rust
/// Map a `field="category"` add/remove modifier into a category-membership rule.
/// Strict all-or-nothing on conditions (like map_validation_rule): returns None
/// (caller drops the whole modifier) if any condition/condition-group is
/// unmappable, so a partially-represented gate can never add/remove a category
/// (which could newly trip a category limit). The category id is the raw value.
fn map_category_modifier(m: &RawModifier, cat: &RawCatalogue) -> Option<IrCategoryModifier> {
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &m.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrCategoryModifier {
        type_: m.kind.clone(),
        category_id: m.value_raw.clone(),
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}
```

In `map_entry`, declare the accumulator (next to `validation_rules`):

```rust
    let mut category_modifiers: Vec<IrCategoryModifier> = Vec::new();
```

Add the branch inside the modifier loop, immediately AFTER the `if m.field == "error" { … continue; }` block (before the cost-type/constraint branches):

```rust
        if m.field == "category" {
            match m.kind.as_str() {
                "add" | "remove" => match map_category_modifier(m, cat) {
                    Some(cm) => category_modifiers.push(cm),
                    None => diags.push(Diagnostic {
                        code: "modifier.category_condition_unmapped".to_string(),
                        message: format!("category modifier on entry {} has an unmappable condition (dropped)", e.id),
                    }),
                },
                "set-primary" => diags.push(Diagnostic {
                    code: "modifier.category_set_primary_unsupported".to_string(),
                    message: format!("set-primary category modifier on entry {} does not affect membership (dropped)", e.id),
                }),
                other => diags.push(Diagnostic {
                    code: "modifier.category_type_unsupported".to_string(),
                    message: format!("category modifier on entry {} has unsupported type {} (dropped)", e.id, other),
                }),
            }
            continue;
        }
```

Add `category_modifiers` to the `IrEntry { … }` constructor (after `validation_rules`):

```rust
        category_modifiers,
```

- [ ] **Step 5: Run the parser tests**

Run: `cargo test -p engine-parser`
Expected: all pass including the three new tests.

- [ ] **Step 6: Verify the golden IR is byte-identical**

Run: `cargo test -p engine-parser --test golden`
Expected: PASS.

- [ ] **Step 7: Clippy**

Run: `cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): map field=category modifiers to category membership rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: engine-eval — resolve effective category membership

**Files:**
- Create: `packages/engine-eval/src/categories.ts`
- Modify: `packages/engine-eval/src/evaluate.ts` (import + call after buildState)
- Test: `packages/engine-eval/test/categories.test.ts`

**Interfaces:**
- Consumes: `passesGate(conditions, conditionGroups, node, state)` from `./conditions`; `EvalNode`, `EvalState` from `./state`; `node.entry.categoryModifiers`, `node.entry.categories`.
- Produces: `effectiveCategories(node, state): string[]` and `resolveCategories(state): void` (mutates `node.categories` in place). `resolveCategories(state)` is called in `evaluate()` right after `buildState`.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine-eval/test/categories.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// A unit that gains category "cat.elite" when a detachment entry e.det is in the
// roster. A force max of 0 on cat.elite means: taking the unit alongside the
// detachment newly violates the cap.
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    forceConstraints: [
      { id: "fc.elite.max", type: "max", value: 0, field: "selections", scope: "force",
        targetType: "category", targetId: "cat.elite", includeChildSelections: true },
    ],
    entries: [
      {
        id: "e.u", name: "Unit", costs: [], categories: [], constraints: [], children: [],
        categoryModifiers: [{
          type: "add", categoryId: "cat.elite",
          conditions: [{
            id: "cond.atLeast.e.det", comparator: "atLeast", value: 1,
            field: "selections", scope: "roster", targetType: "entry",
            targetId: "e.det", includeChildSelections: true,
          }],
        }],
      },
      { id: "e.det", name: "Detachment", costs: [], categories: [], constraints: [], children: [] },
    ],
  } as unknown as IrCatalogue;
}

function roster(withDetachment: boolean): Roster {
  const sels = [{ id: "u", entryId: "e.u", count: 1, selections: [] as unknown[] }];
  if (withDetachment) sels.push({ id: "d", entryId: "e.det", count: 1, selections: [] });
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: sels,
  } as unknown as Roster;
}

describe("conditional category membership (field=category)", () => {
  it("gate passes → unit gains the category → force max on it is violated", () => {
    const r = evaluate(roster(true), cat());
    expect(r.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("gate fails → membership static → no violation", () => {
    const r = evaluate(roster(false), cat());
    expect(r.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(false);
    expect(r.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/engine-eval test -- categories.test.ts`
Expected: FAIL — the "gate passes" case does not violate `fc.elite.max` yet (the conditional category isn't applied), so no issue is produced.

- [ ] **Step 3: Create the engine module**

Create `packages/engine-eval/src/categories.ts`:

```ts
import type { EvalNode, EvalState } from "./state";
import { passesGate } from "./conditions";

// The effective category set of a node = its static categories plus any
// conditionally-added categories (gate passes) minus any conditionally-removed
// ones. Gates are evaluated on the real node against the current state.
export function effectiveCategories(node: EvalNode, state: EvalState): string[] {
  const set = new Set(node.entry.categories);
  for (const cm of node.entry.categoryModifiers ?? []) {
    if (!passesGate(cm.conditions, cm.conditionGroups, node, state)) continue;
    if (cm.type === "add") set.add(cm.categoryId);
    else set.delete(cm.categoryId);
  }
  return [...set];
}

// Resolve every node's effective membership into node.categories. Two-phase
// (compute all, then assign) so each gate reads static membership uniformly and
// the result is independent of node order. Assigns a NEW array — entry.categories
// (shared across inlined duplicates) is never mutated.
export function resolveCategories(state: EvalState): void {
  const computed = state.all.map((n) => effectiveCategories(n, state));
  state.all.forEach((n, i) => {
    n.categories = computed[i]!;
  });
}
```

- [ ] **Step 4: Wire it into `evaluate()`**

In `packages/engine-eval/src/evaluate.ts`, add the import (next to the other engine imports at the top):

```ts
import { resolveCategories } from "./categories";
```

Immediately after `const state = buildState(roster, symbols);` and BEFORE `const { costOf, converged } = resolveCosts(state);`, add:

```ts
  resolveCategories(state);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @muster/engine-eval test -- categories.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full engine-eval suite**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all green (entries without category modifiers → `effectiveCategories` returns the static set → `node.categories` unchanged → no behavior change).

- [ ] **Step 7: Commit**

```bash
git add packages/engine-eval/src/categories.ts packages/engine-eval/src/evaluate.ts packages/engine-eval/test/categories.test.ts
git commit -m "feat(engine-eval): resolve conditional category membership

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: cross-language contract — parser-shaped IR applies a conditional category

**Files:**
- Test: `packages/engine-eval/test/parser-contract.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue` (Zod), `evaluate`. Catalogue in the parser's serialized shape (camelCase `categoryModifiers:[{type,categoryId,conditions:[{...}]}]`), validated via `IrCatalogue.parse`.
- Produces: none (leaf test).

- [ ] **Step 1: Write the test**

Append a `describe` to `packages/engine-eval/test/parser-contract.test.ts` (it already imports `IrCatalogue`, `evaluate`, `Roster`):

```ts
describe("parser IR contract — conditional category membership", () => {
  // Mirrors the parser's serialized shape for a field="category" add modifier.
  // Validated by Zod, then evaluated — proving parser output → domain → engine.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    forceConstraints: [
      { id: "fc.elite.max", type: "max", value: 0, field: "selections", scope: "force",
        targetType: "category", targetId: "cat.elite", includeChildSelections: true },
    ],
    entries: [
      {
        id: "e.u", name: "Unit", costs: [], categories: [], constraints: [], children: [],
        categoryModifiers: [{
          type: "add", categoryId: "cat.elite",
          conditions: [{
            comparator: "atLeast", value: 1, field: "selections", scope: "roster",
            targetType: "entry", targetId: "e.det", includeChildSelections: true,
            id: "cond.atLeast.e.det",
          }],
        }],
      },
      { id: "e.det", name: "Detachment", costs: [], categories: [], constraints: [], children: [] },
    ],
  };

  const roster = (withDetachment: boolean): Roster => {
    const selections = [{ id: "u", entryId: "e.u", count: 1, selections: [] as unknown[] }];
    if (withDetachment) selections.push({ id: "d", entryId: "e.det", count: 1, selections: [] });
    return {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections,
    } as unknown as Roster;
  };

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("the conditional category flips a force-limit outcome", () => {
    const cat = IrCatalogue.parse(shaped);
    const withDet = evaluate(roster(true), cat);
    expect(withDet.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(true);
    expect(withDet.valid).toBe(false);

    const without = evaluate(roster(false), cat);
    expect(without.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(false);
    expect(without.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @muster/engine-eval test -- parser-contract.test.ts`
Expected: PASS.

- [ ] **Step 3: Run the full suites**

Run: `pnpm --filter @muster/engine-eval test && pnpm --filter @muster/domain test && cargo test -p engine-parser`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/engine-eval/test/parser-contract.test.ts
git commit -m "test(engine-eval): cross-language contract for conditional category membership

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- domain `IrCategoryModifier` + `IrEntry.categoryModifiers` → Task 1. ✓
- parser struct + `map_category_modifier` (strict) + add/remove branch + set-primary/unknown drops → Task 2. ✓
- strict all-or-nothing (unmappable → drop whole modifier) → Task 2 (`?`-propagation) + `drops_category_modifier_with_unmappable_condition`. ✓
- engine `effectiveCategories` + two-phase `resolveCategories` mutating `node.categories`, wired after buildState/before resolveCosts → Task 3. ✓
- no-op invariant (no modifiers → static set) → Task 3 Step 6 (full suite green) + implicit in `effectiveCategories`. ✓
- entry.categories never mutated (new array via Set spread) → Task 3 `effectiveCategories`. ✓
- golden byte-identical → Task 2 Step 6. ✓
- cross-language contract → Task 4. ✓

**Type consistency:** `IrCategoryModifier` fields (`type`/`categoryId`/`conditions`/`conditionGroups`) match across domain Zod (Task 1), Rust struct (camelCase serde → `categoryId`/`conditionGroups`, Task 2), and test literals (Tasks 3, 4). `resolveCategories(state)` / `effectiveCategories(node, state)` signatures match call sites. `passesGate(conditions, conditionGroups, node, state)` matches its definition. Rust `category_modifiers`/`category_id` (snake) serialize to `categoryModifiers`/`categoryId` (camelCase), matching the domain keys.

**Placeholder scan:** none — every code step is complete.
