# Group choose-N constraints — Design

**Date:** 2026-07-11
**Status:** Approved for planning
**Scope owner:** Muster (engine-parser + engine-eval + domain)

## Goal

Model and enforce BattleScribe `<selectionEntryGroup>` **choose-N** limits on
selection count — the "pick 1 of {Power Sword, Power Axe, Bolter}" wargear /
loadout pattern. Today these limits are parsed away: group member entries are
flattened into the owning entry's `children`, and the group's own constraint is
dropped with a `group.constraint_dropped` diagnostic. The choice limit is
therefore never validated, so an illegal loadout (two weapons where one is
allowed) passes as valid.

## Scope

**In scope**
- Group constraints of `type` ∈ {`min`, `max`} on `field=selections`
  (choose-at-least / choose-at-most a number of member selections).
- A first-class group concept preserved through the IR into the evaluator.
- Faithful, loud handling of everything out of scope (diagnostic + drop, never
  silently mapped, never miscompiled).

**Explicitly out of scope** (unchanged: diagnostic-drop via
`group.constraint_dropped`)
- Group constraints on `field=points` (e.g. "≤30 pts of upgrades from this group").
- Modifiers attached to a group constraint (conditional min/max).
- Nested sub-groups treated as their own choose-N units. Sub-group *member
  entries* continue to flatten up into the owning entry's `children` as today;
  the sub-group's own constraints are dropped.

## Why a first-class group node (decision)

A choose-N limit aggregates the combined selection count across an **arbitrary
set of sibling entries** (the group's members) under one owner. That is neither
a single `entry` nor a `category` target, and its "count the members under this
owner" semantics do not map onto the existing `self/parent/force/roster` scope
enum. Overloading `IrConstraint` with a member-id list plus a special-cased
scope was the rejected alternative: it puts a group-only field on the shared
constraint type and needs a scope translation that is an easy place to
miscompile. A dedicated `IrGroup` node keeps the shared `IrConstraint` clean,
gives the concept its own honest semantics, preserves the group's name for
useful validation messages, and extends naturally if points/nested groups are
added later.

## Data model — `@muster/domain`

New minimal group-constraint type (no `scope`/`targetType`/`targetId`/`modifiers`
— the member set and the "under this owner" semantics are fixed by the group, so
those fields would be dead weight and a miscompile hazard):

```ts
export const IrGroupConstraint = z.object({
  id: z.string(),                       // preserved for overrides + error identity
  type: z.enum(["min", "max"]),
  value: z.number().finite(),           // untrusted-input trust boundary
});
export type IrGroupConstraint = z.infer<typeof IrGroupConstraint>;

export const IrGroup = z.object({
  id: z.string(),
  name: z.string(),
  memberEntryIds: z.array(z.string()).default([]),
  constraints: z.array(IrGroupConstraint).default([]),
});
export type IrGroup = z.infer<typeof IrGroup>;
```

`IrEntry` gains one field:

```ts
groups: IrGroup[];   // z.array(IrGroup).default([]) in the lazy schema; default [] on the interface
```

The Rust side (`engine-parser/src/ir/model.rs`) mirrors this with serde structs
(`IrGroup`, `IrGroupConstraint`), `#[serde(rename_all = "camelCase")]`, and
`skip_serializing_if = "Vec::is_empty"` on `groups`/`memberEntryIds`/
`constraints` so entries without groups serialize identically to today.

## Parser — `engine-parser`

`map_entry` (in `src/ir/map.rs`) currently calls `collect_group_entries`, which
flattens members into `children` and drops every group constraint. Change:

- Members still flatten into `children` (their costs and nested constraints must
  keep evaluating) **and** each group's direct member entry ids are recorded.
- For each `RawGroup`, build an `IrGroup` when it has **at least one mappable
  min/max selections constraint**:
  - `id`, `name` from the raw group.
  - `memberEntryIds` = ids of the group's **direct** member entries, taken from
    the resolved raw model (so inlined entryLinks are reflected). Sub-group
    descendants are not included (out of scope).
  - `constraints` = each raw group constraint whose `type` ∈ {min, max} **and**
    whose `field` maps to `selections`, as `IrGroupConstraint { id, type, value }`.
    The raw constraint's `scope` is **not** consulted (group semantics are fixed).
- Any group constraint that is not mappable (field=points, unknown type, has a
  modifier) → `group.constraint_dropped` diagnostic, as today. A group with no
  mappable constraint emits **no** `IrGroup` (behaviour identical to today —
  members flattened, limit dropped), so no empty/dead group nodes appear.

Verify during implementation that `resolve()` inlines entryLinks nested inside
groups; if a member is an unresolved link at map time, its id must still be
captured so the engine can match it (add a focused test).

## Evaluator — `engine-eval`

A dedicated pass, separate from the per-node `entry.constraints` loop, added to
`evaluate()` after the existing entry-constraint loop:

```
for (const node of state.all)
  for (const group of node.entry.groups)
    for (const gc of group.constraints)
      issue = checkGroupConstraint(gc, node, group, state)
      if (issue) raw.push(issue)
```

`checkGroupConstraint` (no `costOf` — choose-N sums `selections`/counts, never
points) aggregates over the owner node's **direct children** whose
`entry.id` ∈ `group.memberEntryIds`, summing `effectiveCount`:

- `actual = Σ effectiveCount` of matching direct children.
- `max` violated when `actual > value`; `min` violated when `actual < value`.
- Direct children are correct: group members are flattened as direct children of
  the owning entry, and the roster tree mirrors the entry tree, so a member
  selection is a direct child of the owner selection.
- Each occurrence of the owner entry (selected multiple times / under different
  parents) is its own `EvalNode` and is validated independently.

Emitted `Issue`:
- `code`: `group.max` / `group.min` (distinct from `constraint.*` so the UI can
  present group violations specially).
- `message`: names the group, e.g. `Too many in "Wargear": 2 exceeds max 1` /
  `Not enough in "Wargear": 0 below min 1`.
- `constraintId`: `gc.id`; `entryId`: owner `node.entry.id`; `selectionId`:
  owner `node.selectionId`.

Overrides and cost modifiers are untouched: a group issue flows through the
existing override-dismissal path (keyed on `constraintId` + optional
`selectionId`) exactly like an entry/force constraint issue.

## Cross-language contract & fixtures

The `mini40k` fixture already contains group `g.wargear` (currently
`group.constraint_dropped`). Update it to exercise the feature:
- Add a second member to `g.wargear` (e.g. `e.captain.axe`) so a `max=1` limit is
  meaningfully testable (sword + axe = 2 > 1).
- Regenerate `mini40k.catz`.
- Update the golden `tests/fixtures/golden/mini40k.ir.json` (captain now carries a
  `groups` entry) and the engine-eval contract copy
  `packages/engine-eval/test/fixtures/parser-golden.ir.json` in lockstep.
- Add a contract-test roster that selects both weapons and asserts the engine
  reports a `group.max` violation.

## Testing

- **domain:** Zod round-trip for `IrGroup`/`IrGroupConstraint`; defaults
  (`groups` absent → `[]`); rejects non-finite `value`; rejects unknown `type`.
- **parser (`tests/map.rs`):** min-only, max-only, and min+max groups → correct
  `IrGroup` with members and constraints; `field=points` group constraint →
  `group.constraint_dropped` + no `IrGroup`; group with a modifier → dropped;
  members still present in `children`; nested sub-group constraint dropped while
  its members flatten up.
- **engine (`test/`):** choose-max satisfied (1 → ok) and violated (2 → error);
  choose-min satisfied and violated (0 with min 1 → error); override dismisses a
  group violation; a group whose members are not selected produces no false
  positive on `max` (and the correct `min` violation when min ≥ 1).
- **e2e / contract:** updated golden matches; contract roster triggers
  `group.max`.
- Maintain the enforced **100%** statements/branches/functions/lines coverage on
  both TS packages; keep the Rust suite green.

## Global constraints (bind every task)

- **Never miscompile.** Anything not faithfully representable is a loud
  diagnostic + drop, never a guessed value.
- **Untrusted input.** All new numeric IR fields are `z.number().finite()`;
  parser adds no `unsafe` (crate remains `#![forbid(unsafe_code)]`).
- **Contract stays in lockstep.** Parser golden and the engine-eval golden copy
  are updated together; the golden test and the cross-language contract test
  both pass.
- **Coverage.** 100% enforced thresholds on `@muster/domain` and
  `@muster/engine-eval` remain green; `pnpm typecheck`, `cargo test`,
  `cargo deny check`, `cargo audit` all clean.
```
