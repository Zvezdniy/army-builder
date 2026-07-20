# 11e Detachment Points (Sub-project D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In 11th edition an army can take several detachments within a Detachment Points budget; in 10th edition it still takes exactly one — with no edition check anywhere in the code.

**Architecture:** See the spec `docs/superpowers/specs/2026-07-20-detachment-points-design.md` — implementers READ IT FIRST. Fix the parser's cost-type naming so `Detachment Points` survives as its own cost type, let the existing force-constraint machinery enforce the cap, and drive detachment selection through the existing group machinery so the `max 1` group constraint (present in 10e, removed in 11e) decides swap-vs-accumulate.

**Tech Stack:** Rust (cargo), TypeScript strict + Vitest + Zod, React.

## Global Constraints

- **No edition conditionals in app or roster code.** The 10e/11e difference must come from the data (the `Detachment` group's `max 1`). A branch on edition id is a design failure here.
- The `mini40k` 10e golden MUST stay byte-identical; XML/JSON parity maintained.
- `@muster/engine-eval` keeps 100% coverage. `@muster/roster` stays rules-free.
- Rules overrides live ONLY in `packages/engine-eval/src/data-corrections.ts`. No override may be scattered elsewhere.
- The wizard must not re-implement legality: it may display over-budget, it must not block on it.
- No GW data in git (apps/web/public is gitignored). Do NOT run `git stash` or `git add -A`.
- Do NOT run `scripts/update-catalogues.mjs` (clones repos + builds Rust, ~20 min); the controller handles repacking.

---

### Task D1: parser — honest cost-type names + keep the cap constraint

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs` (three `contains("point")` sites: the constraint-field namer ~line 471, its helper ~line 532, the cost namer ~line 980; plus `map_force_constraints` ~line 34)
- Tests: `packages/engine-parser/tests/map.rs` (+ fixture), the XML/JSON parity twin

**Interfaces:**
- Produces `IrCost.name == "Detachment Points"` (and `"Crusade Points"`) instead of `"points"`, and an `IrConstraint { field: "Detachment Points", targetType: "force", scope: "force" }` on the catalogue's `forceConstraints`.

- [ ] **Step 1 (TDD):** add a failing Rust test with a fixture declaring three cost types — `pts`, `Detachment Points`, `Crusade Points` — and an entry carrying all three, plus a forceEntry with `max 2` on the Detachment Points type (`scope="parent"`) and `max 0` on `pts` (`scope="parent"`). Assert: the entry's costs are named `points` (from `pts`), `Detachment Points`, `Crusade Points`; the force constraints contain exactly one entry, `{field: "Detachment Points", type: "max", value: 2, scope: "force", targetType: "force"}`; the `pts` one is still dropped with the existing `constraint.force_points_sentinel_skipped` diagnostic. Run `cargo test` → FAIL.

- [ ] **Step 2 (impl, naming):** replace the predicate at all three sites. A cost type is the points cost iff `type_id == "pts"` OR `type_name.trim().to_lowercase()` is exactly `"pts"` or `"points"`. Extract it as ONE shared helper (e.g. `fn is_points_cost_type(type_id: &str, type_name: &str) -> bool`) and call it from all three — three copies of a subtly-wrong predicate is what caused this bug.

- [ ] **Step 3 (impl, scope):** in `map_force_constraints`, normalize a force-level constraint whose scope is `parent` to `force` (a constraint declared on a forceEntry has that force as its parent), with a comment saying so. Leave category-link constraints alone.

- [ ] **Step 4:** run `cargo test` → PASS. Verify the `mini40k` golden is byte-identical (its cost type is literally named `points`, so it must be). Extend the XML/JSON parity fixture with the new cost types.

- [ ] **Step 5: commit** — `fix(11e): keep Detachment Points a distinct cost type`.

---

### Task D2: eval — the cap, with the upstream-data correction isolated

**Files:**
- Create: `packages/engine-eval/src/data-corrections.ts`
- Modify: the force-constraint check path (`constraints.ts` / `evaluate.ts` — follow the existing call chain), `packages/engine-eval/src/index.ts` (export)
- Tests: `packages/engine-eval/test/data-corrections.test.ts` and the existing force-constraint tests

**Interfaces:**
- Consumes D1's `IrConstraint { field: "Detachment Points", targetType: "force" }`. Produces `correctedConstraintValue(constraint): number`.

- [ ] **Step 1 (TDD):** failing tests — a force constraint on `Detachment Points` with value 2 evaluates as 3; with value 4 stays 4; a constraint on `Enhancements` with value 2 stays 2; an army of 3 DP + 2 DP is illegal at the corrected cap while 2 DP + 1 DP is legal. Run `pnpm --filter @muster/engine-eval test` → FAIL.

- [ ] **Step 2 (impl):** `data-corrections.ts` exports a single function applying `Math.max(value, 3)` to a force constraint whose `field` is `Detachment Points`. Document at the top: the upstream inconsistency (game system revision 4 caps DP at 2 while Gladius alone costs 3), that the owner confirmed the rule is 3, and that this file must be deleted once upstream publishes a cap of 3+. Apply it at the single point where a force constraint's value is read. Keep 100% coverage.

- [ ] **Step 3: commit** — `fix(11e): floor the Detachment Points cap at 3 while upstream is wrong`.

---

### Task D3: roster — detachments through the group machinery

**Files:**
- Modify: `packages/roster/src/builder.ts` (`selectedDetachment`, `setDetachment`, exports), `packages/roster/src/index.ts`
- Tests: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Produces `selectedDetachments(roster, catalogue): string[]`, `toggleDetachment(roster, entryId, catalogue): Roster`. `selectedDetachment` is retained as `selectedDetachments(...)[0]`.

- [ ] **Step 1 (TDD):** failing tests using two fixture catalogues — one whose `Detachment` group has `max 1` (10e shape) and one with only `min 1` (11e shape). Assert: on the `max 1` fixture, toggling a second detachment REPLACES the first (`selectedDetachments` stays length 1); on the no-max fixture, it ACCUMULATES (length 2, in selection order); toggling an already-selected detachment removes it; the root `Detachment` selection is created once and reused, never duplicated; `selectedDetachment` still returns the first id. Run `pnpm --filter @muster/roster test` → FAIL.

- [ ] **Step 2 (impl):** implement both functions in terms of the existing `toggleGroupMember` against the root `Detachment` entry's `Detachment` group, creating the root selection when absent. Do NOT special-case any edition, group name aside. Keep `detachmentSelectionIds` working (it already walks the whole root subtree).

- [ ] **Step 3:** update `apps/web` call sites minimally so the workspace typechecks (the real UI work is D4). Run the roster and web suites.

- [ ] **Step 4: commit** — `feat(roster): allow as many detachments as the data permits`.

---

### Task D4: web — multi-select detachments + the DP budget meter

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx`, `apps/web/src/App.tsx`, `apps/web/src/components/SetupBar.tsx` (it displays the chosen detachment), `apps/web/src/index.css`
- Tests: `apps/web/src/components/SetupWizard.test.tsx`, `SetupBar.test.tsx`

- [ ] **Step 1 (TDD):** failing tests — with an 11e-shaped fixture (priced detachments, no group max) selecting two detachments shows both as chosen and the meter reads the summed DP over the cap; with a 10e-shaped fixture (unpriced, `max 1`) the step behaves exactly as today and NO meter renders; over-budget renders a warning state but the "Start building" button stays enabled (legality is the engine's job).
- [ ] **Step 2 (impl):** the Detachment step's cards become toggles bound to `toggleDetachment`; the enhancements preview follows the selected set (show each chosen detachment's group). Render the meter only when the catalogue prices detachments — derive `used` by summing each chosen entry's `Detachment Points` cost and `cap` from the catalogue's force constraint on that field (via engine-eval, not a re-implementation). `SetupBar` shows the chosen detachments joined, not just the first.
- [ ] **Step 3:** typecheck + build + `pnpm --filter web test`.
- [ ] **Step 4: commit** — `feat(web): pick several detachments within the DP budget`.

---

### Task D5: real-data verification (controller, not committed)

- [ ] Repack 11e + 10e Space Marines, then in the browser: Gladius (3 DP) alone legal; Gladius + Anvil (5 DP) flagged; Anvil + Unforgiven (4 DP) flagged; two 1-DP detachments legal; the meter matches; 10e Space Marines still takes exactly one detachment. Record results in the ledger.

---

## Self-Review notes
- Spec coverage: D1 = spec §1–2, D2 = §3, D3 = §4 (roster), D4 = §4 (web), D5 = the spec's real-data testing.
- The "no edition conditionals" constraint is what makes D3/D4 correct; both tasks pin it with a 10e-shaped and an 11e-shaped fixture rather than trusting review.
- Naming consistency: the cost type is `Detachment Points` verbatim in the parser, the correction, the roster and the meter.
