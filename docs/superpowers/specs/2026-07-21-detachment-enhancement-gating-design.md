# Sub-project C — Detachment enhancement previews from the visibility gate

**Status:** design, awaiting user review
**Date:** 2026-07-21
**Branch (implementation):** `feat/enhancement-detachment-gating`

## Goal

The setup wizard's detachment step shows "No enhancement preview" for most factions. Show each detachment's real enhancements instead — the ones that detachment unlocks.

## Root cause & key finding (verified against the repacked IR)

The enhancement→detachment association is **already in the IR** — the parser emits it; the app just doesn't read it. Each enhancement entry carries a `visibilityModifier` (`set: true`, i.e. "set hidden = true") gated by a condition that hides it until its detachment is selected. Example (Adepta Sororitas, `Blade of Saint Ellynor`):

```json
{ "set": true, "conditionGroups": [{ "type": "and", "conditions": [
  { "comparator": "lessThan", "value": 1, "field": "forces",     "targetType": "entry", "targetId": "cac3-…" },
  { "comparator": "lessThan", "value": 1, "field": "selections", "targetType": "entry", "targetId": "6f81-1a3e-c84e-0954" }
]}]}
```

`targetId 6f81-1a3e-c84e-0954` is the **"Army of Faith" detachment** entry. The condition `lessThan selections <detachment> 1` means "hidden while fewer than 1 of that detachment is selected" — i.e. **this enhancement belongs to that detachment**.

The current `enhancementsFor` in `SetupWizard.tsx` ignores this and instead looks for a group named `"<Detachment> Enhancements"`. That naming exists only in the Space Marine family, so every other faction (Sororitas, CSM, Necrons, Orks, …) shows nothing.

**Validated across factions** by reading the `field:"selections"` gate:
- Sororitas: each of the 6 main detachments → exactly its 4 enhancements (23 total = the whole pool); no junk entries leaked.
- Space Marines 49/51, Necrons 8/12, Orks 15/15 detachments map correctly (`Gladius → Artificer Armour…`, `War Horde → Supa-Cybork Body…`). The gate is present in the SM family too, so it **replaces** the name heuristic universally.

## Chosen approach (app-only — user-approved)

No parser or data change. Read the existing `visibilityModifiers` to map enhancements to detachments.

Add a helper in `@muster/roster` (the catalogue-reading domain layer, alongside `availableDetachments` / `catalogueEntry`):

```ts
/** Entries this detachment unlocks: any entry with a `set hidden` visibility gate
 *  whose condition is `lessThan selections <detachmentId>` — "hidden until this
 *  detachment is selected". Deduped by entry id in first-encounter order. */
export function enhancementsForDetachment(catalogue: IrCatalogue, detachmentId: string): IrEntry[];
```

Gate predicate: a `VisibilityModifier` with `set === true` that contains — in `conditions` or recursively in `conditionGroups[].conditions` — a condition with `field === "selections"`, `comparator === "lessThan"`, `targetType === "entry"`, and `targetId === detachmentId`.

`SetupWizard.tsx` replaces `enhancementsFor(catalogue, d.name)` with `enhancementsForDetachment(catalogue, d.id)`; the old name-heuristic `enhancementsFor` is deleted.

## Components & changes

All TypeScript. No parser, no `@muster/domain` schema change (`VisibilityModifier`, `IrCondition` already model everything needed), no republish.

### 1. `packages/roster/src/builder.ts` — the helper
- `flattenConditions(vm: VisibilityModifier): IrCondition[]` — collect `vm.conditions` plus, recursively, every `conditionGroups[].conditions`. (Small private helper.)
- `enhancementsForDetachment(catalogue, detachmentId)` — walk the entry tree (mirror the existing tree-walk in the current `enhancementsFor`: a stack over `catalogue.entries` then push `.children`), collect each entry that has a `set===true` visibility modifier whose flattened conditions include a match `field==="selections" && comparator==="lessThan" && targetType==="entry" && targetId===detachmentId`. Dedup by entry id, first-encounter order. Return `IrEntry[]`.
- Import `VisibilityModifier`, `IrCondition` types from `@muster/domain` if not already imported.

### 2. `apps/web/src/components/SetupWizard.tsx` — consume it
- Import `enhancementsForDetachment` from `@muster/roster`.
- In the `previews` derivation, change `enhancements: enhancementsFor(catalogue, d.name)` to `enhancements: enhancementsForDetachment(catalogue, d.id)`.
- Delete the local `enhancementsFor` function (lines ~26-46) and its doc comment.
- The rest of the preview render (name + `pointsCost`) is unchanged.

## Data flow

`catalogue.entries[*].visibilityModifiers` (already published) → `enhancementsForDetachment(catalogue, detachment.id)` → SetupWizard preview lists each unlocked enhancement's name + points.

## Testing

**Unit (`packages/roster/src/builder.test.ts`, 100%-coverage package):**
- A catalogue with a detachment root (`e.det` → options `e.gladius`, `e.anvil`) and two enhancement entries: `e.enhA` gated `lessThan selections e.gladius 1`, `e.enhB` gated `lessThan selections e.anvil 1`. Assert `enhancementsForDetachment(cat, "e.gladius")` returns `[e.enhA]` only, and `"e.anvil"` returns `[e.enhB]`.
- An enhancement gated to the target detachment via a **nested** `conditionGroups` (type "and") — assert it is found (recursion works).
- An entry with a `set` gate on `field:"forces"` (not `"selections"`) targeting the detachment — assert it is NOT returned (MVP matches only the `selections` signal).
- An entry with no visibility modifier — not returned.
- Dedup: an entry whose gate lists the target detachment id in two modifiers appears once.

**Web (`apps/web/src/components/SetupWizard.test.tsx`):**
- Update the detachment-preview test fixture to carry a `selections`-gated enhancement, select the detachment, and assert its enhancement name renders (and a different detachment's enhancement does not).

**Real-data spot check (manual, no gate in CI):** in the running builder, Sororitas → Army of Faith shows `Blade of Saint Ellynor`, `Divine Aspect`, `Litanies of Faith`, `Triptych of the Macharian Crusade`; Space Marines → Gladius shows `Artificer Armour`, `The Honour Vehement`, `Adept of the Codex`.

## Out of scope

- **`forces`-gated detachments** (SM 2/51, Necrons 4/12 map via a `field:"forces"` category condition rather than `field:"selections"`). They keep showing "No enhancement preview", exactly as today — no regression. Recovering them needs a detachment→category mapping; deferred as a follow-up only if it proves worth it.
- No change to enhancement *selection* in the roster (this is preview-only, same as the current behaviour). Interactive enhancement picking remains the separate detachment-panel spec (2026-07-21-detachment-panel-design.md).
- No parser change, no `visibilityModifier` schema change, no republish.
