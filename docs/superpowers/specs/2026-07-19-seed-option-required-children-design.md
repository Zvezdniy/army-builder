# Seed an Option's Required Children on Pick — Design

**Date:** 2026-07-19
**Status:** Approved (design)
**Scope:** `@muster/roster` builder (`addOption`, `toggleGroupMember`) + `apps/web` wiring.
General builder-seeding bug: picking a wargear/loadout option drops its mandatory
sub-parts.

## Problem

`addOption` and the add-path inside `toggleGroupMember` insert a picked option as a bare
`freshSelection(entryId)` with EMPTY `selections`. They do NOT seed the option's REQUIRED
children (entries with a `min>=1` `selections` constraint, scope self/parent) the way
`addUnit`/`initialChildren` and group-seeding do for a root unit. So whenever a user picks
an option that has mandatory sub-parts, those sub-parts never enter the selection tree.

**Measured (real Space Wolves 10e alone):** 114 non-root options have >=1 required child
that is dropped on pick. Only 8 carry an invulnerable save — the other ~106 drop WEAPONS
and other mandatory parts (e.g. `Grey Hunter` → `Bolt Carbine`; `Wolf Guard w/ boltgun` →
`Heirloom weapon`; `Storm shield and close combat weapon` → `Close combat weapon`;
`Company Champion` → `Astartes Shield`). This repeats in every faction.

**Consequences:** the option's datasheet is missing weapons/abilities it must have, AND
`evaluate()`/points are wrong (an unmet min-1 constraint, or a missing costed sub-part).
The missing invuln chip (Thunderwolf Cavalry `w/ storm shield` → mandatory `Storm shield`
ability, min:1 scope:parent) is just the most VISIBLE symptom, since it renders a chip.

This is the residual half of the wargear-invuln investigation: `invulnSave` is already
correct (it surfaces the save whenever the granting selection is in the tree); this fix
makes the required sub-part actually get into the tree on pick.

## Design

Mirror `addUnit`'s existing seeding. `addUnit(roster, entryId, catalogue?)` already does:
```ts
const seed = freshSelection(entryId);
const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
```
`initialChildren(entry)` already handles group defaults + `min>=1` ungrouped options +
counted-group model instances, recursively. Reuse it verbatim.

### `addOption` — gains an optional `catalogue`

```ts
export function addOption(
  roster: Roster,
  parentSelectionId: string,
  entryId: string,
  catalogue?: IrCatalogue,
): Roster {
  const seed = freshSelection(entryId);
  const entry = catalogue ? catalogueEntry(catalogue, entryId) : undefined;
  const selection = entry ? { ...seed, selections: initialChildren(entry) } : seed;
  return {
    ...roster,
    selections: mapTree(roster.selections, parentSelectionId, (s) => ({
      ...s,
      selections: [...s.selections, selection],
    })),
  };
}
```

### `toggleGroupMember` — gains an optional `catalogue`, forwards it

Signature gains `catalogue?: IrCatalogue`; the two `addOption(...)` add-path calls forward
it:
```ts
if (members.length < max) return addOption(roster, parentSelectionId, entryId, catalogue);
if (max === 1) return addOption(remove(roster, members[0]!.id), parentSelectionId, entryId, catalogue);
```
The deselect/no-op branches are unchanged.

### `apps/web` wiring

`apps/web/src/App.tsx` (the only production callers, where `catalogue` is already in scope
and already passed to `setGroupMemberCount`):
```ts
onAddOption={(pid, eid) => setRoster((r) => addOption(r, pid, eid, catalogue))}
onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))}
```

## Why optional (backward-compat)

Making `catalogue` optional keeps the ~15 existing builder tests (which call `addOption`/
`toggleGroupMember` without a catalogue) green: without a catalogue the functions behave
exactly as before (bare add, no seeding). Production always passes it → seeds. New tests
pass a catalogue and assert seeding. This matches the established `addUnit` pattern.

## Invariants to preserve

- **Immutability:** no input mutation; `mapTree` already returns fresh nodes.
- **Counted-group one-model-per-node:** a counted sub-group under the picked option must
  seed N distinct one-each model instances (via `initialChildren`'s existing counted
  branch), NOT a single count-N node — otherwise per-model wargear max-1 constraints trip.
  `initialChildren` already does this; reusing it inherits the invariant.
- **Dangling links are no-ops:** never inject an entryId absent from the catalogue.
  `catalogueEntry` returns undefined for an unresolvable option → falls back to the bare
  `seed` (no seeding), same guard `addUnit` relies on. `initialChildren`/`groupSeed`
  already skip unresolvable members.
- **No double-seed:** `addOption` is the single add; it seeds once. Callers do not also
  seed.

## Scope / non-goals

**In scope:** seeding required children on `addOption`/`toggleGroupMember`; web wiring;
unit tests; real-data verification.

**Out of scope:** changing `initialChildren` itself; re-seeding options added before this
fix (existing rosters are not migrated — only new picks seed); the counted-group count
editing path (`setGroupMemberCount` already seeds correctly); `evaluate()` changes (it
already reports the min-1 violation — this fix removes the cause).

## Testing

Unit (`builder.test.ts`), synthetic catalogue with a required (`min:1`) child:
1. **Seeds a required child:** an option `opt` with a `min:1 scope:parent` child `req` →
   `addOption(r, pid, "opt", catalogue)` nests `opt` carrying a `req` selection.
2. **Recurses:** `req` itself has a `min:1` grandchild → fully seeded depth-first.
3. **Group defaults:** an option with a required (`min>=1`) choose-1 group seeds the
   group's default member (reuses `initialChildren` group path).
4. **toggleGroupMember add seeds:** the add branch (room, and the max-1 swap) seeds the
   new member's required children.
5. **Backward-compat:** `addOption`/`toggleGroupMember` WITHOUT a catalogue seed nothing
   (bare add) — existing behavior unchanged.
6. **No required children:** picking a childless/all-optional option yields a single node,
   no phantom children.
7. **Counted invariant:** an option whose child is a counted group (repeatable models,
   min N) seeds N one-each model instances, not a count-N node.

Real-data (repacked Space Wolves, not committed):
8. Drive picks through the REAL builder (`addOption`/`toggleGroupMember` WITH catalogue)
   and assert: (a) the storm-shield mount options now carry `Storm shield` → `invulnSave`
   → 4+ (Thunderwolf Cavalry, Wolf Guard w/ storm shield); (b) a weapon option seeds its
   weapon (`Grey Hunter` → `Bolt Carbine`); (c) the count of options that STILL drop a
   required child when picked WITH the catalogue is ~0 (down from 114); (d) a counted unit
   (e.g. a Terminator squad) keeps correct one-model-per-node structure and points.

## Risks

- **Web-test drift:** production now passes a catalogue, so any web test simulating a pick
  and asserting on the raw tree may see the newly-seeded children. Expected and correct;
  update such assertions if any exist (the implementer runs the web suite).
- **Over-seeding a genuinely-optional sub-part:** `initialChildren` only seeds group
  defaults and `min>=1` options, i.e. things the catalogue marks mandatory/default — the
  same set `addUnit` seeds for a root unit. No purely-optional wargear is force-added.
