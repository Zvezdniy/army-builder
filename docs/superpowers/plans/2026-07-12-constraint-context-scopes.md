# constraint context-scopes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let constraints (limits) use the same context/type scopes conditions already support (`unit`/`upgrade`/`model`/`model-or-unit`/`root-entry`/`ancestor`), enforced without introducing spurious violations.

**Architecture:** Widen the domain `IrConstraint.scope` enum and the parser `map_constraint` scope mapping (the evaluator's `AggregateSpec`/`scopeNodes` already resolve these scopes). Add a never-over-enforce guard in `checkConstraint`: a type-scope constraint with no anchor node does not apply and is skipped, so a `min` can't fabricate a "not enough" error.

**Tech Stack:** Rust (quick-xml/serde) parser; TypeScript strict (`noUncheckedIndexedAccess`), Zod, Vitest. `@muster/engine-eval` requires 100% coverage (excl. `src/index.ts`).

## Global Constraints

- **Never over-enforce**: enabling constraint scopes must not create false violations. Guard applies ONLY to the anchor type scopes `{unit, upgrade, model, model-or-unit}`: when such a scope resolves to zero nodes (no matching ancestor), the constraint does not apply → skip. Do NOT guard self/parent/force/roster/root-entry/ancestor — their empty scope is legitimate (e.g. "min 1 HQ" on an empty roster must still error).
- The evaluator's `scopeNodes`/`aggregate` already handle all scopes — do NOT change resolution.
- Golden `mini40k.ir.json` byte-identical (fixture has no such constraint scopes).
- Domain `IrConstraint.scope` must become identical to `IrCondition.scope`: `["self","parent","force","roster","root-entry","ancestor","unit","upgrade","model","model-or-unit"]`.
- Parser diagnostic code stays `constraint.scope_unmapped` for genuinely unmappable scopes; `primary-catalogue` → `roster`.
- clippy clean (`assert!`, not `assert_eq!(x, true)`). TS: no non-null on index access.
- Commit messages/code/identifiers in English.

---

### Task 1: domain — widen `IrConstraint.scope`

**Files:**
- Modify: `packages/domain/src/ir.ts:17`
- Test: `packages/domain/test/ir.test.ts`

**Interfaces:**
- Produces: `IrConstraint.scope` accepts the 10 scope values. Consumed by parser output validation + engine-eval.

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/test/ir.test.ts`:

```typescript
import { IrConstraint } from "@muster/domain";

describe("IrConstraint.scope", () => {
  it("accepts context/type scopes", () => {
    for (const scope of ["unit", "upgrade", "model", "model-or-unit", "root-entry", "ancestor"] as const) {
      const parsed = IrConstraint.parse({ id: "k", type: "max", value: 1, field: "selections", scope, targetType: "entry", targetId: "e.x" });
      expect(parsed.scope).toBe(scope);
    }
  });
});
```

(If `IrConstraint` is already imported at the top of the file, don't duplicate the import.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/domain test`
Expected: FAIL — enum rejects `"unit"` etc.

- [ ] **Step 3: Widen the enum**

In `packages/domain/src/ir.ts` line 17, change:

```typescript
  scope: z.enum(["self", "parent", "force", "roster"]),
```

to:

```typescript
  scope: z.enum(["self", "parent", "force", "roster", "root-entry", "ancestor", "unit", "upgrade", "model", "model-or-unit"]),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @muster/domain test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): widen IrConstraint.scope to context/type scopes"
```

---

### Task 2: parser — widen `map_constraint` scope mapping

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs:261-270`
- Test: `packages/engine-parser/tests/map.rs` (update `constraint_root_entry_scope_still_dropped`, add new)

**Interfaces:**
- Consumes: nothing new.
- Produces: constraints with context/type scopes map through instead of dropping.

- [ ] **Step 1: Update the now-wrong test + add coverage**

In `packages/engine-parser/tests/map.rs`, REPLACE the test `constraint_root_entry_scope_still_dropped` (around line 676, including its `// Scope broadening is conditions-only...` comment) with:

```rust
#[test]
fn constraint_context_scopes_now_map() {
    // Constraints accept the same context/type scopes as conditions.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <constraints>
        <constraint id="k1" type="max" value="1" field="selections" scope="unit"/>
        <constraint id="k2" type="max" value="1" field="selections" scope="root-entry"/>
        <constraint id="k3" type="max" value="1" field="selections" scope="primary-catalogue"/>
      </constraints>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let scopes: Vec<&str> = e.constraints.iter().map(|c| c.scope.as_str()).collect();
    assert!(scopes.contains(&"unit"));
    assert!(scopes.contains(&"root-entry"));
    assert!(scopes.contains(&"roster")); // primary-catalogue -> roster
    assert!(!diags.iter().any(|d| d.code == "constraint.scope_unmapped"));
}

#[test]
fn constraint_unknown_scope_still_dropped() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <constraints><constraint id="k" type="max" value="1" field="selections" scope="bogus-scope"/></constraints>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    assert!(e.constraints.is_empty());
    assert!(diags.iter().any(|d| d.code == "constraint.scope_unmapped"));
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p engine-parser --test map`
Expected: FAIL — `constraint_context_scopes_now_map` fails (unit/root-entry currently dropped).

- [ ] **Step 3: Widen `map_constraint`'s scope match**

In `packages/engine-parser/src/ir/map.rs`, replace the `let scope = match rc.scope.as_str() { ... }` block (lines ~261-270) with:

```rust
    let scope = match rc.scope.as_str() {
        "parent" | "force" | "roster" | "self" => rc.scope.clone(),
        "root-entry" | "ancestor" | "unit" | "upgrade" | "model" | "model-or-unit" => rc.scope.clone(),
        "primary-catalogue" => "roster".to_string(),
        other => {
            diags.push(Diagnostic {
                code: "constraint.scope_unmapped".to_string(),
                message: format!("constraint {} has unmappable scope {}", rc.id, other),
            });
            return None;
        }
    };
```

- [ ] **Step 4: Run to verify pass + golden + clippy**

Run: `cargo test -p engine-parser && cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: all green (golden byte-identical — mini40k has no such constraint scopes), clippy clean.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): map_constraint accepts context/type scopes"
```

---

### Task 3: engine-eval — never-over-enforce guard

**Files:**
- Modify: `packages/engine-eval/src/scopes.ts` (export `scopeUnanchored`)
- Modify: `packages/engine-eval/src/constraints.ts` (guard in `checkConstraint`)
- Test: `packages/engine-eval/test/constraints.test.ts`

**Interfaces:**
- Consumes: private `scopeNodes` (same file for `scopeUnanchored`).
- Produces: `scopeUnanchored(node, spec, state): boolean`; `checkConstraint` skips unanchored type-scope constraints.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine-eval/test/constraints.test.ts`. Add a nested fixture: a unit `e.sqd` (type "unit") holding two `e.wpn` selections, plus a bare `e.wpn` at roster root with no unit ancestor.

```typescript
describe("checkConstraint context/type scopes", () => {
  const uCat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.sqd", name: "Squad", type: "unit", costs: [], categories: [], constraints: [], children: [] },
      { id: "e.wpn", name: "Weapon", costs: [], categories: ["cat.wpn"], constraints: [], children: [] },
    ],
  } as unknown as IrCatalogue;
  const uRoster: Roster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [
      { id: "sq", entryId: "e.sqd", count: 1, selections: [
        { id: "w1", entryId: "e.wpn", count: 1, selections: [] },
        { id: "w2", entryId: "e.wpn", count: 1, selections: [] },
      ] },
      { id: "loose", entryId: "e.wpn", count: 1, selections: [] }, // no unit ancestor
    ],
  } as unknown as Roster;
  const unitMax1: IrConstraint = { id: "k", type: "max", value: 1, field: "selections", scope: "unit", targetType: "category", targetId: "cat.wpn", includeChildSelections: true };

  it("enforces a unit-scoped max within the enclosing unit", () => {
    const state = buildState(uRoster, buildSymbolTable(uCat));
    const sq = state.all.find((n) => n.selectionId === "sq")!;
    const issue = checkConstraint(unitMax1, sq, state);
    expect(issue?.code).toBe("constraint.max"); // 2 weapons in the unit > max 1
  });

  it("skips a unit-scoped constraint on a node with no unit ancestor (no false violation)", () => {
    const state = buildState(uRoster, buildSymbolTable(uCat));
    const loose = state.all.find((n) => n.selectionId === "loose")!;
    // A unit-scope MIN on a node with no unit ancestor must not fabricate a violation.
    const unitMin1: IrConstraint = { ...unitMax1, type: "min", value: 1 };
    expect(checkConstraint(unitMin1, loose, state)).toBeNull();
  });

  it("still flags a min on a legitimate but unsatisfied scope (roster)", () => {
    const state = buildState(uRoster, buildSymbolTable(uCat));
    // roster scope is never guarded: min 1 of an absent category still errors.
    const rosterMin: IrConstraint = { id: "k2", type: "min", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.absent", includeChildSelections: false };
    expect(checkConstraint(rosterMin, null, state)?.code).toBe("constraint.min");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/engine-eval test constraints`
Expected: FAIL — `scopeUnanchored` undefined (import error) and/or the loose-node case throws or returns a spurious min.

- [ ] **Step 3: Add `scopeUnanchored` to `scopes.ts`**

In `packages/engine-eval/src/scopes.ts`, add near the top (after `AggregateSpec`) a set and, after `scopeNodes`, the exported guard:

```typescript
const ANCHOR_TYPE_SCOPES = new Set(["unit", "upgrade", "model", "model-or-unit"]);

// True only when a type scope (unit/upgrade/model/model-or-unit) resolves to no
// node — i.e. the owning node has no ancestor of that type, so the scope cannot be
// anchored and the spec does not apply here. Non-type scopes are never "unanchored"
// (their empty result is legitimate, e.g. a roster-wide min on an empty roster).
export function scopeUnanchored(node: EvalNode | null, spec: AggregateSpec, state: EvalState): boolean {
  if (!ANCHOR_TYPE_SCOPES.has(spec.scope)) return false;
  return scopeNodes(node, spec, state).length === 0;
}
```

(`EvalNode`/`EvalState` are already imported in scopes.ts.)

- [ ] **Step 4: Guard `checkConstraint`**

In `packages/engine-eval/src/constraints.ts`, import the guard:

```typescript
import { aggregate, scopeUnanchored } from "./scopes";
```

and add at the very start of `checkConstraint` (before `const actual = aggregate(...)`):

```typescript
  if (scopeUnanchored(node, constraint, state)) return null;
```

- [ ] **Step 5: Run to verify pass + full coverage**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all green AND 100% coverage (excl. src/index.ts). The three new tests cover: anchored enforce, unanchored skip (guard true branch), non-type scope (guard false branch). If the `ANCHOR_TYPE_SCOPES.has` false branch or the length check needs coverage, the existing force-scope tests already hit the false branch.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/scopes.ts packages/engine-eval/src/constraints.ts packages/engine-eval/test/constraints.test.ts
git commit -m "feat(engine-eval): enforce type-scope constraints with never-over-enforce guard"
```

---

### Task 4: full-suite verification

**Files:** none.

- [ ] **Step 1: Whole workspace**

Run: `pnpm turbo run test` (4/4 green, engine-eval 100%) and `cd packages/engine-parser && cargo test` (all green).

- [ ] **Step 2: (evidence) real-catalogue check**

If a scratchpad real catalogue is available, parse it and confirm `constraint.scope_unmapped` dropped from ~90 to ~0 and that `evaluate()` on a real unit with a unit-scoped weapon limit enforces it (or at least does not crash / mass-invalidate). Evidence for the final report, not a committed test.

---

## Self-Review

**Spec coverage:**
- Domain enum widened → Task 1. ✓
- Parser `map_constraint` widened + `primary-catalogue`→`roster` + unknown still dropped + updated the now-wrong root-entry-dropped test → Task 2. ✓
- Guard `scopeUnanchored` (type scopes only) + `checkConstraint` skip → Task 3. ✓
- Never-over-enforce (guard limited to anchor type scopes; force/roster min still errors) → Task 3 tests. ✓
- Golden byte-identical → Task 2 Step 4. ✓
- Real evidence → Task 4. ✓

**Placeholder scan:** No TBD/TODO; all code steps concrete. ✓

**Type consistency:** `IrConstraint.scope` (domain, 10 values) ⊇ parser-emitted strings ⊆ `AggregateSpec.scope` (engine, 10 values) — all three aligned. `scopeUnanchored(node, spec, state): boolean` matches its one call site in `checkConstraint`. `ANCHOR_TYPE_SCOPES` members are a subset of the scope union. ✓
