# IrEntry.type + type-based condition scopes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread the BattleScribe entry `type` (`unit`/`upgrade`/`model`) through raw→IR→domain and resolve four type-based condition scopes (`unit`, `upgrade`, `model`, `model-or-unit`) in the evaluator, plus a minimal web badge.

**Architecture:** `RawEntry.entry_type` already exists in the parser's raw layer; we carry it into `IrEntry` (Rust IR + domain Zod), then let the evaluator resolve type-based scopes by walking a node's ancestor chain (self-inclusive) to the nearest node of the required type and aggregating its subtree. Web reads `entry.type` for a display-only badge.

**Tech Stack:** Rust (quick-xml/serde) parser, TypeScript strict (`noUncheckedIndexedAccess`) domain + engine-eval, Zod, Vitest, React 18 (Vite, jsdom), pnpm + Turborepo.

## Global Constraints

- Design principle #1: **never miscompile / never over-hide** — unknown/missing type must leave an entry valid and visible; a type-scope with no matching ancestor yields an empty set, never an exception in the visibility path.
- Parser: `#![forbid(unsafe_code)]`; clippy clean (no `assert_eq!(x, true)` — use `assert!`; prefer `!map.contains_key(k)` over `.get(k).is_none()`).
- TS: strict mode, `noUncheckedIndexedAccess` — no non-null assertions on index access.
- Scope broadening is **conditions-only**: `map_constraint` stays on `self`/`parent`/`force`/`roster`. Do NOT touch constraint scope handling.
- Entry `type` values in scope: exactly `"unit"`, `"upgrade"`, `"model"`. Any other/empty → `None`/`undefined` + diagnostic `entry.type_unmapped`.
- The four new condition scopes: `"unit"`, `"upgrade"`, `"model"`, `"model-or-unit"`.
- Commit messages, code, identifiers in English.

---

### Task 1: domain — `IrEntry.type` + four condition scopes

**Files:**
- Modify: `packages/domain/src/ir.ts` (IrEntry interface + lazy schema)
- Modify: `packages/domain/src/conditions.ts:15` (scope enum)
- Test: `packages/domain/test/ir.test.ts` (add cases; create if absent)
- Test: `packages/domain/test/conditions.test.ts:54` (extend scope acceptance)

**Interfaces:**
- Produces: `IrEntry.type?: "unit" | "upgrade" | "model"` (optional). `IrCondition.scope` now includes `"unit" | "upgrade" | "model" | "model-or-unit"`. Consumed by engine-eval (Task 3) and web (Task 4).

- [ ] **Step 1: Write the failing domain tests**

In `packages/domain/test/conditions.test.ts`, add inside the existing `describe("IrConditionGroup", ...)` block (or a new `describe`), mirroring the existing `accepts root-entry and ancestor scopes` test:

```typescript
it("accepts type-based scopes unit/upgrade/model/model-or-unit", () => {
  for (const scope of ["unit", "upgrade", "model", "model-or-unit"] as const) {
    const c = IrCondition.parse({ id: "c", comparator: "atLeast", value: 1, field: "selections", scope, targetType: "entry", targetId: "e.x" });
    expect(c.scope).toBe(scope);
  }
});
```

In `packages/domain/test/ir.test.ts` (create the file if it does not exist; it must `import { describe, it, expect } from "vitest"` and `import { IrEntry } from "@muster/domain"`), add:

```typescript
import { describe, it, expect } from "vitest";
import { IrEntry } from "@muster/domain";

describe("IrEntry.type", () => {
  it("round-trips each known type value", () => {
    for (const t of ["unit", "upgrade", "model"] as const) {
      const e = IrEntry.parse({ id: "e", name: "E", type: t });
      expect(e.type).toBe(t);
    }
  });

  it("defaults to undefined when type is absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.type).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/domain test`
Expected: FAIL — `conditions.test.ts` rejects `"unit"` etc. (invalid enum value); `ir.test.ts` either fails to find `type` or the file is new and `type` is not in the schema.

- [ ] **Step 3: Extend the condition scope enum**

In `packages/domain/src/conditions.ts`, change line 15 from:

```typescript
  scope: z.enum(["self", "parent", "force", "roster", "root-entry", "ancestor"]),
```

to:

```typescript
  scope: z.enum(["self", "parent", "force", "roster", "root-entry", "ancestor", "unit", "upgrade", "model", "model-or-unit"]),
```

- [ ] **Step 4: Add `type` to IrEntry**

In `packages/domain/src/ir.ts`, add to the `IrEntry` interface (after `name: string;`, line 58):

```typescript
  type?: "unit" | "upgrade" | "model";
```

And in the lazy Zod schema object (after `name: z.string(),`, line 73):

```typescript
    type: z.enum(["unit", "upgrade", "model"]).optional(),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @muster/domain test`
Expected: PASS (all domain tests, including new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/src/conditions.ts packages/domain/test/ir.test.ts packages/domain/test/conditions.test.ts
git commit -m "feat(domain): IrEntry.type + type-based condition scopes"
```

---

### Task 2: parser — emit `IrEntry.type` + map four type scopes + regen golden

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs:26-45` (IrEntry struct)
- Modify: `packages/engine-parser/src/ir/map.rs:54-121` (map_entry) and `:296-309` (map_condition_scope)
- Modify: `packages/engine-parser/tests/fixtures/golden/mini40k.ir.json` (regenerate)
- Test: `packages/engine-parser/tests/map.rs` (append new tests)

**Interfaces:**
- Consumes: `RawEntry.entry_type: String` (already exists, `raw/model.rs:24`).
- Produces: IR JSON entries carry `"type"` (omitted when unknown); conditions with the four scopes map through instead of dropping.

- [ ] **Step 1: Write the failing parser tests**

Append to `packages/engine-parser/tests/map.rs` (follow the existing `to_ir(&resolve(parse_raw(xml).unwrap()).unwrap())` pattern):

```rust
#[test]
fn emits_entry_type_for_known_values() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.unit" name="U" type="unit"/>
    <selectionEntry id="e.up" name="G" type="upgrade"/>
    <selectionEntry id="e.mo" name="M" type="model"/>
  </selectionEntries>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let ty = |id: &str| ir.entries.iter().find(|e| e.id == id).unwrap().entry_type.clone();
    assert_eq!(ty("e.unit"), Some("unit".to_string()));
    assert_eq!(ty("e.up"), Some("upgrade".to_string()));
    assert_eq!(ty("e.mo"), Some("model".to_string()));
}

#[test]
fn unknown_entry_type_is_omitted_and_diagnosed() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.weird" name="W" type="squad"/>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.weird").unwrap();
    assert!(e.entry_type.is_none());
    assert!(diags.iter().any(|d| d.code == "entry.type_unmapped"));
}

#[test]
fn cost_modifier_condition_type_scopes_map() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <costTypes><costType id="pts" name="Points"/></costTypes>
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="upgrade">
      <costs><cost name="Points" typeId="pts" value="5"/></costs>
      <modifiers>
        <modifier type="increment" field="pts" value="3">
          <conditions>
            <condition type="atLeast" value="1" field="selections" scope="unit" childId="cat.a"/>
            <condition type="atLeast" value="1" field="selections" scope="upgrade" childId="cat.b"/>
            <condition type="atLeast" value="1" field="selections" scope="model" childId="cat.c"/>
            <condition type="atLeast" value="1" field="selections" scope="model-or-unit" childId="cat.d"/>
          </conditions>
        </modifier>
      </modifiers>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let m = e.costs.iter().find(|c| c.name == "points").unwrap().modifiers.as_ref().unwrap();
    let scopes: Vec<&str> = m[0].conditions.as_ref().unwrap().iter().map(|c| c.scope.as_str()).collect();
    assert_eq!(scopes, vec!["unit", "upgrade", "model", "model-or-unit"]);
    assert!(!diags.iter().any(|d| d.code == "condition.scope_unmapped"));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p engine-parser --test map`
Expected: FAIL — `entry_type` field does not exist on IrEntry; the scope test drops the four conditions (`condition.scope_unmapped`).

- [ ] **Step 3: Add the `entry_type` field to the IR struct**

In `packages/engine-parser/src/ir/model.rs`, inside `pub struct IrEntry`, add after `pub name: String,` (line 28):

```rust
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub entry_type: Option<String>,
```

- [ ] **Step 4: Map the type and broaden condition scopes**

In `packages/engine-parser/src/ir/map.rs`, add this helper just above `fn map_entry` (line 54):

```rust
/// Normalize a raw selectionEntry `type` into the three IR-known values.
/// Unknown/empty → None + diagnostic (the entry is still emitted, just
/// without a type — a type-scope simply won't match it, which is safe).
fn map_entry_type(raw: &str, entry_id: &str, diags: &mut Vec<Diagnostic>) -> Option<String> {
    match raw {
        "unit" | "upgrade" | "model" => Some(raw.to_string()),
        other => {
            diags.push(Diagnostic {
                code: "entry.type_unmapped".to_string(),
                message: format!("entry {} has unmappable type {:?}", entry_id, other),
            });
            None
        }
    }
}
```

Then in the `IrEntry { ... }` literal returned by `map_entry` (line 109), add after `name: e.name.clone(),`:

```rust
        entry_type: map_entry_type(&e.entry_type, &e.id, diags),
```

And in `fn map_condition_scope` (line 297), extend the first match arm to include the four type scopes:

```rust
        "self" | "parent" | "force" | "roster" => Some(scope.to_string()),
        "root-entry" | "ancestor" => Some(scope.to_string()),
        "unit" | "upgrade" | "model" | "model-or-unit" => Some(scope.to_string()),
        "primary-catalogue" => Some("roster".to_string()),
```

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `cargo test -p engine-parser --test map`
Expected: the three new tests PASS. The golden test (`tests/golden.rs` or similar) will now FAIL because every fixture entry gained a `type` — that is fixed in Step 6.

- [ ] **Step 6: Regenerate the golden fixture**

Run: `cargo run -p engine-parser --bin muster-parse packages/engine-parser/tests/fixtures/mini40k.cat > packages/engine-parser/tests/fixtures/golden/mini40k.ir.json`

(If the binary prints diagnostics to stderr, only stdout is redirected — verify the file is valid JSON and the diff shows only added `"type"` keys.)

Then inspect: `git diff --stat packages/engine-parser/tests/fixtures/golden/mini40k.ir.json` and confirm the diff contains only added `"type": "..."` lines (no other structural change).

- [ ] **Step 7: Run the full parser suite + clippy**

Run: `cargo test -p engine-parser && cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: all tests PASS, clippy clean.

- [ ] **Step 8: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs packages/engine-parser/tests/fixtures/golden/mini40k.ir.json
git commit -m "feat(parser): emit IrEntry.type + map unit/upgrade/model/model-or-unit condition scopes"
```

---

### Task 3: engine-eval — resolve four type-based scopes

**Files:**
- Modify: `packages/engine-eval/src/scopes.ts:5-58` (AggregateSpec.scope + scopeNodes)
- Modify: `packages/engine-eval/src/visibility.ts:8` (CONTEXT_SCOPES)
- Test: `packages/engine-eval/test/scopes.test.ts`
- Test: `packages/engine-eval/test/visibility.test.ts`

**Interfaces:**
- Consumes: `IrEntry.type?` (Task 1), `EvalNode.entry.type`, existing `subtree(node, includeChildren)`, `EvalNode { entry, parent, children, categories, effectiveCount, ... }` (`state.ts`).
- Produces: `aggregate()`/`scopeNodes()` handle the four new scopes; `hiddenEntryIds` skips them without an owner.

- [ ] **Step 1: Write the failing engine-eval tests**

In `packages/engine-eval/test/scopes.test.ts`, add tests that build a small node tree and call `aggregate`. Match the file's existing construction style; if it builds nodes via `buildState(roster, symbols)`, reuse that. The following uses the public `aggregate` with hand-built `EvalNode`s — adapt imports to the file's existing pattern (the key assertions are what matter):

```typescript
import { describe, it, expect } from "vitest";
import { aggregate } from "../src/scopes";
import type { EvalNode, EvalState } from "../src/state";

function node(id: string, type: string | undefined, children: EvalNode[] = []): EvalNode {
  const n: EvalNode = {
    selectionId: `sel:${id}`,
    entry: { id, name: id, costs: [], categories: [], constraints: [], children: [], type } as any,
    count: 1,
    multiplier: 1,
    effectiveCount: 1,
    categories: [id],
    parent: null,
    children,
  };
  for (const c of children) c.parent = n;
  return n;
}

describe("type-based scopes", () => {
  it("unit scope aggregates the nearest unit ancestor's subtree", () => {
    const target = node("cat.x", "model");
    const unit = node("u", "unit", [node("mid", "upgrade", [target])]);
    // deepest node is the target's owner chain leaf:
    const leaf = unit.children[0]!.children[0]!;
    const state: EvalState = { all: [unit] } as EvalState;
    const spec = { id: "s", field: "selections" as const, scope: "unit" as const, targetType: "entry" as const, targetId: "cat.x", includeChildSelections: true };
    expect(aggregate(leaf, spec, state)).toBe(1);
  });

  it("self-matches when the node itself is the required type", () => {
    const unit = node("u", "unit");
    const state: EvalState = { all: [unit] } as EvalState;
    const spec = { id: "s", field: "selections" as const, scope: "unit" as const, targetType: "entry" as const, targetId: "u", includeChildSelections: false };
    expect(aggregate(unit, spec, state)).toBe(1);
  });

  it("model-or-unit matches a model ancestor", () => {
    const model = node("m", "model", [node("g", "upgrade", [node("cat.y", "upgrade")])]);
    const leaf = model.children[0]!.children[0]!;
    const state: EvalState = { all: [model] } as EvalState;
    const spec = { id: "s", field: "selections" as const, scope: "model-or-unit" as const, targetType: "entry" as const, targetId: "cat.y", includeChildSelections: true };
    expect(aggregate(leaf, spec, state)).toBe(1);
  });

  it("returns 0 when no ancestor of the required type exists", () => {
    const leaf = node("g", "upgrade", [node("cat.z", "upgrade")]).children[0]!;
    const state: EvalState = { all: [] } as EvalState;
    const spec = { id: "s", field: "selections" as const, scope: "unit" as const, targetType: "entry" as const, targetId: "cat.z", includeChildSelections: true };
    expect(aggregate(leaf, spec, state)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @muster/engine-eval test scopes`
Expected: FAIL — `scope: "unit"` etc. are not assignable / `scopeNodes` has no branch and returns `undefined` (TypeScript may also error on the union).

- [ ] **Step 3: Widen the scope union and add the resolver**

In `packages/engine-eval/src/scopes.ts`, change the `AggregateSpec.scope` type (line 8) to:

```typescript
  scope:
    | "self" | "parent" | "force" | "roster" | "root-entry" | "ancestor"
    | "unit" | "upgrade" | "model" | "model-or-unit";
```

Add this helper above `function scopeNodes` (line 25):

```typescript
// Walk from `node` up its parent chain, INCLUDING `node` itself, returning the
// first node whose entry type satisfies `pred`. Null when none matches.
function nearestByType(node: EvalNode, pred: (t: string | undefined) => boolean): EvalNode | null {
  for (let n: EvalNode | null = node; n; n = n.parent) {
    if (pred(n.entry.type)) return n;
  }
  return null;
}
```

Add these cases inside the `switch (spec.scope)` in `scopeNodes`, after the `ancestor` case (line 56), before the closing brace:

```typescript
    case "unit":
    case "upgrade":
    case "model":
    case "model-or-unit": {
      if (!node) return [];
      const pred =
        spec.scope === "model-or-unit"
          ? (t: string | undefined) => t === "model" || t === "unit"
          : (t: string | undefined) => t === spec.scope;
      const anchor = nearestByType(node, pred);
      return anchor ? subtree(anchor, spec.includeChildSelections) : [];
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @muster/engine-eval test scopes`
Expected: PASS.

- [ ] **Step 5: Write the failing visibility test**

In `packages/engine-eval/test/visibility.test.ts`, add a test that an entry hidden by a type-scoped gate is NOT hidden when computed without an owner (mirror the existing no-owner context-scope tests — reuse this file's roster/catalogue builders). The assertion that matters:

```typescript
it("skips a type-scoped hidden gate when there is no owner (never over-hide)", () => {
  // catalogue: entry `opt` hidden when notInstanceOf <cat> in scope=upgrade.
  const catalogue = makeCatalogue([
    entry("opt", { visibilityModifiers: [
      { set: true, conditions: [
        { id: "c", comparator: "lessThan", value: 1, field: "selections", scope: "upgrade", targetType: "category", targetId: "cat.x", includeChildSelections: false },
      ] },
    ] }),
  ]);
  const roster = emptyRoster(catalogue);
  // no ownerSelectionId → context scope, must be skipped → not hidden
  expect(hiddenEntryIds(roster, catalogue).has("opt")).toBe(false);
});
```

Use whatever `makeCatalogue`/`entry`/`emptyRoster` helpers already exist in this test file; if none exist, construct the `IrCatalogue`/`Roster` inline the same way the other tests in the file do.

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @muster/engine-eval test visibility`
Expected: FAIL — `"upgrade"` is not yet a context scope, so the gate is evaluated on the ownerless synthetic node instead of being skipped (entry wrongly hidden, or a scope error).

- [ ] **Step 7: Add the four scopes to CONTEXT_SCOPES**

In `packages/engine-eval/src/visibility.ts`, change line 8 from:

```typescript
const CONTEXT_SCOPES = new Set(["parent", "root-entry", "ancestor"]);
```

to:

```typescript
const CONTEXT_SCOPES = new Set(["parent", "root-entry", "ancestor", "unit", "upgrade", "model", "model-or-unit"]);
```

- [ ] **Step 8: Run the full engine-eval suite (coverage gate)**

Run: `pnpm --filter @muster/engine-eval test`
Expected: PASS, and coverage remains 100% (excluding `src/index.ts`). If the new `scopeNodes` branches or `nearestByType` show uncovered lines, add a targeted assertion to `scopes.test.ts` (e.g. the `upgrade` and `model` single-type branches are exercised by the tests above; ensure at least one asserts an `upgrade` self-match too).

- [ ] **Step 9: Commit**

```bash
git add packages/engine-eval/src/scopes.ts packages/engine-eval/src/visibility.ts packages/engine-eval/test/scopes.test.ts packages/engine-eval/test/visibility.test.ts
git commit -m "feat(engine-eval): resolve unit/upgrade/model/model-or-unit type scopes"
```

---

### Task 4: web — entry type badge

**Files:**
- Modify: `apps/web/src/components/UnitConfig.tsx` (self-row badge)
- Modify: `apps/web/src/index.css` or the existing stylesheet (add `.uc-type` rule) — locate the file that defines `.uc-selfrow`
- Test: `apps/web/test/UnitConfig.test.tsx` (add/extend; create if absent)

**Interfaces:**
- Consumes: `entry.type` from `catalogueEntry(catalogue, selection.entryId)` (already computed in `UnitConfig.tsx` as `const entry = ...`).
- Produces: a display-only badge; no state, no evaluator interaction.

- [ ] **Step 1: Write the failing web test**

In `apps/web/test/UnitConfig.test.tsx` (create if absent; use the render/roster helpers the other web tests in `apps/web/test/` use — import `render`, `screen` from `@testing-library/react`), add a test that a unit-typed entry renders a badge with its type text and an untyped entry renders none:

```typescript
it("shows the entry type as a badge", () => {
  // Build a catalogue whose root entry `u` has type "unit", add it to a roster,
  // render UnitConfig for that selection using the same setup as the other tests.
  renderUnitConfigFor("u"); // helper analogous to existing tests
  expect(screen.getByText("unit")).toBeInTheDocument();
});
```

Adapt to the file's actual harness (reuse existing catalogue/roster fixtures; give a fixture entry `type: "unit"`). The essential behavior: when `entry.type` is defined, its value appears in the DOM.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web test UnitConfig`
Expected: FAIL — no element with the type text.

- [ ] **Step 3: Render the badge**

In `apps/web/src/components/UnitConfig.tsx`, inside the `uc-selfrow` block (the `{hasSelf && ( ... )}` region around line 47), add the badge next to the existing controls, e.g. immediately after the opening `<div className="uc-selfrow">`:

```tsx
{entry?.type && <span className="uc-type">{entry.type}</span>}
```

- [ ] **Step 4: Add a minimal style**

In the stylesheet that defines `.uc-selfrow` (find with `rg -l "uc-selfrow" apps/web/src`), add:

```css
.uc-type {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.6;
  padding: 0.1em 0.4em;
  border: 1px solid currentColor;
  border-radius: 4px;
}
```

- [ ] **Step 5: Run the web tests to verify they pass**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/UnitConfig.tsx apps/web/test/UnitConfig.test.tsx apps/web/src
git commit -m "feat(web): show entry type badge in unit config"
```

---

### Task 5: full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole workspace**

Run: `pnpm turbo run test lint typecheck build` (or the repo's equivalent — check `package.json` scripts / `turbo.json`)
Expected: all packages green. If a cross-language contract test parses real/fixture IR through the domain schema, confirm it still passes (the domain `type` field is optional, so pre-existing IR without `type` still validates).

- [ ] **Step 2: (evidence) real-catalogue diagnostic check**

If a scratchpad real catalogue is available, parse it and confirm `condition.scope_unmapped` dropped by ~270 (unit 8 + upgrade 79 + model 129 + model-or-unit 54) and that `entry.type_unmapped` count is small/zero. This is evidence for the final report, not a committed test.

---

## Self-Review

**Spec coverage:**
- Domain `IrEntry.type` + four scopes → Task 1. ✓
- Parser emit type + `map_entry_type` + `entry.type_unmapped` + `map_condition_scope` four keywords + golden regen → Task 2. ✓
- engine-eval `nearestByType` (self-inclusive) + four `scopeNodes` branches + `AggregateSpec.scope` + `CONTEXT_SCOPES` → Task 3. ✓
- Web badge → Task 4. ✓
- Never-miscompile (unknown type omitted, entry kept) → Task 2 Step 4; never-over-hide (no-owner skip) → Task 3 Steps 5–7. ✓
- Constraints untouched → not modified in any task; Global Constraints call it out. ✓
- Real-SM evidence → Task 5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code. Web/eval test helpers are described as "reuse existing harness" because the exact fixtures are file-local — the required assertions are given explicitly. ✓

**Type consistency:** `entry_type: Option<String>` (Rust) ↔ `type?: "unit"|"upgrade"|"model"` (domain) ↔ `spec.scope` union in `scopes.ts` matches the domain `IrCondition.scope` additions and the parser's passed-through strings. `nearestByType` signature is used identically in the single call site. `CONTEXT_SCOPES` string members match the four scope literals. ✓
