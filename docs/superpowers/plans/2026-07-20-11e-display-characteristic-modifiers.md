# 11e Display: Profile Characteristic Modifiers (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Datasheets show effective (modified) characteristics — Enhancement/wargear/ability stat changes (e.g. Artificer Armour → Sv 2+) — for both 11e and 10e, without touching points/legality.

**Architecture:** Option B (see spec: docs/superpowers/specs/2026-07-20-11e-display-characteristic-modifiers-design.md — implementers READ IT FIRST, plus the investigation scratchpad/11e-display-channel-design.md). Capture numeric characteristic modifiers on the OWNING `IrEntry` with an unresolved target spec; resolve lazily in engine-eval reusing scopes.ts anchor-walk; web renders effective values.

**Tech Stack:** Rust (quick-xml/serde JSON, cargo), TypeScript strict + Vitest + Zod, React.

## Global Constraints

- Domain schema = Rust↔TS contract; every field mirrored both sides + covered by golden/contract. New IR fields are optional / serde skip-if-empty → the 10e `mini40k` golden MUST stay byte-identical.
- First slice = numeric `set`/`increment`/`decrement` on Unit + Weapon characteristics only. `append`/`replace`/`floor`/`ceil` on characteristics stay dropped (unchanged). Crusade content excluded by virtue of not being taken in a matched-play roster (no special filter needed — a Crusade upgrade is just never selected).
- Never corrupt a characteristic: a value with no parseable leading integer for increment/decrement is left unchanged + diagnosed.
- engine-eval keeps 100% coverage. `@muster/roster` gains NO dependency on engine-eval.
- Faithful capture in the parser (light structuring of the `affects` path), resolution in eval — do not resolve targets in Rust.
- No push to origin. Merge to LOCAL main only.

---

### Task B1: IR schema + parser capture of numeric characteristic modifiers

**Files:**
- `packages/domain/src/ir.ts` (new `IrCharacteristicModifier`; `IrEntry.characteristicModifiers?`)
- `packages/engine-parser/src/ir/model.rs` (mirror), `packages/engine-parser/src/ir/map.rs` (`map_entry` new branch + `affects`-path structuring)
- `packages/engine-parser/src/raw/model.rs`, `raw/parse.rs` (XML), `raw/parse_json.rs` (JSON) — ensure `RawModifier` carries `scope` + `affects`
- Tests: `packages/engine-parser/tests/map.rs` (+ a new fixture), the XML/JSON parity twin

**Interfaces:**
- Produces `IrCharacteristicModifier { characteristic, profileType, kind: "set"|"increment"|"decrement", value: string, targetScope, targetEntryId?, recursive, conditions?, conditionGroups? }` and `IrEntry.characteristicModifiers`.

- [ ] **Step 1 (raw):** confirm/extend `RawModifier` to capture `scope` and `affects` strings; read them in `parse.rs` (XML attributes on `<modifier>`) and `parse_json.rs` (JSON `scope`/`affects` keys). Add a raw-parse test asserting both are captured. (`field`/`type`/`value`/`conditions` already captured.)
- [ ] **Step 2 (domain):** add `IrCharacteristicModifier` (Zod) and `IrEntry.characteristicModifiers: z.array(...).optional()`. Typecheck + domain tests.
- [ ] **Step 3 (Rust model):** mirror the struct in `model.rs` (serde, `#[serde(skip_serializing_if = "Vec::is_empty")]` on the entry field, `Option`/skip on `target_entry_id`). Keep `value` a `String`.
- [ ] **Step 4 (map TDD):** add a Rust fixture + failing test — an upgrade entry with a `set` modifier, `field`=the `Sv` characteristicType id, `scope="model"`, `affects="self.entries.recursive.<id>.profiles.Unit"` → assert the entry’s `characteristic_modifiers` contains `{characteristic:"Sv", profile_type:"Unit", kind:"set", value:"2+", target_scope:"model", target_entry_id:Some(<id>), recursive:true}` and NO `target_unmapped` diagnostic. Also assert an `append`/`replace` characteristic modifier is STILL dropped (unchanged). Run `cargo test` → FAIL.
- [ ] **Step 5 (map impl):** in `map_entry`, add a branch BEFORE the `target_unmapped` else: if `m.field` resolves to a characteristicType (decode via the existing id→name map; NOT a cost type, NOT a constraint id) AND `m.kind ∈ {set,increment,decrement}`, build an `IrCharacteristicModifier` — parse `affects` (`self.entries[.recursive][.<entryId>].profiles.<TypeName>`) into `target_scope` (from `scope`), `target_entry_id`, `recursive`, `profile_type` (the `<TypeName>`), `characteristic` (field→name); map `conditions`/`condition_groups` with the existing helpers; push onto the entry. Other kinds/fields fall through unchanged. Run `cargo test` → PASS; `mini40k` golden byte-identical.
- [ ] **Step 6 (JSON parity):** extend the twin parity fixture with a characteristic-modifier case so XML and JSON produce identical IR. Run the parity + json suites.
- [ ] **Step 7: commit** — `feat(11e): capture numeric characteristic modifiers on entries`.

---

### Task B2: engine-eval `effectiveDatasheet`

**Files:**
- `packages/engine-eval/src/characteristics.ts` (new), `packages/engine-eval/src/index.ts` (export), reuse `scopes.ts`/`conditions.ts`/`state.ts`
- Tests: `packages/engine-eval/test/characteristics.test.ts`

**Interfaces:**
- Consumes B1’s `IrEntry.characteristicModifiers`; the datasheet section shape from `@muster/roster` (`DatasheetSection`/`IrProfile`). Produces `effectiveDatasheet(catalogue: IrCatalogue, roster: Roster, selectionId: string): DatasheetSection[]`.

- [ ] **Step 1 (TDD):** failing tests for the algorithm (spec §3 / §Testing): `set` swaps a Unit char; `increment` on a weapon char reformats keeping suffix (`"10\""`+2→`"12\""`); a condition-gated modifier applies only when the gate passes; a cross-entry modifier (owning upgrade → parent model Unit profile) reaches the target; a non-numeric value (`"D6"` increment) is unchanged + diagnosed; a recursive broadcast hits every matching profile; a unit with NO characteristic modifiers returns values identical to `datasheet()`. Run `pnpm --filter @muster/engine-eval test` → FAIL.
- [ ] **Step 2 (impl):** implement `effectiveDatasheet`: build `EvalState` (`buildState`); collect all `characteristicModifiers` in the selection subtree keyed by owning `EvalNode`; gate each via existing condition machinery; resolve `targetScope`→anchor (reuse `scopes.ts` anchor-walk), take self-or-subtree per `recursive`, filter by `profileType` + optional `targetEntryId`; apply set/inc/dec with a leading-integer parse/reformat (`^(\d+)(.*)$`), leaving unparseable values unchanged + pushing a diagnostic; return the datasheet sections with effective values. Keep 100% coverage.
- [ ] **Step 3: commit** — `feat(11e): effectiveDatasheet applies characteristic modifiers`.

---

### Task B3: web wiring + real-data verification

**Files:**
- `apps/web/src/components/Datasheet.tsx` (switch to `effectiveDatasheet(catalogue, roster, selection.id)`; plumb `roster` from `App.tsx`), possibly `UnitDetail.tsx`/`App.tsx` for prop plumbing.
- Verification: scratchpad script (not committed).

- [ ] **Step 1:** thread the full `roster` to `Datasheet`/`UnitStatline`/`WeaponTable`; switch `datasheet(catalogue, selection)` → `effectiveDatasheet(catalogue, roster, selection.id)`. The invuln chip and loadout stay on their current calls. Typecheck + `pnpm --filter web test` (update any test that rendered a statline to pass a roster; a modifier-free unit must render identical values).
- [ ] **Step 2: commit** — `feat(web): render effective (modified) datasheet characteristics`.
- [ ] **Step 3 (real-data verify, not committed):** repack SM 11e (+ gamesystem); via the real builder + `effectiveDatasheet`, assert: `Artificer Armour` enhancement on a character → Unit `Sv` shows `2+`; a `Heavy Jump Pack…` wargear option → `T`/`W`/`M` change; `The Honour Vehement` → melee `S`/`A` +1; a plain unmodified unit is unchanged; a damaged-profile unit already shows two profiles. Record numbers in the ledger.

---

## Self-Review notes
- Spec coverage: B1 = IR+capture (spec §1–2); B2 = eval apply (spec §3); B3 = web+verify (spec §4/§Testing).
- Contract: IrCharacteristicModifier mirrored Rust↔TS; new fields skip-empty; `mini40k` 10e golden byte-identical; XML/JSON parity extended.
- No placeholders: IR shape + eval algorithm fully specified in the spec; the parser `affects`-path format is documented in the investigation report.
