# 11e Matched-Play Correctness (Sub-project A) — Design

**Date:** 2026-07-19
**Status:** Approved (design; mechanics decided autonomously per project workflow)
**Scope:** engine-parser (`ir/map.rs`), `@muster/domain` (`ir.ts`), `@muster/engine-eval`
(`scopes.ts`/`cost.ts`/`modifiers.ts`) + the cross-language contract. Close the small,
confirmed matched-play POINTS + LEGALITY gaps in 11e `to_ir`. Datasheet DISPLAY richness
(dynamic statlines) is a SEPARATE sub-project B, not covered here.

## Background (from the 11e drop-scoping investigation)

`docs`-adjacent finding: of ~80,502 `to_ir` drops across four real 11e factions, only
**~615 (<1%)** touch matched-play POINTS or LEGALITY; the rest is DISPLAY (statline
characteristic modifiers — no IR channel) or NARRATIVE (Crusade). Base points and
squad-size cost breakpoints are already correct (verified: Intercessors 80→150 etc.). The
confirmed matched-play gaps are three:

1. **The army-wide "max 2 Enhancements" rule is absent.** The 11e gamesystem `Army Roster`
   force entry carries constraint `606d-06be-c4b4-f877`: `max 2`, `scope=force`, on the
   `Enhancements` cost type (`f759-1bc4-cb3a-f0d2`). `map_force_constraints` drops every
   constraint placed directly on a forceEntry (`constraint.force_global_unrepresentable`)
   because the IR has no whole-force constraint target. Nothing currently stops a
   matched-play roster taking 3+ enhancements. VERIFIED: 172 SM enhancement entries each
   carry an `Enhancements` cost of 1 (plus pts); enhancement-eligible units carry an
   `Enhancements` cost of 0. So "max 2 Enhancements" == sum of the `Enhancements` cost type
   across the force ≤ 2.
2. **Group-constraint modifiers are mis-routed.** `map_entry` routes a modifier's `field`
   to a cost type or the entry's OWN constraints; a modifier targeting a constraint owned
   by an enclosing `selectionEntryGroup` (an `IrGroupConstraint`) is dropped as
   `modifier.target_unmapped`. ~91 genuine cross-entry/group `selections`-limit modifiers
   (dynamic squad-size / option caps) are lost this way. The constraint already exists in
   the IR as an `IrGroupConstraint` (with a `modifiers` slot); the modifier just isn't
   matched against it.
3. **`divide` (and `multiply`) modifier kinds are dropped.** `map_modifier` supports only
   `set`/`increment`/`decrement`; ~400 `divide`-on-`Enhancements` points modifiers (an
   enhancement's cost is halved/thirded when the same enhancement is taken 2+/3+ times in a
   multi-detachment roster) drop as `value_type_unsupported`. Narrow (3+-detachment reuse)
   but the only matched-play POINTS gap.

The other codes (`constraint.field_unmapped` 100% Crusade; most `hidden_condition_unmapped`
Crusade; the statline `target_unmapped` bulk) are DISPLAY/NARRATIVE and explicitly out of
scope here.

## Design

### A1 — Force-global cost-type constraint (the "max 2 Enhancements" rule)

**Domain (`ir.ts`, `IrConstraint`):**
- `targetType`: add `"force"` → `z.enum(["category", "entry", "force"])`. A force-target
  constraint sums over the whole force (every node), with no category/entry filter.
- `field`: widen from `z.enum(["selections", "points"])` to `z.string()`, documented as:
  `"selections"`, `"points"`, or a **cost-type name** (e.g. `"Enhancements"`). Keeps the
  two known values working; any other value means "sum the cost type of this name". (The
  eval `AggregateSpec.field` already carries a third value `"forces"` beyond the domain
  enum, so widening to a string is consistent with the existing seam.)

**Parser (`ir/map.rs`):**
- `map_force_constraints`: replace the unconditional drop of `force.constraints` with
  `map_constraint(c, "force", &force.id, cat, diags)` (push the mapped ones). No
  special-casing of the inert siblings is needed: the `pts max 0` and `Detachment Points
  max 2` force constraints are `scope=parent`, which `checkConstraint` already skips at
  force level (`node === null && scope ∉ {force, roster}` → returns null); only the
  `scope=force` Enhancements constraint actually enforces.
- `map_constraint`: generalize the field mapping. Currently: `selections`→`selections`; a
  cost type whose name contains "point"→`points`; else `field_unmapped` (dropped). Change
  the else branch: if `rc.field` resolves to a KNOWN cost type (present in
  `cat.cost_types`), emit `field = <that cost type's name>` (so `f759`→`"Enhancements"`)
  instead of dropping. Only a field that is neither `selections` nor any known cost type →
  `field_unmapped`. This also fixes the 1,008 Crusade `field_unmapped` drops as a
  side effect (they become real cost-type constraints, harmlessly inert in matched play
  since no Crusade cost accrues) — acceptable and faithful.

**Eval (`scopes.ts`, `cost.ts`):**
- `AggregateSpec.field`: widen to `string` (was `"selections" | "points" | "forces"`).
- `matchesTarget`: add the `"force"` case → returns `true` for every node (whole-force
  sum), so `aggregate` sums across `scopeNodes` (which for `scope=force` is `state.all`).
- `aggregate`: the non-`selections`, non-`forces` branch currently sums `costOf(n)`
  (points). Generalize: when `field` is `"points"` use `nodePoints`; when `field` is any
  other cost-type name, sum that cost type via a new `costOfType(node, field)` =
  `(node.entry.costs.find(c => c.name === field)?.value ?? 0) * node.effectiveCount`. Add
  `costOfType` to `cost.ts`.
- Net: a `{ type: max, value: 2, field: "Enhancements", scope: "force", targetType:
  "force" }` constraint sums the `Enhancements` cost across the roster and flags a 3rd
  enhancement as `constraint.max`.

### A2 — Route a modifier onto an owning group's constraint

**Parser (`ir/map.rs`, `map_entry`):**
- Map the entry's groups BEFORE the modifier loop (they are currently mapped after it).
- In the modifier loop's final else branch (the one that emits `target_unmapped` when the
  field matches no cost type and no entry-own constraint), first search the mapped groups'
  `IrGroupConstraint`s for one whose `id == m.field`; on a hit, push the mapped modifier
  onto that group constraint's `modifiers` and continue; only if that also misses →
  `target_unmapped`.
- `IrGroupConstraint` already has a `modifiers` slot (`ir.ts`); eval already applies group
  constraint modifiers (verify in `groups.ts` — if not, wire it in, mirroring how entry
  constraint modifiers are applied via `effectiveConstraintValue`).

### A3 — `divide` / `multiply` modifier kinds

**Domain (`ir.ts`, `IrModifier`):** add `"divide"` and `"multiply"` to the `type` enum.
**Parser (`map_modifier`):** accept `divide`/`multiply` (extend the `matches!` allow-list)
so they are emitted, not dropped.
**Eval (`modifiers.ts`, `applyModifiers`):** implement `divide` and `multiply`. BattleScribe
`divide` uses integer division rounding toward zero on cost values (confirm against the
`set`/`increment`/`decrement` code's rounding conventions; enhancement costs are integers).
Guard divide-by-zero (a 0 modifier value → no-op, never NaN/Infinity).

## Cross-language contract

The domain schema is the contract between the Rust parser output and the TS engine. The
existing contract test (packed-v1 golden / the `mini11e` fixtures) must be extended so a
force-scoped Enhancements constraint and a group-constraint modifier round-trip parser→IR→
eval. Regenerate any golden that legitimately changes; the 10e `mini40k` golden must NOT
change (these constructs don't appear in it) — if it does, that's a regression.

## Testing

- **A1 unit (eval):** a synthetic IR with two enhancement selections (Enhancements cost 1
  each) + a `force`/`Enhancements` `max 2` constraint → legal; a third → `constraint.max`
  issue. Also assert the inert `scope=parent` force constraints are skipped at force level.
- **A1 parser:** a `mini11e`-style fixture with a forceEntry `max 2` Enhancements constraint
  → mapped to `{ field: "Enhancements", scope: "force", targetType: "force" }`, not dropped.
- **A2 parser:** a fixture entry with a modifier whose field is an enclosing group's
  constraint id → the modifier lands on that `IrGroupConstraint`, not `target_unmapped`.
- **A3:** `divide`/`multiply` modifiers map (parser) and apply (eval), with divide-by-zero
  guarded.
- **Real-data verification (not committed):** repack SM 11e (+ gamesystem), build a roster
  with 3 enhancements, assert `evaluate()` now reports the "max 2 Enhancements" violation;
  assert `constraint.force_global_unrepresentable` drops to 0 and the Enhancements
  constraint is present in `forceConstraints`; spot-check a unit whose squad-cap uses a
  group-constraint modifier (A2) and an enhancement whose cost divides (A3).

## Scope / non-goals

- **DISPLAY (statline/weapon characteristic modifiers, ability-text append/replace)** — the
  ~43k drops needing a new profile-modifier IR channel — is **sub-project B**, separate.
- **NARRATIVE (Crusade)** — parked; the field-generalization in A1 incidentally maps Crusade
  cost-type constraints too, but they are inert in matched play (no Crusade cost accrues).
- **Multiple real forces/detachments** — `scope=force` still collapses to the whole roster
  (the existing single-implicit-force model); when real detachment forces land, `force`
  scope must narrow. Documented, unchanged here.

## Risks

- **Widening `field` to a string** loosens the domain type; mitigate by documenting the
  allowed shapes and keeping eval's switch exhaustive (unknown field that is not a present
  cost type → sums 0, i.e. inert, never throws).
- **Field-generalization surfacing Crusade constraints** as real (inert) constraints could
  in principle mis-fire if a Crusade cost ever accrued in a matched-play roster; it does
  not (matched play never adds Crusade costs), so they aggregate to 0 and are always
  satisfied. Verified by the real-data check (no spurious issues on a legal roster).
- **Group-mapping reorder (A2)** must not change existing 10e output; the `mini40k` golden
  guards this.
