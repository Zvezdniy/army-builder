# Wargear/Enhancement Invuln via Provenance — Design

**Date:** 2026-07-19
**Status:** Approved (design)
**Scope:** `@muster/roster` (`datasheet.ts`/`builder.ts`) + `apps/web` Datasheet.
Surface invulnerable saves granted by equipped WARGEAR/ENHANCEMENTS (Storm Shield,
Terminator Armour, Blessed Hull, …), which are currently invisible, WITHOUT the
false-positive explosion that blind text-scanning causes.

## Problem

The web `findInvuln` (`apps/web/src/components/Datasheet.tsx`) resolves a unit's
invulnerable save from the FLATTENED datasheet sections. It handles two forms:
1. a dedicated `typeName === "Invulnerable Save"` profile, and
2. an `Abilities` profile literally named "Invulnerable Save" (the infoLink/native form —
   e.g. Logan Grimnar, fixed by the infoLink parser work).

It MISSES the third form: wargear/armour whose ability is named after the ITEM
("Storm Shield", "Terminator Armour", "Astartes Shield", "Shield Dome") with a
Description reading "The bearer has a N+ invulnerable save". Terminators, storm-shield
models, and invuln-granting enhancements therefore show no chip.

Blindly broadening the scan to every `Abilities` Description was tried and REVERTED: it
jumped Space Wolves from 9/174 → 168/174 roots, because the faction/detachment ability
**"Veil of Ancients"** — collated by the parser onto nearly every unit's OWN profiles —
uses the SAME "The bearer has a 4+ invulnerable save" phrasing. No regex separates an
equipment-granted invuln from an army-rule mention by TEXT alone.

## Insight: provenance is available where the data is walked

`datasheet()` in `@muster/roster` walks the selection tree
(`visit(sel)`), and at each node it knows the contributing entry and its depth — the
exact `isBody`/`depth` distinction `unitLoadout` already uses to tell a unit's model
bodies from its equipped wargear. That provenance is DISCARDED when profiles are
flattened into `DatasheetSection[]`. The fix is to resolve the invuln in the roster
layer, where provenance still exists, instead of in the web layer after it is lost.

**Provenance rule (identical to `unitLoadout`'s wargear test):**
- A profile is **`wargear`-sourced** when it comes from a selection at `depth > 0` whose
  entry does NOT carry a `"Unit"` typeName profile (an equipped item or enhancement).
- A profile is **`unit`-sourced** otherwise: the root entry (`depth 0`) or a model-body
  descendant. Faction / army / detachment rules that the parser collates onto the unit's
  own entry ("Veil of Ancients") are `unit`-sourced.

"Veil of Ancients" is collated onto the ROOT entry (depth 0) of ~160 units — that is what
made the blind scan explode. Under the provenance rule it is `unit`-sourced and never
enters the text-scan. A real enhancement that grants an invuln is a chosen child
selection (`depth > 0`, non-body) → `wargear`-sourced → correctly surfaced.

## Design

Move invuln resolution into `@muster/roster` as a dedicated, provenance-aware function.
The web layer stops resolving rules and just renders the result.

### New: `invulnSave(catalogue, selection): InvulnSave | undefined`

```ts
export interface InvulnSave {
  value: string;      // e.g. "4+"
  sourceName: string; // the profile name that granted it ("Invulnerable Save", "Storm Shield", …)
  bare: boolean;      // Description is EXACTLY the value (no qualifying prose) → web drops the
                      // redundant Abilities line. Wargear-scanned invuls carry prose, so bare=false.
}
```

It walks the selection subtree exactly like `datasheet()` (root at `depth 0`), tracking
provenance, and collects invuln candidates in three classes:

1. **Any source** — a profile with `typeName === "Invulnerable Save"`: value =
   `extractSavePlus(characteristics[0].value) ?? characteristics[0].value.trim()`;
   `bare = true`. (Legacy/synthetic dedicated section.)
2. **Any source** — an `Abilities` profile whose name matches `/^invulnerable save/i`:
   value = `extractSavePlus(Description)`; `bare = (Description.trim() === value)`.
   (The infoLink/native "Invulnerable Save" ability — trusted by NAME regardless of
   provenance.)
3. **Wargear source ONLY** — an `Abilities` profile (ANY name) whose Description contains
   `/invulnerable save/i` AND yields an `N+` token: value = that token;
   `sourceName = profile.name`; `bare = false`. (Storm Shield / Terminator Armour / …,
   and invuln-granting enhancements.)

A candidate with no parseable `N+` value is discarded (a broken chip never shows). Among
all candidates, pick the BEST (lowest numeric `N+` — invuln saves do not stack, the model
uses its single best). Tie-break: prefer a `bare` (unconditional-formatted) candidate,
then a named class-1/2 candidate over a class-3 scan. Return `{ value, sourceName, bare }`
for the winner, or `undefined` if there are no candidates.

`extractSavePlus` (first `\d+\+` token → `"N+"`) moves from the web into the roster
module and is reused by all three classes.

### Web change (`apps/web/src/components/Datasheet.tsx`)

- Delete `InvulnInfo`, `extractSavePlus`, and `findInvuln`.
- Import `invulnSave` from `@muster/roster`.
- `UnitStatline`: replace `findInvuln(sections)` with `invulnSave(catalogue, selection)`.
- `Datasheet`: replace `findInvuln(all)` with `invulnSave(catalogue, selection)`.
- The chip render and the "drop the redundant bare Abilities line" logic are UNCHANGED —
  they consume the same `{ value, sourceName, bare }` shape.

### Why not thread provenance through `datasheet()` / `DatasheetSection`?

That would change the `DatasheetSection` shape consumed by the weapon and abilities
renderers and dedup, for one narrow consumer. A dedicated ~30-line walker in the roster
layer is self-contained, unit-testable, and leaves `datasheet()` untouched.

## Scope / non-goals

**In scope:** `invulnSave` with provenance-gated text-scan; move `extractSavePlus`; web
swap; roster unit tests; real-data verification on Space Wolves.

**Out of scope (explicit):**
- Per-MODEL invuln display. The chip is a single unit-level value (best across the
  subtree), matching the existing chip's behavior — a squad where only one model carries a
  storm shield still shows one chip. Documented limitation, unchanged by this work.
- 11e native invuln (`InSv` Unit-statline characteristic) — separate concern; this work is
  the 10e ability/wargear encoding.
- Weapon-profile text (anti-invuln weapons like "ignore invulnerable saves"): class 3
  scans only `typeName === "Abilities"` profiles, so weapon profiles are never scanned.
- `type="rule"`/`infoGroup` infoLinks (handled/■out of scope in the infoLink work).

## Error handling

- No candidate → `undefined` (no chip). No parseable value on a candidate → that candidate
  is skipped, not a crash.
- An unresolvable selection entry cannot occur here (the same catalogue invariant
  `datasheet()` relies on); no defensive fallback beyond what `datasheet()` already has.

## Testing

Unit (roster `builder.test.ts`), synthetic catalogues:
1. **Dedicated section** (class 1) → resolves, `bare = true`.
2. **Named "Invulnerable Save" ability on the root** (class 2, unit-sourced) → resolves
   (proves named case is trusted regardless of provenance — the Logan shape).
3. **Storm-Shield-style wargear** (class 3): a child selection, non-body, Description "The
   bearer has a 4+ invulnerable save" → resolves value 4+, `sourceName` = item, `bare =
   false`.
4. **Faction-rule false positive**: an `Abilities` profile with invuln phrasing on the
   ROOT entry (unit-sourced, the "Veil of Ancients" shape) but NOT named "Invulnerable
   Save" → NOT surfaced (undefined / not that value).
5. **Best-of**: a 5+ named ability and a 4+ storm shield on the same unit → 4+ wins.
6. **No invuln** → `undefined`.

Real-data verification (not committed; real data gitignored):
7. Re-resolve real Space Wolves via `invulnSave` over every root's default loadout and
   assert (a) storm-shield / Terminator-Armour units now surface an invuln, (b) Logan
   Grimnar still shows 4+ (class 2 unbroken), (c) the total count is SANE — in the low
   dozens, NOT ~160 — confirming "Veil of Ancients" no longer leaks.

## Risks

- **Provenance assumption:** the design assumes "Veil of Ancients" is collated at
  `depth 0` (unit-sourced), not injected as a wargear child. If real data proves otherwise,
  the count in test 7 stays high and the design must add a name/category exclusion. The
  verification task measures this directly BEFORE the feature is considered done.
- **Reaches deployed users only after catalogue repack/republish** — this is a code change
  in `@muster/roster`; it takes effect immediately in local/dev, and for the deployed app
  as soon as the web bundle redeploys (no catalogue repack needed, unlike the infoLink
  parser fix). No data regeneration required.
