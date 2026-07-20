# 11e Detachment Points (Sub-project D) — Design

**Date:** 2026-07-20
**Status:** Approved (design; backend mechanics decided autonomously per project workflow.
The one product decision — how to read a cap the upstream data currently gets wrong — was
put to the owner and answered: read it from the data, with a floor of 3.)
**Scope:** engine-parser (`ir/map.rs`), `@muster/engine-eval`, `@muster/roster`, `apps/web`.

In 11th edition a detachment costs **Detachment Points** (1–3 DP) and an army may take
**several** detachments up to a DP budget. Muster models the 10th-edition rule instead —
exactly one detachment, chosen by radio button. This makes 11e army building wrong at the
army-configuration level.

## Findings — the data says exactly what the owner said

| | 10e | 11e |
|---|---|---|
| `Detachment` group constraints | `min 1` **+ `max 1`** | `min 1` — **the `max` is gone** |
| Detachment cost | none | **Detachment Points**: Gladius 3, Unforgiven 2, Anvil Siege 2 |
| Army-wide cap | — | `Army Roster` forceEntry: `max N` on the Detachment Points cost type |

So the "exactly one detachment" rule is *not* a UI convention to re-code per edition — it is
the `max 1` group constraint that 11e deliberately removed and replaced with a cost budget.

**Root cause of every symptom: one greedy heuristic in the parser.** `ir/map.rs` decides
whether a cost type is *the* points cost with `type_name.to_lowercase().contains("point")`
(three call sites: the constraint-field namer, its helper, and the cost namer). That matches
`pts` — correctly — but *also* `Detachment Points` and `Crusade Points`, collapsing all of
them onto the reserved IR name `points`. Two consequences, both silent:

1. Gladius's 3 DP lands in the IR as `points: 3`, indistinguishable from battle points and
   therefore unusable.
2. The DP cap constraint's `field` also becomes `points`, so it is then deleted by the
   points-sentinel guard added in sub-project A — a guard written to drop BattleScribe's
   inert `max 0 pts` accounting rows. **The real rule is destroyed by a rule meant to remove
   fake ones.**

Points totals are nevertheless correct today, by luck: `pointsCost` prefers `pts` and only
falls back to `points`, and every real entry carries a `pts` cost.

**Upstream data is inconsistent.** Game system revision 4 caps Detachment Points at **2**
while Gladius alone costs **3** — as published, no 3-DP detachment could ever be legal. The
owner confirms the rule is 3. Resolution (their decision): take the cap from the data but
apply a **floor of 3**, marked in code as a temporary correction, so the app is right today
and automatically follows upstream once it is fixed.

## Design

### 1. Parser — stop collapsing distinct cost types onto `points`

A cost type is the points cost **iff** its id is `pts` or its resolved name, lowercased and
trimmed, is exactly `pts` or `points`. Every other cost type keeps its real name. This is a
narrowing of an existing predicate applied at all three sites, not new machinery — sub-project
A already widened `IrConstraint.field` to carry a cost-type name.

Effect on 10e: `Crusade Points` stops being reported as `points`. Nothing reads it (Crusade
costs never accrue in matched play), and `pointsCost` already prefers `pts`, so scoring is
unchanged. The `mini40k` golden fixture names its cost type literally `points`, so the golden
stays byte-identical.

### 2. Parser — keep the force constraint that carries the cap

The DP constraint sits on the `Army Roster` forceEntry with `scope: "parent"`. For a
constraint declared *on* a force, "parent" denotes that force, so `map_force_constraints`
normalizes `parent` → `force` for force-level constraints. Once §1 lands, its `field` is
`Detachment Points`, so the points-sentinel guard no longer touches it, and A1's existing
`costOfType` aggregation evaluates it unchanged.

### 3. Eval — the upstream-data correction, isolated

A new `packages/engine-eval/src/data-corrections.ts` holds exactly one exported rule:
a force constraint on `Detachment Points` gets `value = Math.max(value, 3)`. It is applied
where force constraints are checked, is unit-tested, carries the upstream reference and the
condition for deleting it, and is the **only** place a rules override may live — so it cannot
quietly spread through the engine.

### 4. Roster + web — let the data decide how many detachments

The bespoke single-detachment API (`setDetachment` swaps; `selectedDetachment` returns one id)
hardcodes the 10e rule. Replace it with the **existing group machinery**: the detachment
options are the members of the root `Detachment` entry's `Detachment` group, and
`toggleGroupMember` already swaps on a `max 1` group and accumulates when there is no max.
Then 10e keeps behaving exactly as today and 11e allows several detachments **without an
edition check anywhere in the code** — the difference is the data, which is the whole point of
this codebase.

- `selectedDetachments(roster, catalogue): string[]` replaces the singular accessor;
  `selectedDetachment` stays as a thin "first of" wrapper for existing callers.
- `setDetachment` becomes `toggleDetachment`, delegating to `toggleGroupMember`, still
  creating the root `Detachment` selection when absent.
- The wizard's Detachment step renders multi-select cards and, when the catalogue prices
  detachments, a **DP budget meter** (`used / cap`). Over-budget is shown but not blocked —
  legality is the engine's job and already surfaces in the legality panel; the wizard never
  becomes a second, divergent rules implementation.

## Scope / non-goals

**In:** honest cost-type names; the cap constraint surviving to eval; the floor-3 correction;
multi-detachment selection driven by group constraints; the DP budget meter.
**Out:** per-detachment enhancement scoping (which detachment an enhancement belongs to);
Crusade DP rules; showing DP in the roster export; any edition-conditional branch in app code.

## Testing

- **Parser:** a fixture with cost types `pts`, `Detachment Points` and `Crusade Points` →
  only `pts` maps to `points`, the others keep their names; a force constraint on
  `Detachment Points` survives while a `max 0 pts` one is still dropped; `scope: parent` on a
  force constraint normalizes to `force`. `mini40k` golden byte-identical; XML/JSON parity.
- **Eval:** the floor correction (data 2 → 3; a hypothetical data 4 stays 4; other cost types
  untouched); a 2 + 2 DP pair is illegal at cap 3 while 2 + 1 is legal.
- **Roster:** `toggleDetachment` swaps on a `max 1` group (10e) and accumulates without one
  (11e); `selectedDetachments` returns them in selection order; the root selection is created
  once and reused.
- **Web:** the step renders multiple chosen detachments; the meter shows used/cap; with a
  10e catalogue the step behaves exactly as before (regression guard).
- **Real data:** 11e Space Marines — Gladius (3 DP) alone is legal; Gladius + Anvil (5 DP) is
  flagged; Anvil + Unforgiven (4 DP) is flagged; two 1-DP detachments are legal. 10e Space
  Marines still allows exactly one detachment.

## Risks

- **10e regression is the main one** — the app's detachment flow is shared. The group-driven
  design means 10e's behaviour is enforced by its own `max 1` constraint; the regression guard
  is an explicit 10e test plus the byte-identical golden.
- **The floor is a lie with a shelf life.** Isolated to one file with the removal condition
  written down, and it only ever raises a cap, so it can never make an illegal army look legal
  beyond 3 DP.
- **Renaming cost types changes real 10e output.** Verified inert: nothing reads `points` when
  `pts` is present, which is true for every real entry.
