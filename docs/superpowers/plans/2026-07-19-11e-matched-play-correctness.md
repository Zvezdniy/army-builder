# 11e Matched-Play Correctness (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close the three confirmed matched-play POINTS/LEGALITY gaps in 11e `to_ir`: the missing army-wide "max 2 Enhancements" rule, mis-routed group-constraint modifiers, and dropped `divide`/`multiply` modifier kinds.

**Architecture:** Vertical slices across `@muster/domain` (schema = cross-language contract), engine-parser (`ir/map.rs`), `@muster/engine-eval`. Design detail lives in the spec: docs/superpowers/specs/2026-07-19-11e-matched-play-correctness-design.md — implementers READ IT FIRST.

**Tech Stack:** Rust (quick-xml/serde, `cargo test`), TypeScript strict + Vitest, Zod schema.

## Global Constraints

- The domain schema is the Rust↔TS contract. Any schema change must be mirrored in the Rust `model.rs`/`map.rs` output AND the TS types, and covered by the cross-language contract/golden.
- The 10e `mini40k` golden IR must NOT change (these are 11e constructs). If it changes, that's a regression — investigate, don't regenerate blindly.
- `@muster/engine-eval` keeps 100% coverage; robustness over cleverness — an unknown constraint field aggregates to 0 (inert), never throws.
- Faithful mapping: never emit a guessed value; drop-with-diagnostic when genuinely unmappable (existing convention).
- No push to origin. Merge to LOCAL main only.

---

### Task A1: Force-global cost-type constraint ("max 2 Enhancements")

**Files:**
- Modify: `packages/domain/src/ir.ts` (`IrConstraint.targetType`, `.field`)
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_force_constraints`, `map_constraint`)
- Modify: `packages/engine-parser/src/ir/model.rs` if `IrConstraint`'s `target_type`/`field` are typed enums there (keep as strings)
- Modify: `packages/engine-eval/src/scopes.ts` (`AggregateSpec.field`, `matchesTarget`, `aggregate`), `packages/engine-eval/src/cost.ts` (add `costOfType`)
- Test: `packages/engine-eval/src/constraints.test.ts` (or the nearest existing eval constraint test), `packages/engine-parser/tests/*` (force-constraint mapping), contract/golden

**Interfaces:**
- Produces: `IrConstraint.targetType` gains `"force"`; `IrConstraint.field` becomes `string` (values: `"selections"`, `"points"`, or a cost-type name). Eval sums a cost-type-named field over the scope; `targetType==="force"` matches every node.

- [ ] **Step 1 (eval TDD): failing test** — in the eval constraint test, build a synthetic IR state: 3 sibling selections each an entry with an `Enhancements` cost of 1 (and pts), plus a force constraint `{ type:"max", value:2, field:"Enhancements", scope:"force", targetType:"force" }`. Assert `evaluate()` (or `checkConstraint` at force level) reports NO issue at 2 enhancements and a `constraint.max` issue at 3. Add a second assertion that a `{ scope:"parent" }` force constraint is skipped at force level (returns null). Run: `pnpm --filter @muster/engine-eval test` → FAIL.
- [ ] **Step 2 (eval impl):** widen `AggregateSpec.field` to `string`; add `matchesTarget` `"force"` → `true`; in `aggregate`, when `field` is not `"selections"`/`"forces"`, use `costOfType(n, field)` where `field==="points"` maps to `nodePoints` and any other name sums `(costs.find(c=>c.name===field)?.value ?? 0) * effectiveCount`. Add `costOfType` to `cost.ts`. Run eval tests → PASS; keep 100% coverage.
- [ ] **Step 3 (domain):** `IrConstraint.targetType` → `z.enum(["category","entry","force"])`; `IrConstraint.field` → `z.string()` with a doc comment listing the allowed shapes. Run `pnpm --filter @muster/domain test` / typecheck.
- [ ] **Step 4 (parser TDD):** add/extend a Rust test (near the existing `map` tests or a `mini11e` fixture) with a forceEntry carrying a `max 2` constraint whose field is the `Enhancements` cost type id → assert the mapped `forceConstraints` contains `{ field:"Enhancements", scope:"force", target_type:"force", value:2 }` and NO `force_global_unrepresentable` diagnostic. Run `cargo test` → FAIL.
- [ ] **Step 5 (parser impl):** in `map_force_constraints`, map `force.constraints` via `map_constraint(c, "force", &force.id, cat, diags)` instead of dropping. In `map_constraint`, change the field else-branch: if `cat.cost_types` contains `rc.field`, emit `field = cost_types[rc.field].name` (its name) instead of `field_unmapped`; only a field that is neither `selections` nor a known cost type → `field_unmapped`. Run `cargo test` → PASS. Confirm the 10e `mini40k` golden is unchanged.
- [ ] **Step 6 (contract):** extend the cross-language contract fixture (`mini11e`) so the force Enhancements constraint round-trips parser→IR→eval; regenerate only the 11e golden if present. Run the full parser + eval suites.
- [ ] **Step 7: commit** — `git commit -m "feat(11e): force-global cost-type constraints (max 2 Enhancements)"`.

---

### Task A2: Route a modifier onto an owning group's constraint

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_entry` — reorder group mapping before the modifier loop; add group-constraint lookup in the target_unmapped else-branch)
- Verify/Modify: `packages/engine-eval/src/groups.ts` (that `IrGroupConstraint.modifiers` are applied; wire if missing)
- Test: `packages/engine-parser/tests/*` (modifier→group-constraint routing), eval group test if wiring changes

**Interfaces:**
- Consumes: `IrGroupConstraint.modifiers` (already in the schema). Produces: a modifier whose `field` names an enclosing group's constraint id is attached to that `IrGroupConstraint` instead of dropped as `target_unmapped`.

- [ ] **Step 1 (parser TDD): failing test** — a fixture entry with a group whose constraint has id `X`, and a modifier on the entry with `field == X` → assert after mapping, that group's `IrGroupConstraint` (id `X`) has the modifier in `.modifiers`, and NO `target_unmapped` diagnostic. `cargo test` → FAIL.
- [ ] **Step 2 (parser impl):** in `map_entry`, map the entry's groups (into the `groups` vec) BEFORE the modifier loop. In the modifier loop's final else (currently emits `target_unmapped`), first search `groups`' constraints for `id == m.field`; on hit push the mapped modifier onto that group constraint's `modifiers` and `continue`; else emit `target_unmapped`. Preserve existing ordering of children/profiles in the returned `IrEntry`. `cargo test` → PASS; `mini40k` golden unchanged.
- [ ] **Step 3 (eval):** confirm `groups.ts` applies `IrGroupConstraint.modifiers` via `effectiveConstraintValue`/`applyModifiers` when computing a group's effective min/max; if not, wire it and add a test (a group whose max is raised by a modifier admits the extra member). Run eval suite; keep 100% coverage.
- [ ] **Step 4: commit** — `git commit -m "feat(11e): route modifiers onto owning group constraints"`.

---

### Task A3: `divide` / `multiply` modifier kinds

**Files:**
- Modify: `packages/domain/src/ir.ts` (`IrModifier.type` enum), the Rust `model.rs` if the modifier kind is a typed enum there (keep string)
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_modifier` allow-list)
- Modify: `packages/engine-eval/src/modifiers.ts` (`applyModifiers` — implement divide/multiply)
- Test: eval `modifiers.test.ts`, parser modifier test

**Interfaces:**
- Produces: `IrModifier.type` gains `"divide"`, `"multiply"`; eval applies them.

- [ ] **Step 1 (eval TDD): failing test** — `applyModifiers(20, [{type:"divide", value:2, …}])` → 10; `multiply` ×N; a `divide` by 0 → no-op (returns the input, never NaN/Infinity); rounding for a non-even divide matches BattleScribe (integer, toward zero — confirm against existing increment/decrement rounding). `pnpm --filter @muster/engine-eval test` → FAIL.
- [ ] **Step 2 (eval impl):** implement `divide`/`multiply` in `applyModifiers`, guarding divide-by-zero. PASS; 100% coverage.
- [ ] **Step 3 (domain):** add `"divide"`, `"multiply"` to `IrModifier.type`. Typecheck.
- [ ] **Step 4 (parser):** extend `map_modifier`'s `matches!(m.kind, …)` allow-list to include `divide`/`multiply` (emit, not drop). Add a parser test that a `divide` modifier maps. `cargo test` → PASS; `mini40k` golden unchanged.
- [ ] **Step 5: commit** — `git commit -m "feat(11e): divide/multiply modifier kinds"`.

---

## Real-data verification (after all three tasks, not committed)

Repack SM 11e (`muster-parse "Imperium - Space Marines.json" "Warhammer 40,000.json"`) and via the real builder: (1) build a roster with 3 enhancements → `evaluate()` reports the "max 2 Enhancements" violation (was silently legal); (2) assert `force_global_unrepresentable` → 0 and the Enhancements constraint is present in `forceConstraints`; (3) spot-check a unit whose squad cap uses a group-constraint modifier (A2) and an enhancement whose cost divides on reuse (A3). Record numbers in the ledger.

## Self-Review notes

- Spec coverage: A1 = force cost-type constraint (spec §A1); A2 = group-constraint routing (§A2); A3 = divide/multiply (§A3). All three map to spec §Testing.
- Contract: every schema change (targetType, field, modifier type) is mirrored Rust↔TS and covered by the golden/contract; `mini40k` 10e golden must stay byte-identical.
