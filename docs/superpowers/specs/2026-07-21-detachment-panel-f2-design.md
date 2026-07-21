# Detachment panel F2 — interactive enhancement assignment — Design

**Date:** 2026-07-21
**Status:** F2 design, awaiting user review
**Scope:** `apps/web` + one rules-free helper in `@muster/roster`. No parser change, no IR schema change, no `@muster/engine-eval` change, no data republish.

## The goal

F1 shipped a read-only detachment panel in the builder (rule + enhancement list). F2 makes each enhancement row **interactive**: assign an enhancement to one of the Characters you actually have in the roster, straight from the panel, and see/remove what's assigned.

## Mechanism (verified against real data)

An enhancement is a Character upgrade: every Character catalogue entry (e.g. Sororitas `Canoness`) is a top-level entry carrying an `"Enhancements"` group (`max 1, scope self`) whose members are the faction's enhancement entries (Sororitas: all 23, including `Blade of Saint Ellynor`). So assigning enhancement `E` to a roster Character `C` is exactly `toggleGroupMember(roster, C.selectionId, enhancementsGroup, E.id, catalogue)` — the **same** path the unit config already uses for any group. F2 surfaces that assignment from the panel; it introduces no new mutation path.

- Group name: `"Enhancements"` (most factions) or `"<Detachment> Enhancements"` (Space Marine family). Match `name.endsWith("Enhancements")`.
- The enhancement group sits on the Character's top-level entry for the common case, but F2 walks the unit's whole subtree so it also works if a hosting node is nested (a model within a unit) — returning the **owning node's** selection id as the `toggleGroupMember` parent.
- `taken` = the owning node already has a child selection whose `entryId` is the enhancement's id.

## New roster helper

```ts
/** For one enhancement, every roster unit that can host it — where to toggle it and
 *  whether it is currently on. Walks each top-level unit's subtree for a node whose
 *  catalogue entry has an "…Enhancements" group containing `enhancementEntryId`. */
export function enhancementTargets(
  roster: Roster, catalogue: IrCatalogue, enhancementEntryId: string,
): {
  unitSelectionId: string;   // top-level unit selection — for select/scroll
  unitName: string;          // the top-level unit's catalogue name
  parentSelectionId: string; // the node OWNING the group — the toggleGroupMember parent
  group: IrGroup;            // the "…Enhancements" group instance
  taken: boolean;            // this enhancement is currently selected under that group
}[];
```

Implementation: for each top-level roster selection (skip the detachment root subtree via the existing `detachmentSelectionIds`), walk its subtree; for each node resolve its catalogue entry (`catalogueEntry`); if that entry has a group `g` with `g.name.endsWith("Enhancements")` and `g.memberEntryIds.includes(enhancementEntryId)`, emit a target with `parentSelectionId = node.id`, `unitSelectionId = top-level selection id`, `unitName = top entry's name`, and `taken = node.selections.some((s) => s.entryId === enhancementEntryId)`.

## The interactive enhancement row (DetachmentPanel)

For each enhancement in a chosen detachment's list, compute `targets = enhancementTargets(...)` and `taken = targets.find((t) => t.taken)`:

- **Assigned** (`taken` set) → the row shows `on <taken.unitName>`. Clicking the row body **selects that unit** (`onSelectUnit(taken.unitSelectionId)`). Clicking the `on <unit>` marker **removes** it (`onToggleGroupMember(taken.parentSelectionId, taken.group, e.id)`).
- **Not assigned, ≥1 target** → clicking the row assigns. One target → assign directly and select that unit. Several → a small **inline, scrollable** menu of the target unit names; picking one assigns it there and selects it.
- **Not assigned, no target** → a muted hint `Add a Character to take this` (no palette deep-link in F2).

**The army-wide Enhancements cap is not enforced here** — the panel assigns freely; the legality panel reports going over (the same "show, never block" rule as the Detachment Points meter). One enforcement point, always the engine.

## Component / wiring changes

- `DetachmentPanel` gains props: `onSelectUnit: (selectionId: string) => void` and `onToggleGroupMember: (parentSelectionId: string, group: IrGroup, entryId: string) => void`. (`catalogue`, `roster` already passed.)
- The enhancement `<span>` rows become buttons/rows with the three states above; new CSS for the assigned marker, the assign affordance, the inline menu, and the hint.
- `App.tsx` passes `onSelectUnit={setSelectedUnitId}` and `onToggleGroupMember={(pid, group, eid) => setRoster((r) => toggleGroupMember(r, pid, group, eid, catalogue))}` (the identical callback it already gives `<UnitDetail>`), so there is one assignment code path in the app.

## Scope / non-goals

**In:** `enhancementTargets`; the three interactive row states; assign/remove via the existing `toggleGroupMember`; the inline multi-unit menu; App wiring; CSS.
**Out:** enforcing the army Enhancements cap in the panel (legality's job); per-enhancement model-eligibility filtering beyond "hosts the group" (an illegal assignment is reported by legality, not pre-blocked); deep-linking the "add a Character" hint into a filtered palette; any IR/parser/engine change.

## Testing

- **`enhancementTargets` (roster unit tests):** finds a hosting roster Character and reports `taken` false before / true after assignment; returns the correct `parentSelectionId` (the group-owning node) and `unitSelectionId`/`unitName`; returns `[]` when no roster unit hosts the group; returns two targets when two eligible Characters are in the roster; skips the detachment-root subtree.
- **`DetachmentPanel` (component tests):** an unassigned enhancement with one target assigns on click (calls `onToggleGroupMember` with the right args and `onSelectUnit`); an assigned enhancement shows `on <unit>` and clicking the marker removes it; with two targets a menu appears and picking one assigns there; with no target the hint shows; the F1 read-only rendering (rule text, list) is unchanged when there is no roster.
- **Real data + browser:** 11e Adepta Sororitas, Army of Faith detachment. Add a `Canoness`, open the panel: `Blade of Saint Ellynor` is unassigned; clicking it assigns to the Canoness and the row shows `on Canoness`; the Canoness's unit config shows the same enhancement selected (one path); clicking the marker removes it.

## Risks

- **Group instance location.** `enhancementTargets` must return the selection id of the node that actually owns the `…Enhancements` group, or `toggleGroupMember` toggles the wrong node. Covered by a real-data test on a hosting Character and by the two-targets test.
- **Re-derivation cost.** `enhancementTargets` runs per enhancement per render; bounded (a few enhancements, a small roster) — acceptable, no memoization in F2.
