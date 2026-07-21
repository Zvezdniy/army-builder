# Detachment panel in the builder — Design (F1: display)

**Date:** 2026-07-21 (reconciled after sub-projects C & D shipped)
**Status:** F1 design, awaiting user review
**Scope (F1):** `apps/web` + one tiny rules-free helper in `@muster/roster`. No parser change, no IR schema change, no `@muster/engine-eval` change, no data republish.

## The report

Once you press **Start building**, the detachment survives on screen only as a name chip in the setup bar (`SetupBar.tsx` — `DETACHMENT: Legends of Saga and Song  [Change]`). The rule text and the enhancements it unlocks — both shown in the setup wizard's detachment step — are gone. To recall what your detachment does, you have to reopen the wizard.

## Reconciliation with C & D (what changed since the original draft)

This spec was first drafted before sub-projects C and D landed. Two of its planned helpers are now obsolete — the data work is already done and shipped:

- **Rules** — the detachment entry carries `ruleNames` and the catalogue carries `ruleTexts` (D fixed the missing associations). The wizard already renders them (`SetupWizard.tsx`). No new rule-extraction work.
- **Enhancements** — `@muster/roster`'s shipped `enhancementsForDetachment(catalogue, detachmentId)` (C) returns a detachment's enhancements by reading the visibility gate, universally across factions. The original draft's group-name `detachmentEnhancements(catalogue, detachmentName)` helper is **dropped** — the wizard already uses the shipped helper, and the panel reuses it too. The "wizard de-duplication" the draft motivated is already done.

So F1 is now a thin **display** feature over already-published data and already-shipped helpers.

## What we're building (F1)

A **collapsible detachment panel** directly under the setup bar on the builder screen, rendered in `App.tsx` between `<SetupBar>` and `<LegalityPanel>`. Collapsed by default (a one-line header naming the chosen detachment(s)); expanding it shows, per chosen detachment:

1. **Rule(s)** — each rule's name and its text, line breaks preserved (`white-space: pre-line`), exactly as the wizard renders them. Driven by `ruleNames` + `ruleTexts`; 10e/11e agnostic.
2. **Enhancements** — the list the detachment unlocks (from `enhancementsForDetachment`), each row: name + points (`pointsCost(e)?.value ?? 0`, identical to the wizard). **Read-only in F1** — no assignment yet.

The panel renders only when the catalogue models detachments (`availableDetachments(catalogue).length > 0`) and at least one is chosen (`selectedDetachments(roster, catalogue).length > 0`). Several chosen detachments (11e) get one sub-section each, mirroring the wizard preview. It shares the wizard's existing CSS classes (`ds-section-head`, `det-rules`, `det-rule`, `det-rule-name`, `det-rule-text`, `enh-line`, `enh-name`, `enh-pts`) so the two views cannot drift visually.

## Architecture (F1)

**One tiny rules-free helper in `@muster/roster`** (beside `availableDetachments` / `enhancementsForDetachment`):

```ts
// The detachment's own rules resolved to displayable text, in declaration order,
// dropping any name whose text is absent from ruleTexts. Shared by the wizard and the
// panel so they render identical rule blocks.
export function detachmentRuleTexts(
  catalogue: IrCatalogue, detachmentId: string,
): { name: string; text: string }[];
```

Implementation: find the detachment entry (`availableDetachments(catalogue).find(id)`); map its `ruleNames` to `{ name, text: catalogue.ruleTexts?.[name] }`, keeping only entries whose text is a non-empty string.

**New web component `DetachmentPanel`** (`apps/web/src/components/DetachmentPanel.tsx`):
- Props: `catalogue: IrCatalogue`, `roster: Roster`. Self-contained — it derives chosen detachments internally via `selectedDetachments` + `availableDetachments`.
- Local `useState` open/closed, collapsed by default.
- Per chosen detachment: header (name), rules from `detachmentRuleTexts(catalogue, det.id)`, enhancements from `enhancementsForDetachment(catalogue, det.id)` with `pointsCost`.
- Returns `null` when the render condition (detachments modeled + ≥1 chosen) is false.

**`App.tsx`:** render `<DetachmentPanel catalogue={catalogue} roster={roster} />` between `<SetupBar …/>` and `<LegalityPanel …/>`.

**`SetupWizard` refactor (optional, drift-guard):** replace its inline `detachment.ruleNames.map(...)` rule resolution with `detachmentRuleTexts(catalogue, d.id)`, so the wizard and panel resolve rules through one function. One-line swap; the wizard's existing tests stay green (same output).

## Scope / non-goals (F1)

**In:** the collapsible panel; rule display; the read-only enhancement list; the `detachmentRuleTexts` helper; the optional wizard drift-guard swap.
**Out (→ F2):** interactive enhancement rows (assign an enhancement to a roster Character via `toggleGroupMember`, `on <unit>` state, remove, inline unit menu). Also out: enforcing the army Enhancements cap (legality panel's job); any IR/parser/engine change.

## Testing (F1)

- **`detachmentRuleTexts` (roster unit tests):** resolves each `ruleName` to its text; drops a name with no text in `ruleTexts`; returns `[]` for a detachment with no `ruleNames` and for an unknown id.
- **`DetachmentPanel` (web component tests):**
  - Returns nothing when no detachment is chosen (and when the catalogue models no detachment).
  - Collapsed by default: the rule text is not shown until the header is expanded.
  - Expanded: renders a detachment's rule name + text (line breaks preserved) and its enhancement rows (name + points) from the shipped helpers.
  - Two chosen detachments (11e) render two sub-sections.
- **Real data + browser:** 11e Adepta Sororitas → Army of Faith — the panel (expanded) shows *Sacred Rites* with its text and the four enhancements (Blade of Saint Ellynor, Divine Aspect, Litanies of Faith, Triptych of the Macharian Crusade), matching the wizard preview.

## F2 (follow-up, NOT in this plan) — interactive enhancement assignment

Kept here for continuity; designed and built separately after F1.

Each enhancement row becomes live against the roster: **assign this enhancement to one of the Characters I actually have.** For each enhancement, computed against the roster:
- **Already on a unit** → row shows `on <unit name>`; clicking selects that unit (`setSelectedUnitId`); clicking the marker again removes it (`toggleGroupMember`).
- **Not taken, ≥1 eligible roster unit** → clicking assigns (one eligible → assign+select directly; several → a small inline scrollable menu of those roster units).
- **Not taken, no eligible roster unit** → a muted hint `Add a Character to take this` (no palette deep-link in F2 v1).

Assignment goes through the **existing** `toggleGroupMember` path the unit config already uses (one assignment code path). The army-wide Enhancements cap is **not** enforced here — the legality panel reports overage (same "show, never block" rule as the Detachment Points meter). F2 needs a new roster helper `enhancementTargets(roster, catalogue, enhancementEntryId)` returning each hosting roster unit's `{ selectionId, unitName, parentSelectionId, group, taken }`. **F2 risk:** the enhancement group can sit anywhere in a roster unit's subtree — `enhancementTargets` must locate the right group instance and `parentSelectionId` or assignment toggles the wrong node (a real-data test on a hosting unit is the guard).
