# Conditional Validation Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce BattleScribe `field="error"` `type="add"` modifiers — designer-authored conditional validation rules (e.g. "Max 1 {this} per 5 models") — that the engine currently drops and ignores.

**Architecture:** Mirror the existing conditional-visibility infrastructure. A new `IrValidationRule = {message, conditions?, conditionGroups?}` lives on `IrEntry.validationRules`. The parser maps a `field="error"` modifier STRICTLY (all-or-nothing on conditions, like `map_visibility_modifier`) — else drops the whole rule loudly, so a false rejection is never emitted. engine-eval emits an `error` Issue (`selection.invalid`) when a rule's gate passes, substituting `{this}` with the entry name. The web already renders `result.issues`, so no web change.

**Tech Stack:** Rust (quick-xml + serde) parser; TypeScript (Zod domain, pure-TS engine-eval); Vitest; Cargo test.

## Global Constraints

- Never over-enforce: a validation rule is emitted ONLY when EVERY condition/conditionGroup maps faithfully; any unmappable part → the whole rule is dropped loudly (`modifier.error_condition_unmapped`) and never enforced. No partial mapping (a false error rejects a legal army — the worst outcome).
- Only `type="add"` error modifiers map; any other `type` on `field="error"` → `modifier.error_type_unsupported` + drop.
- The rule's message is the modifier's raw string value (`m.value_raw`), NOT its numeric value.
- Gate is evaluated on the REAL node (owner + real ancestor chain), mirroring `nodeHiddenByState`.
- `{this}` in the message is replaced with the entry's `name` at issue time; other tokens stay literal.
- New serialized fields appear only when present (`skip_serializing_if = "Vec::is_empty"` in Rust, `.default([])` in Zod) → the mini40k golden IR stays byte-identical (fixture has no error modifiers).
- Module names avoid collisions: domain `packages/domain/src/validation.ts` is already taken by `Issue`/`ValidationResult` — the new domain type goes in `packages/domain/src/validation-rules.ts`. engine-eval has no `validation.ts` yet — create it (imported directly by `evaluate.ts`, like `groups.ts`/`visibility.ts`, not via the package index).
- Reuse existing machinery: parser `map_condition`/`map_condition_group_strict`; engine `passesGate`. Do not duplicate condition logic.
- Code/identifiers/commit messages in English. Repo stays local (do not push).

---

### Task 1: domain — `IrValidationRule` + `IrEntry.validationRules`

**Files:**
- Create: `packages/domain/src/validation-rules.ts`
- Modify: `packages/domain/src/index.ts` (add export)
- Modify: `packages/domain/src/ir.ts` (IrEntry interface ~line 68-69 and the Zod object ~line 84-85)
- Test: `packages/domain/test/validation-rules.test.ts`

**Interfaces:**
- Consumes: `IrCondition`, `IrConditionGroup` from `./conditions`.
- Produces: `IrValidationRule` (Zod + type) with `{message: string, conditions?: IrCondition[], conditionGroups?: IrConditionGroup[]}`; `IrEntry.validationRules?: IrValidationRule[]`. Rust serializes a matching `validationRules` array (Task 2); engine reads `node.entry.validationRules` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `packages/domain/test/validation-rules.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IrValidationRule, IrEntry } from "@muster/domain";

describe("IrValidationRule", () => {
  it("parses a message with a gating condition", () => {
    const parsed = IrValidationRule.parse({
      message: "Max 1 {this} per 5 models",
      conditions: [{
        id: "cond.lessThan.e.x", comparator: "lessThan", value: 10,
        field: "selections", scope: "unit", targetType: "entry",
        targetId: "e.x", includeChildSelections: false,
      }],
    });
    expect(parsed.message).toBe("Max 1 {this} per 5 models");
    expect(parsed.conditions?.[0]?.comparator).toBe("lessThan");
  });

  it("defaults IrEntry.validationRules to [] when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.validationRules).toEqual([]);
  });

  it("carries validationRules on an entry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E",
      validationRules: [{ message: "Nope", conditions: [] }],
    });
    expect(e.validationRules?.[0]?.message).toBe("Nope");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test -- validation-rules.test.ts`
Expected: FAIL — `IrValidationRule` is not exported yet (import error), and `IrEntry` has no `validationRules`.

- [ ] **Step 3: Create the domain module**

Create `packages/domain/src/validation-rules.ts` (mirror `visibility.ts`):

```ts
import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

// A designer-authored validation rule (BattleScribe `field="error"` modifier):
// when the conditions pass, the selection is invalid with `message`. Emitted by
// the parser only when every condition maps (never over-enforce / falsely reject).
export const IrValidationRule = z.object({
  message: z.string(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrValidationRule = z.infer<typeof IrValidationRule>;
```

- [ ] **Step 4: Export it from the domain index**

In `packages/domain/src/index.ts`, add (keep alphabetical-ish grouping near the other exports):

```ts
export * from "./validation-rules";
```

- [ ] **Step 5: Add `validationRules` to `IrEntry`**

In `packages/domain/src/ir.ts`:

Add the import near the top (next to the `VisibilityModifier` import at line 3):

```ts
import { IrValidationRule } from "./validation-rules";
```

Add to the `IrEntry` interface (after `visibilityModifiers?` ~line 69):

```ts
  validationRules?: IrValidationRule[];
```

Add to the Zod object (after `visibilityModifiers: z.array(VisibilityModifier).default([])` ~line 85):

```ts
    validationRules: z.array(IrValidationRule).default([]),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test -- validation-rules.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the domain suite + typecheck**

Run: `pnpm --filter @muster/domain test && pnpm --filter @muster/domain exec tsc --noEmit`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add packages/domain/src/validation-rules.ts packages/domain/src/index.ts packages/domain/src/ir.ts packages/domain/test/validation-rules.test.ts
git commit -m "feat(domain): IrValidationRule + IrEntry.validationRules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: parser — map `field=\"error\"` modifiers to validation rules

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs` (add `IrValidationRule` struct; add `validation_rules` to `IrEntry` ~line 50)
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_entry` modifier loop ~line 84-114; new `map_validation_rule`)
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Consumes: `RawModifier { kind, field, value_raw, conditions, condition_groups }` (raw/model.rs); existing `map_condition(c, cat, diags) -> Option<IrCondition>`, `map_condition_group_strict(g, cat) -> Option<IrConditionGroup>`; `map_visibility_modifier` is the structural template.
- Produces: `IrEntry` serialized with a camelCase `validationRules` array whose elements are `{message, conditions?, conditionGroups?}` matching Task 1's domain shape.

- [ ] **Step 1: Write the failing tests**

Add to `packages/engine-parser/tests/map.rs` (helpers `parse_raw`, `resolve`, `to_ir` already imported at the top):

```rust
#[test]
fn maps_error_modifier_to_validation_rule() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.w" name="Weapon" type="upgrade">
      <modifiers>
        <modifier type="add" value="Max 1 {this} per 5 models" field="error">
          <conditions>
            <condition type="atLeast" value="2" field="selections" scope="self" childId="e.w"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let w = ir.entries.iter().find(|e| e.id == "e.w").unwrap();
    assert_eq!(w.validation_rules.len(), 1, "{:?}", diags);
    assert_eq!(w.validation_rules[0].message, "Max 1 {this} per 5 models");
    assert_eq!(w.validation_rules[0].conditions.as_ref().unwrap().len(), 1);
    assert!(!diags.iter().any(|d| d.code == "modifier.target_unmapped"), "{:?}", diags);
}

#[test]
fn drops_error_modifier_with_unmappable_condition() {
    // GUID-scope condition is unmappable → the whole rule is dropped (never a false error).
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.w" name="Weapon" type="upgrade">
      <modifiers>
        <modifier type="add" value="Nope" field="error">
          <conditions>
            <condition type="atLeast" value="1" field="selections" scope="8da0-4570-c3c-819f" childId="e.w"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let w = ir.entries.iter().find(|e| e.id == "e.w").unwrap();
    assert!(w.validation_rules.is_empty(), "unmappable-gate rule must be dropped");
    assert!(diags.iter().any(|d| d.code == "modifier.error_condition_unmapped"), "{:?}", diags);
}

#[test]
fn drops_error_modifier_with_unsupported_type() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.w" name="Weapon" type="upgrade">
      <modifiers>
        <modifier type="set" value="Nope" field="error"/>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let w = ir.entries.iter().find(|e| e.id == "e.w").unwrap();
    assert!(w.validation_rules.is_empty());
    assert!(diags.iter().any(|d| d.code == "modifier.error_type_unsupported"), "{:?}", diags);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test -p engine-parser maps_error_modifier_to_validation_rule drops_error_modifier_with_unmappable_condition drops_error_modifier_with_unsupported_type`
Expected: compile failure — `IrEntry` has no `validation_rules` field yet. That is the expected red.

- [ ] **Step 3: Add the Rust structs**

In `packages/engine-parser/src/ir/model.rs`, add `validation_rules` to `IrEntry` (after `visibility_modifiers` at line 50):

```rust
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub validation_rules: Vec<IrValidationRule>,
```

And add a new struct near `IrVisibilityModifier` (after it, ~line 123):

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IrValidationRule {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<IrCondition>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_groups: Option<Vec<IrConditionGroup>>,
}
```

- [ ] **Step 4: Add `map_validation_rule` and the error branch**

In `packages/engine-parser/src/ir/map.rs`, add this fn next to `map_visibility_modifier` (mirror it exactly, message instead of set):

```rust
/// Map a `field="error"` `type="add"` modifier into a validation rule. Strict
/// all-or-nothing on conditions (like map_visibility_modifier): returns None if
/// any condition/condition-group is unmappable, so the caller drops the whole
/// rule — a validation error rejects the army, so a partially-represented gate
/// must never be enforced. The message is the raw string value.
fn map_validation_rule(m: &RawModifier, cat: &RawCatalogue) -> Option<IrValidationRule> {
    let mut sink = Vec::new();
    let mut conditions = Vec::new();
    for c in &m.conditions {
        conditions.push(map_condition(c, cat, &mut sink)?);
    }
    let mut condition_groups = Vec::new();
    for g in &m.condition_groups {
        condition_groups.push(map_condition_group_strict(g, cat)?);
    }
    Some(IrValidationRule {
        message: m.value_raw.clone(),
        conditions: if conditions.is_empty() { None } else { Some(conditions) },
        condition_groups: if condition_groups.is_empty() { None } else { Some(condition_groups) },
    })
}
```

In `map_entry`, declare the accumulator next to `visibility_modifiers` (line 84):

```rust
    let mut validation_rules: Vec<IrValidationRule> = Vec::new();
```

Add the branch inside the `for (index, m) in e.modifiers.iter().enumerate()` loop, immediately AFTER the `if m.field == "hidden" { … continue; }` block (before the cost-type/constraint branches):

```rust
        if m.field == "error" {
            if m.kind == "add" {
                match map_validation_rule(m, cat) {
                    Some(vr) => validation_rules.push(vr),
                    None => diags.push(Diagnostic {
                        code: "modifier.error_condition_unmapped".to_string(),
                        message: format!("error modifier on entry {} has an unmappable condition (dropped)", e.id),
                    }),
                }
            } else {
                diags.push(Diagnostic {
                    code: "modifier.error_type_unsupported".to_string(),
                    message: format!("error modifier on entry {} has unsupported type {} (dropped)", e.id, m.kind),
                });
            }
            continue;
        }
```

Add `validation_rules` to the `IrEntry { … }` constructor (after `visibility_modifiers`):

```rust
        validation_rules,
```

- [ ] **Step 5: Run the parser tests**

Run: `cargo test -p engine-parser`
Expected: all pass including the three new tests.

- [ ] **Step 6: Verify the golden IR is byte-identical**

Run: `cargo test -p engine-parser --test golden`
Expected: PASS (mini fixture has no error modifiers → `validation_rules` empty → skip-serialized).

- [ ] **Step 7: Clippy**

Run: `cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): map field=error modifiers to validation rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: engine-eval — emit an error issue when a validation rule's gate passes

**Files:**
- Create: `packages/engine-eval/src/validation.ts`
- Modify: `packages/engine-eval/src/evaluate.ts` (import + node loop)
- Test: `packages/engine-eval/test/validation.test.ts`

**Interfaces:**
- Consumes: `passesGate(conditions, conditionGroups, node, state, costOf?)` from `./conditions`; `EvalNode`, `EvalState` from `./state`; `Issue` from `@muster/domain`; `node.entry.validationRules`.
- Produces: `validationIssues(node: EvalNode, state: EvalState): Issue[]`. Wired into `evaluate()`'s existing `for (const node of state.all)` loop.

- [ ] **Step 1: Write the failing tests**

Create `packages/engine-eval/test/validation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// A weapon carrying a rule: invalid ("Max 1 Weapon per 5 models") when >=2 of it
// are taken in the unit (gate: atLeast 2 of e.w in self/subtree).
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [{
      id: "e.unit", name: "Squad", costs: [], categories: [], constraints: [], children: [
        {
          id: "e.w", name: "Weapon", costs: [], categories: [], constraints: [], children: [], groups: [],
          validationRules: [{
            message: "Max 1 {this} per 5 models",
            conditions: [{
              id: "cond.atLeast.e.w", comparator: "atLeast", value: 2,
              field: "selections", scope: "unit", targetType: "entry",
              targetId: "e.w", includeChildSelections: true,
            }],
          }],
        },
      ],
    }],
  } as unknown as IrCatalogue;
}

function roster(weaponCount: number): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: "e.unit", count: 1,
      selections: Array.from({ length: weaponCount }, (_, i) => ({ id: `w${i}`, entryId: "e.w", count: 1, selections: [] })),
    }],
  } as unknown as Roster;
}

describe("conditional validation rules (field=error)", () => {
  it("gate passes → error issue with {this} substituted, roster invalid", () => {
    const r = evaluate(roster(2), cat());
    const issue = r.issues.find((i) => i.code === "selection.invalid");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toBe("Max 1 Weapon per 5 models");
    expect(issue?.entryId).toBe("e.w");
    expect(r.valid).toBe(false);
  });

  it("gate fails → no issue", () => {
    const r = evaluate(roster(1), cat());
    expect(r.issues.some((i) => i.code === "selection.invalid")).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/engine-eval test -- validation.test.ts`
Expected: FAIL — no `selection.invalid` issue is produced (validation rules not evaluated yet).

- [ ] **Step 3: Create the engine module**

Create `packages/engine-eval/src/validation.ts`:

```ts
import type { Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { passesGate } from "./conditions";

// Designer-authored validation rules (BattleScribe field="error" modifiers):
// when a rule's gate passes on this node, the selection is invalid with the
// rule's message. `{this}` is replaced with the entry name. The gate is
// evaluated on the real node (real ancestor chain), mirroring nodeHiddenByState.
export function validationIssues(node: EvalNode, state: EvalState): Issue[] {
  const out: Issue[] = [];
  for (const rule of node.entry.validationRules ?? []) {
    if (passesGate(rule.conditions, rule.conditionGroups, node, state)) {
      out.push({
        severity: "error",
        code: "selection.invalid",
        message: rule.message.replaceAll("{this}", node.entry.name),
        selectionId: node.selectionId,
        entryId: node.entry.id,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Wire it into `evaluate()`**

In `packages/engine-eval/src/evaluate.ts`, add the import (next to the `nodeHiddenByState` import at line 8):

```ts
import { validationIssues } from "./validation";
```

Inside the existing `for (const node of state.all) { … }` loop, after the `nodeHiddenByState` block (which pushes `selection.hidden`), add:

```ts
    raw.push(...validationIssues(node, state));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @muster/engine-eval test -- validation.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full engine-eval suite**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all green (existing tests unaffected — entries without `validationRules` yield no issues).

- [ ] **Step 7: Commit**

```bash
git add packages/engine-eval/src/validation.ts packages/engine-eval/src/evaluate.ts packages/engine-eval/test/validation.test.ts
git commit -m "feat(engine-eval): emit selection.invalid for validation rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: cross-language contract — parser-shaped IR enforces a validation rule

**Files:**
- Test: `packages/engine-eval/test/parser-contract.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue` (Zod), `evaluate`. Catalogue written in the parser's exact serialized shape (camelCase `validationRules:[{message,conditions:[{...}]}]`), validated via `IrCatalogue.parse` — proving domain acceptance + engine enforcement.
- Produces: none (leaf test).

- [ ] **Step 1: Write the test**

Append a `describe` to `packages/engine-eval/test/parser-contract.test.ts` (it already imports `IrCatalogue`, `evaluate`, `Roster`):

```ts
describe("parser IR contract — validation rule", () => {
  // Mirrors the parser's serialized shape for a field="error" modifier turned
  // validation rule. Validated by Zod, then evaluated — proving parser output →
  // domain → engine enforcement.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [{
      id: "e.unit", name: "Squad", costs: [], categories: [], constraints: [],
      children: [{
        id: "e.w", name: "Weapon", type: "upgrade",
        costs: [], categories: [], constraints: [], children: [], groups: [],
        validationRules: [{
          message: "Max 1 {this} per 5 models",
          conditions: [{
            comparator: "atLeast", value: 2, field: "selections", scope: "unit",
            targetType: "entry", targetId: "e.w", includeChildSelections: true,
            id: "cond.atLeast.e.w",
          }],
        }],
      }],
    }],
  };

  const roster = (weaponCount: number): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: "e.unit", count: 1,
      selections: Array.from({ length: weaponCount }, (_, i) => ({ id: `w${i}`, entryId: "e.w", count: 1, selections: [] })),
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("emits the authored error only when the gate passes", () => {
    const cat = IrCatalogue.parse(shaped);
    const bad = evaluate(roster(2), cat);
    const issue = bad.issues.find((i) => i.code === "selection.invalid");
    expect(issue?.message).toBe("Max 1 Weapon per 5 models");
    expect(bad.valid).toBe(false);

    const ok = evaluate(roster(1), cat);
    expect(ok.issues.some((i) => i.code === "selection.invalid")).toBe(false);
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
git commit -m "test(engine-eval): cross-language contract for validation rules

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- domain `IrValidationRule` + `IrEntry.validationRules` → Task 1. ✓
- parser struct + `map_validation_rule` + error branch (add-only, strict) + type-unsupported drop → Task 2. ✓
- strict all-or-nothing (unmappable condition → drop whole rule) → Task 2 (`map_validation_rule` `?`-propagation) + `drops_error_modifier_with_unmappable_condition`. ✓
- engine-eval emits `selection.invalid` with `{this}` substitution → Task 3. ✓
- gate on real node → Task 3 (passes `node`). ✓
- golden byte-identical → Task 2 Step 6. ✓
- web unchanged (issues already render) → confirmed, no task needed. ✓
- cross-language contract → Task 4. ✓

**Type consistency:** `IrValidationRule` fields (`message`/`conditions`/`conditionGroups`) match across domain Zod (Task 1), Rust struct (Task 2, camelCase serde), and test literals (Tasks 3, 4). `validationIssues(node, state)` signature matches its call site. `passesGate(conditions, conditionGroups, node, state)` matches its definition. Rust `validation_rules` (snake) serializes to `validationRules` (camelCase via `rename_all`), matching the domain key.

**Placeholder scan:** none — every code step is complete.
