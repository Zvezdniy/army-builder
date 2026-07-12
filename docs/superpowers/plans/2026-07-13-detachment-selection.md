# Detachment Selection & Setup Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Matched-play army setup (points → faction placeholder → detachment) plus a
working enhancement detachment-gate: map group hidden gates onto flattened member
entries and map `field="forces"` (evaluated as 0), so gates survive and resolve.

**Architecture:** 5 packages, in dependency order — domain (`forces` enum), engine-eval
(`forces` aggregate = 0), engine-parser (map `forces` + push group hidden-gate to
members + golden), roster (detachment/points API), web (wizard + setup-bar).

**Tech Stack:** TS (strict, ESM, Vitest, vite-tsconfig-paths — tests run against source),
Rust (quick-xml/serde, `#![forbid(unsafe_code)]`, clippy -D warnings, byte-identical
golden), React 18 + Vite (jsdom Vitest).

## Global Constraints

- Never over-hide: a hidden gate with any unmappable condition is dropped whole (parser),
  with a diagnostic — never partially represented.
- Parser golden test is byte-identical; regenerate the expected fixture when output changes.
- 100% coverage bar on domain, engine-eval, roster (excl. their `src/index.ts`).
- Matched-play only; `forces` count is 0 (no force nodes in our roster model).
- Detachment = a normal roster selection (root "Detachment" upgrade + one chosen child).
- Code/identifiers/comments in English.

---

### Task 1: `forces` field end-to-end in TS (domain + engine-eval)

**Files:**
- Modify: `packages/domain/src/conditions.ts`
- Modify: `packages/engine-eval/src/scopes.ts`
- Test: `packages/domain/src/conditions.test.ts` (create if absent), `packages/engine-eval/test/scopes.test.ts` (or existing conditions/visibility test)

**Interfaces:**
- Produces: `IrCondition.field` and `AggregateSpec.field` include `"forces"`;
  `aggregate(node, spec, state)` returns `0` when `spec.field === "forces"`.

- [ ] **Step 1: Failing domain test** — `IrCondition.parse` accepts `field: "forces"`.
- [ ] **Step 2: Widen domain enum** — `field: z.enum(["selections", "points", "forces"])`.
- [ ] **Step 3: Failing engine test** — build a small catalogue where an entry carries a
  `visibilityModifier` `set hidden=true WHEN and(forces X < 1, selections DET < 1)` (roster
  scope). Assert: with no DET selection in the roster → entry hidden; with DET selected →
  not hidden. (This mirrors the pushed-down gate the parser will emit.)
- [ ] **Step 4: Widen `AggregateSpec.field`** to include `"forces"`; in `aggregate`, when
  `spec.field === "forces"` return `0` before the selections/points branches.
- [ ] **Step 5: Run** `pnpm --filter @muster/domain --filter @muster/engine-eval test` — green, 100%.
- [ ] **Step 6: Commit** `feat(domain,engine-eval): map field="forces" (0 in forceless roster)`.

---

### Task 2: parser — map `forces` + push group hidden-gate to members

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs`
- Test: `packages/engine-parser/tests/map.rs` (or inline `#[cfg(test)]` in map.rs, matching existing style)
- Golden: regenerate the byte-identical expected fixture.

**Interfaces:**
- Consumes: `map_visibility_modifier`, `flatten_group_members`, `map_entry`.
- Produces: `map_field` returns `Some("forces")` for `field=="forces"`; each flattened
  group member gains the group's mapped `field="hidden"` modifiers in `visibility_modifiers`.

- [ ] **Step 1: Failing test — `forces` maps.** A condition with `field="forces"` on a
  hidden modifier survives (member/entry gets the visibility modifier, not dropped).
- [ ] **Step 2: `map_field` handles forces** — add `if field == "forces" { return Some("forces".into()); }` before the unmapped diagnostic.
- [ ] **Step 3: Failing test — group gate pushes to members.** A `selectionEntryGroup` with
  a `set hidden=true` modifier (conditions map) → each flattened member entry's
  `visibility_modifiers` contains that gate (in addition to any own gate). A member whose
  own gate exists keeps both. An unmappable group gate is dropped (member unchanged) with a diagnostic.
- [ ] **Step 4: Implement push-down.** In `map_entry`'s group loop, before/at
  `flatten_group_members`, map the group's `field="hidden"` modifiers via
  `map_visibility_modifier` (drop-whole-on-unmappable, emit `modifier.hidden_condition_unmapped`
  diagnostic on None), and append the resulting `IrVisibilityModifier`s to each member entry
  produced for that group (recursively for nested sub-groups — parent gate also applied to
  sub-group members). Implement by threading the accumulated group gates into
  `flatten_group_members` and appending to each mapped member.
- [ ] **Step 5: Run** `cargo test -p engine-parser` — fails only on golden mismatch.
- [ ] **Step 6: Regenerate golden** per its documented mechanism; verify diff is only the
  expected added `forces`/pushed-down gates; re-run `cargo test -p engine-parser` green.
- [ ] **Step 7:** `cargo clippy -p engine-parser -- -D warnings` clean.
- [ ] **Step 8: Commit** `feat(parser): map forces + push group hidden gates to members`.

---

### Task 3: roster — detachment + points API

**Files:**
- Modify: `packages/roster/src/builder.ts`
- Test: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Consumes: `createRoster`, `addUnit`, `addOption`, `remove`, `catalogueEntry`, `Roster`, `IrEntry`.
- Produces:
  - `availableDetachments(catalogue): IrEntry[]` — children of the root "Detachment" entry, `[]` if none.
  - `selectedDetachment(roster, catalogue): string | undefined`.
  - `setDetachment(roster, detachmentEntryId, catalogue): Roster` — ensure exactly one
    "Detachment" selection with one chosen child; idempotent; swap replaces child.
  - `setPointsLimit(roster, pointsLimit): Roster`.
- Helper (private): `detachmentRoot(catalogue): IrEntry | undefined` — first `catalogue.entries`
  entry with `name === "Detachment"` and `type === "upgrade"`.

- [ ] **Step 1: Failing tests** — `availableDetachments` returns the option children;
  `[]` when no root Detachment. `setDetachment` adds a Detachment selection with one child;
  calling again with a different id swaps the child (no duplicate Detachment selection, one child).
  `selectedDetachment` reflects the chosen child id / undefined. `setPointsLimit` sets the limit.
- [ ] **Step 2: Implement** the four exports + `detachmentRoot` helper (immutable updates,
  matching existing builder style — structural clones, fresh ids via the existing id scheme).
- [ ] **Step 3: Run** `pnpm --filter @muster/roster test` — green, 100%.
- [ ] **Step 4: Commit** `feat(roster): detachment selection + points-limit API`.

---

### Task 4: web — setup wizard (Variant A) + setup-bar

**Files:**
- Create: `apps/web/src/components/SetupWizard.tsx`, `apps/web/src/components/SetupBar.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/index.css`
- Test: `apps/web/src/components/SetupWizard.test.tsx`, `apps/web/src/App.test.tsx`

**Interfaces:**
- Consumes: `availableDetachments`, `selectedDetachment`, `setDetachment`, `setPointsLimit`.
- Behavior: wizard steps points → faction (placeholder: current active, others disabled
  "Library soon") → detachment (list + enhancement preview). Auto-open when
  `selectedDetachment === undefined` AND `availableDetachments.length > 0`. Collapses to a
  3-chip setup bar under the header; each chip reopens the wizard on its step. Detachment
  step + chip hidden when `availableDetachments` is empty (mini fixture stays working).

- [ ] **Step 1: Failing component test** — wizard renders 3 steps; choosing a detachment
  calls `setDetachment`; setPointsLimit on points step; a chip click reopens the wizard;
  detachment step absent when `availableDetachments` is empty.
- [ ] **Step 2: Implement `SetupWizard`** (reuse `.picker` vocabulary widened; steps; pills
  for points; faction placeholder cards; detachment cards + enhancement preview via the
  `"<name> Enhancements"` group name match).
- [ ] **Step 3: Implement `SetupBar`** (3 chips: points · faction · detachment; onClick → open wizard at step).
- [ ] **Step 4: Wire into `App.tsx`** — setup state, auto-open, handlers; keep the existing
  builder untouched below. Add CSS from the mockup tokens.
- [ ] **Step 5: Run** `pnpm --filter @muster/web test` — green (existing builder tests stay green).
- [ ] **Step 6: Commit** `feat(web): army setup wizard + setup bar`.

---

## Verification (after all tasks)

- [ ] `pnpm turbo run test` full green; `cargo test -p engine-parser` + `cargo clippy` clean.
- [ ] Browser: load real Space Marines packed IR; run setup; pick Gladius → a character's
  `UnitConfig` shows only Gladius enhancements; switch to Anvil → set changes. Screenshot.

## Self-Review notes

- Spec coverage: forces (T1,T2), group-gate pushdown (T2), roster API (T3), wizard/setup-bar
  + placeholder faction + empty-detachment guard (T4). Legality ≤3 enhancements is out of scope.
- Type consistency: `IrCondition.field` / `AggregateSpec.field` widened together (T1) to keep
  engine-eval compiling. Roster export names match the spec exactly.
