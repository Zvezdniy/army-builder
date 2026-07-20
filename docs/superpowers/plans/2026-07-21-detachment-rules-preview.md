# Detachment rules + honest enhancement preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The setup wizard's detachment panel shows a detachment's actual rule text, and lists
every enhancement that detachment unlocks instead of an arbitrary one.

**Architecture:** Two independent defects behind one screen.

1. **Enhancement preview shows an arbitrary subset.** `enhancementsFor`
   (`apps/web/src/components/SetupWizard.tsx:20-33`) walks the entry tree and stops at the FIRST
   group whose name is `"<detachment> Enhancements"`. That group is linked from dozens of units,
   and — since `entryLink` inline content landed — each placement legitimately carries its own
   members. Measured on deployed 11e Space Wolves: *Legends of Saga and Song Enhancements* exists
   at **42 placements**; the first found has 1 member (*Thirst for Glory*), the union has 2
   (*Fierce Example* is declared on the Wolf Guard Terminators placement). *Saga of the Great Wolf
   Enhancements* has 39 placements and happens to hit a 4-member one first, which is why one
   detachment looked complete and the other did not. The panel is a preview of what the detachment
   unlocks, so it must show the UNION.

2. **A detachment's rule text never reaches the IR.** Upstream, the detachment entry carries its
   own `rules` — e.g. `Legends of Saga and Song` (in `Imperium - Space Marines.json`) has rule
   *Loping Charge*: "Friendly ADEPTUS ASTARTES TERMINATOR units have +1 to charge rolls…". The TEXT
   already survives: `read_all_rules` (`raw/parse.rs:592`) does a flat second pass over the whole
   file and folds every rule into `catalogue.rules` → `IrCatalogue.ruleTexts` (107 entries in the
   deployed Space Wolves catalogue, *Loping Charge* among them). What is dropped is the
   ASSOCIATION: nothing records that this entry owns that rule, so no consumer can find it. Fix by
   carrying the rule NAMES on the entry — the text stays in the single `ruleTexts` map, no
   duplication.

**Tech Stack:** Rust (engine-parser), TypeScript (@muster/domain, apps/web), Vitest, Zod.

## Global Constraints

- `mini40k` 10e golden: it declares rules, so this change MAY alter it. Regenerate it deliberately
  and state in the commit that the diff is only the new field; never regenerate to silence an
  unexplained diff.
- XML and JSON front-ends stay at parity: the same catalogue in either syntax yields the same IR.
- The new IR field is OPTIONAL and additive. Existing packed payloads without it must still load.
- Rule TEXT is not duplicated onto entries — entries carry names, `ruleTexts` carries bodies.
- `@muster/engine-eval` keeps its 100% coverage gate. If a change touches it, cover it.
- No GW data in git (`apps/web/public` is gitignored). Do NOT run `git stash` or `git add -A`.
- Do NOT run `scripts/update-catalogues.mjs` (~20 min); the controller repacks.

---

### Task 1: the enhancement preview shows every placement's members

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx` (`enhancementsFor`, lines 18-33)
- Test: `apps/web/src/components/SetupWizard.test.tsx`

**Interfaces:** `enhancementsFor(catalogue, detachmentName): IrEntry[]` — signature unchanged.

- [ ] **Step 1 (TDD):** add a failing test — a catalogue where TWO entries each carry a group named
  `"D Enhancements"`, the first with member `e1` only, the second with `e1` and `e2`. Assert the
  preview lists both `e1` and `e2`, each exactly once. Add a second test pinning order: members
  appear in first-encounter order, so an unchanged single-placement catalogue renders exactly as
  before. Run `pnpm --filter @muster/web test` → FAIL.

- [ ] **Step 2 (impl):** walk the WHOLE tree instead of stopping at the first match. Collect the
  member ids of every group with the wanted name, dedupe by entry id preserving first-encounter
  order, resolve through `catalogueEntry`, drop unresolvable ids as today. Keep the traversal
  iterative (the existing stack) — these trees are deep. Update the doc comment: it currently says
  "best-effort by group name"; say that the union across placements is the point, and why (each
  entryLink placement may add its own members).

- [ ] **Step 3:** run `pnpm --filter @muster/web test` → PASS.

- [ ] **Step 4: commit** — `fix(web): preview every enhancement a detachment unlocks`.

---

### Task 2: carry an entry's own rule names into the IR

**Files:**
- Modify: `packages/engine-parser/src/raw/model.rs` (`RawEntry`)
- Modify: `packages/engine-parser/src/raw/parse.rs` (the entry reader; `<rules>` inside an entry is
  currently skipped by the structural loop — see the comment at line 90)
- Modify: `packages/engine-parser/src/raw/parse_json.rs` (`JsonEntry.rules` already deserializes for
  `collect_rules`; keep the names on the mapped entry too)
- Modify: `packages/engine-parser/src/ir/model.rs`, `packages/engine-parser/src/ir/map.rs`
- Modify: `packages/domain/src/ir.ts` (`IrEntry`), `packages/domain/src/packed.ts` (`PackedEntry`)
- Test: the parse tests beside each front-end, the parity twin, `ir/map` tests, domain pack tests

**Interfaces:**

Produces, for Task 3 to consume:

```ts
// IrEntry, additive and optional
ruleNames?: string[];   // names of rules this entry declares; text lives in IrCatalogue.ruleTexts
```

```rust
// IrEntry (ir/model.rs)
pub rule_names: Vec<String>,
```

- [ ] **Step 1 (TDD, Rust):** failing XML parse test — a `selectionEntry` carrying
  `<rules><rule name="R1" …>` yields `rule_names == ["R1"]` on the mapped IR entry, and the rule
  TEXT still lands in `ruleTexts` exactly once (not duplicated onto the entry). Mirror it for JSON.
  Extend `tests/fixtures/parity/twin.{cat,json}` so both syntaxes prove the same `ruleNames`.
  Run `cargo test` → FAIL.

- [ ] **Step 2 (impl, Rust):** thread the names through raw → resolve → IR. A rule declared on an
  entryLink's inline content is OUT OF SCOPE — do not add it; if the reader encounters one, leave
  existing behaviour untouched. Order: declaration order, deduped.

- [ ] **Step 3 (impl, TS):** add the optional field to `IrEntry` and `PackedEntry` (a `z.object`
  strips unknown keys, so the packer will silently drop it if `PackedEntry` is not updated — add a
  pack/rehydrate round-trip test that would catch exactly that). Default `[]`.

- [ ] **Step 4:** `cargo test` and `pnpm turbo run test` → PASS. Regenerate the `mini40k` golden and
  confirm the ONLY diff is the new field.

- [ ] **Step 5: commit** — `feat(parser): carry an entry's own rule names into the IR`.

---

### Task 3: show the detachment's rules in the setup panel

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx` (the `det-preview` aside, lines 218-243)
- Modify: `apps/web/src/index.css` (styles for the new block)
- Test: `apps/web/src/components/SetupWizard.test.tsx`

**Interfaces:** consumes `IrEntry.ruleNames` from Task 2 and `IrCatalogue.ruleTexts`.

- [ ] **Step 1 (TDD):** failing test — a chosen detachment with `ruleNames: ["Loping Charge"]` and a
  catalogue `ruleTexts` entry for it renders the rule name AND its text inside that detachment's
  preview section. Second test: a detachment whose `ruleNames` is empty renders no rules block at
  all (no empty header). Third: a rule name with no matching `ruleTexts` entry renders the name
  without inventing text.

- [ ] **Step 2 (impl):** in each preview section, above the enhancements, render a rules block —
  the rule name as a heading and its text as a paragraph, preserving the source's line breaks
  (the real text carries `\n\n` and a "Restrictions:" paragraph). Keep the existing
  `Enhancements` sub-heading so the two blocks are distinguishable; today the section header is
  just the detachment name and the enhancement lines follow it bare.

- [ ] **Step 3:** run `pnpm --filter @muster/web test` → PASS.

- [ ] **Step 4: commit** — `feat(web): show a detachment's rules in the setup panel`.

---

### Task 4: real-data verification (controller, not committed)

- [ ] Repack, then confirm on real 11e Space Wolves: *Legends of Saga and Song* previews BOTH
  *Thirst for Glory* and *Fierce Example*, and shows *Loping Charge* with its text; *Saga of the
  Great Wolf* still previews its four. Walk the owner's path in the browser.
