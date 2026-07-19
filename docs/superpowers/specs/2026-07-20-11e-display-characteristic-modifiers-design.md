# 11e Display: Profile Characteristic Modifiers (Sub-project B) — Design

**Date:** 2026-07-20
**Status:** Approved (design; backend mechanics decided autonomously per project workflow)
**Scope:** `@muster/domain`, engine-parser (`raw` + `ir`), `@muster/engine-eval`, `apps/web`.
Make datasheets show DYNAMIC characteristics — statline/weapon stats a modifier changes
when wargear/enhancements/abilities are taken (e.g. Artificer Armour → Sv 2+). Does NOT
affect points/legality (that was sub-project A) — pure datasheet display accuracy.
Investigation: `scratchpad/11e-display-channel-design.md`.

## Findings that shape the design

- **`replace` is a no-op** (100% `arg:"+0"` in real data); **`append`** is ~86% cosmetic
  name/annotation text or keyword-list concatenation; **`floor`/`ceil`** are Crusade-only.
  So the only kinds that need real numeric semantics for characteristics are
  **`set`/`increment`/`decrement`**.
- **Damaged-profile step-down is already solved** — it is a second `IrProfile` via the
  already-merged `infoLink type=profile` resolution, not a modifier. No work needed (verify
  `datasheet()` emits both profiles).
- **>90% of characteristic modifiers target a profile on a DIFFERENT entry** than the one
  that owns the modifier (an upgrade reaching "up" to its parent model's Unit profile, or
  "across" to a squad's weapon sub-entries), via BattleScribe `scope`/`affects` addressing.
  A naive "modifiers slot on `IrProfile`" would miss the majority — including the best
  examples (Artificer Armour, Heavy Jump Pack are both cross-entry). The `scope` vocabulary
  (`model`/`upgrade`/`root-entry`/`parent`/`model-or-unit`/`roster`/`self`/foreign-id) is
  exactly what `engine-eval/src/scopes.ts` already resolves for conditions/constraints.
- **~52% of characteristic modifiers are Crusade** (narrative, out of scope). Same mechanism
  exists in 10e (benefits both editions). Zero existing test fixtures use these kinds →
  zero golden churn.

## Design — Option B: owning-entry capture, lazy resolution in eval

### 1. Domain / IR (`@muster/domain` + Rust `model.rs`)

New `IrCharacteristicModifier`:
```
{
  characteristic: string,      // characteristic name, e.g. "Sv", "T", "M", "S", "A"
  profileType: string,         // profile typeName the target profile must have: "Unit" | "Melee Weapons" | "Ranged Weapons"
  kind: "set" | "increment" | "decrement",   // first slice: numeric only
  value: string,               // display-string value ("2+", "10\"", "1") — characteristics are strings in IR
  targetScope: string,         // reuse IrCondition scope keywords: self|parent|model|upgrade|root-entry|ancestor|model-or-unit|roster|force|<entry-id>
  targetId?: string,           // optional filter the target node must match. REAL DATA: this is a
                               // CATEGORY id (SM 11e: 1148 of 1306 resolve to a category — Character,
                               // Psychic Weapon, Extra Attacks Weapon; ZERO resolve to an entry id).
                               // Eval matches node.entry.id === targetId OR node.categories.includes(targetId).
  recursive: boolean,          // whole subtree vs direct children only
  conditions?: IrCondition[],
  conditionGroups?: IrConditionGroup[],
}
```
New `IrEntry.characteristicModifiers: IrCharacteristicModifier[]` (optional, serde
skip-if-empty → zero golden churn). Mirror in Rust `model.rs` (strings/bool/f-free).

### 2. Parser capture (engine-parser `raw` + `ir/map.rs`)

- **raw:** ensure `RawModifier` captures `scope` and `affects` (the BattleScribe addressing
  strings) in addition to the existing `field`/`kind`/`value`/`conditions` — read them in
  both `raw/parse.rs` (XML) and `raw/parse_json.rs` (JSON), for XML/JSON parity.
- **map (`map_entry`):** a modifier whose `field` resolves to a characteristicType (not a
  cost type, not a constraint id) AND whose `kind` ∈ {set,increment,decrement} is captured
  as an `IrCharacteristicModifier` on the owning entry instead of dropped as
  `target_unmapped`. The `affects` path (`self.entries[.recursive][.<id>].profiles.<TypeName>`)
  is parsed into `targetScope`/`targetId`/`recursive`/`profileType`. NOTE (found in real-data
  verification): the `affects` path also occurs in two BARE forms — `profiles.<TypeName>` (the
  target is whatever the modifier's own `scope` attribute anchors to — e.g. Heavy Jump Pack uses
  `scope="root-entry"`, `affects="profiles.Unit"`) and `<id>.profiles.<TypeName>`. The bare forms
  MUST keep the modifier's own `scope` as the anchor (falling back to `self` only when absent);
  hardcoding `self` silently breaks the whole wargear-swap-changes-the-statline case. `field`→
  `characteristic` name (via the catalogue/gamesystem characteristicType id→name map, the
  same decode `map` already has access to). Faithful capture, light structuring — no
  resolution in Rust. `append`/`replace`/`floor`/`ceil` on characteristics remain dropped
  (unchanged diagnostics) — deferred, not first slice.
- The A2 group-constraint routing and A1 cost-type routing are unaffected (this is a new
  branch for characteristic-typed fields, which previously fell through to `target_unmapped`).

### 3. Eval application (`@muster/engine-eval`, new `characteristics.ts`)

New `effectiveDatasheet(catalogue, roster, selectionId): DatasheetSection[]` — returns the
same shape `@muster/roster`'s `datasheet()` returns, but with EFFECTIVE characteristic
values:
1. **Collect** every `IrEntry.characteristicModifiers` found anywhere in the unit's selected
   subtree (a modifier can target a profile outside its own entry, so collect globally
   across the subtree, keyed with its owning `EvalNode`).
2. **Gate** each via the existing `gatePasses`/condition machinery against the live
   `EvalState` (`buildState(roster, catalogue)`), reusing `conditions.ts` unchanged.
3. **Resolve target** for each passing modifier: from the owning node, resolve `targetScope`
   to an anchor `EvalNode` (reuse `scopes.ts` `nearestByType`/anchor-walk), take anchor
   self-or-subtree per `recursive`, filter to nodes whose entry has a profile with
   `typeName === profileType`, and to `targetId` if set.
4. **Apply** in modifier-declaration order, per matching profile+characteristic:
   - `set` → replace the value string.
   - `increment`/`decrement` → parse a leading integer from the current value string
     (`^(\d+)(.*)$`, the `extractSavePlus` style already in `builder.ts`), apply, splice the
     new number back before the untouched suffix (`"10\""` +2 → `"12\""`; `"2+"` −1 → `"1+"`).
     A value with no parseable leading integer (dice like `"D6"`) is left unchanged with a
     diagnostic — never corrupted.
5. Return the datasheet with effective values so the web needs no render-logic change.

Home: `engine-eval` (it owns `EvalState`/conditions/scopes; `@muster/roster` stays
rules-free with no new dependency). `effectiveDatasheet` internally re-walks the subtree the
same cheap way `datasheet()` does, or takes `datasheet()`'s output + the roster as input
(implementation call — minimize duplication).

### 4. Web (`apps/web/src/components/Datasheet.tsx`)

`UnitStatline`/`WeaponTable`/the `Datasheet` body switch from `datasheet(catalogue,
selection)` to `effectiveDatasheet(catalogue, roster, selection.id)` (needs the whole roster
— conditions can reference force/roster scope; `App.tsx` already holds it → plumbing only).
The invuln chip (`invulnSave`) and loadout are unaffected. Render logic unchanged.

## Scope / non-goals (first slice)

**In:** numeric `set`/`increment`/`decrement` on Unit + Weapon characteristics, full
cross-entry target-scope resolution (unavoidable — the best examples are cross-entry),
conditional and unconditional, excluding Crusade content.
**Deferred:** `append`/`replace` text ops (cosmetic/no-op), `floor`/`ceil` (Crusade),
`Description` (Abilities) text swaps, all Crusade content, multiple-distinct-weapon-profile
broadcast UI polish (apply per matching profile; revisit rendering if a squad shows two
loadouts). Covers ≈100% of the non-Crusade, non-cosmetic characteristic content that shows
on a matched-play datasheet (~19,354 routing-gap drops on a code basis).

## Testing

- **Parser:** a `.cat`/JSON fixture with a cross-entry `set` Enhancement (mirroring Artificer
  Armour: an upgrade entry, `set Sv=2+`, `affects` the parent model's Unit profile) → the
  entry carries an `IrCharacteristicModifier {characteristic:"Sv", profileType:"Unit",
  kind:"set", value:"2+", targetScope:"model", recursive:true}`; a JSON twin for parity.
- **Eval:** `effectiveDatasheet` unit tests — `set` swaps a Unit char; `increment` on a weapon
  char reformats keeping the suffix; a condition-gated modifier applies only when its gate
  passes; a cross-entry modifier reaches the parent model's profile; a non-numeric target
  value is left unchanged + diagnosed; an unconditional multi-target (recursive) broadcast
  hits every matching profile.
- **Golden:** `mini40k` 10e golden byte-identical (no fixture uses these kinds); a NEW small
  fixture is added deliberately for the parser test.
- **Real-data:** repack SM 11e; drive the real builder — `Artificer Armour` → Unit Sv shows
  `2+`; `Heavy Jump Pack…` wargear → T/W/M change; `The Honour Vehement` → melee S/A +1;
  confirm base (unmodified) units are unchanged and a damaged-profile unit already shows two
  profiles (§0 sanity check).

## Risks

- **Cross-entry targeting correctness** is the crux — reuse `scopes.ts` anchor resolution;
  an unresolvable target/scope yields no application (never corrupts a value), with a
  diagnostic.
- **String value parsing**: only a leading integer is touched; unparseable values pass
  through unchanged + diagnosed. No characteristic is ever silently corrupted.
- **10e regression**: the new IR fields are additive/skip-empty; the byte-identical golden
  guards 10e output. The web switch to `effectiveDatasheet` must be a no-op for a unit with
  no characteristic modifiers (returns the same values as `datasheet()`).
