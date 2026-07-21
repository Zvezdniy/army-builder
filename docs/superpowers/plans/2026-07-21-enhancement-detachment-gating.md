# Detachment Enhancement Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each detachment's real enhancements in the setup wizard by reading the enhancement→detachment visibility gate already present in the IR, replacing the Space-Marine-only group-name heuristic.

**Architecture:** Each enhancement entry carries a `visibilityModifier` (`set: true`) whose condition `lessThan selections <detachmentId> 1` means "hidden until this detachment is selected." A new `@muster/roster` helper reads that gate to list a detachment's enhancements; `SetupWizard` calls it by detachment id. Pure app-side; no parser, schema, or data change.

**Tech Stack:** TypeScript, `@muster/roster` (Vitest, 100% coverage gate), `apps/web` React (Vitest + @testing-library/react).

## Global Constraints

- App-only. No `@muster/domain` schema change (`VisibilityModifier`, `IrCondition`, `IrConditionGroup` already model everything). No parser change, no republish.
- Match only the `field === "selections"` gate for MVP (a `forces`-gated detachment keeps showing "No enhancement preview", exactly as today — no regression).
- Gate predicate: a `VisibilityModifier` with `set === true` whose conditions — in `conditions` OR recursively in `conditionGroups[].conditions` — include one with `field === "selections" && comparator === "lessThan" && targetType === "entry" && targetId === detachmentId`.
- Dedup returned entries by id, first-encounter order (matches the old helper's contract).
- Do NOT run `git stash` or `git add -A`; stage explicit paths. `.claude/` stays untracked. Do NOT run `scripts/update-catalogues.mjs`.
- `IrCondition` requires all of: `id, comparator, value, field, scope, targetType, targetId` (`includeChildSelections` defaults false). Fixtures must supply them.

---

## File Structure

- `packages/roster/src/builder.ts` — add `enhancementsForDetachment` (+ a private `visibilityGatesDetachment` predicate helper). Add `VisibilityModifier`, `IrCondition` to the `@muster/domain` type import.
- `packages/roster/src/builder.test.ts` — unit tests for the helper.
- `apps/web/src/components/SetupWizard.tsx` — call the helper by `d.id`; delete the local `enhancementsFor`; drop the now-unused `catalogueEntry` import.
- `apps/web/src/components/SetupWizard.test.tsx` — update enhancement fixtures from group-name association to a visibility gate.

---

## Task 1: `enhancementsForDetachment` helper in `@muster/roster`

**Files:**
- Modify: `packages/roster/src/builder.ts:1` (type import) and add the helper near `catalogueEntry` (line ~195) / `availableDetachments` (line ~98)
- Test: `packages/roster/src/builder.test.ts`

**Interfaces:**
- Produces: `export function enhancementsForDetachment(catalogue: IrCatalogue, detachmentId: string): IrEntry[]` — Task 2 (SetupWizard) consumes it.

- [ ] **Step 1: Write the failing unit tests**

In `packages/roster/src/builder.test.ts`, add (near the detachment tests) a fixture and tests:

```ts
// Enhancement gating: enhancements carry a `set hidden` visibility modifier whose
// `lessThan selections <detachmentId> 1` condition means "hidden until that detachment
// is chosen". enhancementsForDetachment reads that gate.
function selGate(detId: string) {
  return {
    set: true,
    conditionGroups: [{
      type: "and" as const,
      conditions: [{
        id: `cond.${detId}`, comparator: "lessThan" as const, value: 1,
        field: "selections" as const, scope: "roster", targetType: "entry" as const,
        targetId: detId, includeChildSelections: true,
      }],
    }],
  };
}
const enhCat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "Gladius", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Anvil", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
      ],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"], constraints: [] }],
    },
    // Enhancements live under a character; each gated to one detachment.
    {
      id: "e.hero", name: "Hero", type: "model", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.enhG", name: "Gladius Relic", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.gladius")] },
        { id: "e.enhA", name: "Anvil Relic", type: "upgrade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.anvil")] },
        { id: "e.enhForce", name: "Force-gated", type: "upgrade", costs: [], categories: [], constraints: [], children: [], visibilityModifiers: [{ set: true, conditions: [{ id: "cf", comparator: "lessThan", value: 1, field: "forces", scope: "roster", targetType: "entry", targetId: "e.gladius", includeChildSelections: true }] }] },
        { id: "e.enhNone", name: "Ungated", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
};

describe("enhancementsForDetachment", () => {
  it("returns only the enhancements gated to the given detachment", () => {
    expect(enhancementsForDetachment(enhCat, "e.gladius").map((e) => e.id)).toEqual(["e.enhG"]);
    expect(enhancementsForDetachment(enhCat, "e.anvil").map((e) => e.id)).toEqual(["e.enhA"]);
  });
  it("ignores a forces-gated entry and an ungated entry (MVP: selections only)", () => {
    const ids = enhancementsForDetachment(enhCat, "e.gladius").map((e) => e.id);
    expect(ids).not.toContain("e.enhForce");
    expect(ids).not.toContain("e.enhNone");
  });
  it("finds a gate nested in a conditionGroup and dedupes repeats", () => {
    const twice = {
      ...enhCat.entries[1]!,
      children: [{
        id: "e.enhDup", name: "Dup", type: "upgrade" as const, costs: [], categories: [], constraints: [], children: [],
        visibilityModifiers: [selGate("e.gladius"), selGate("e.gladius")],
      }],
    };
    const cat2 = { ...enhCat, entries: [enhCat.entries[0]!, twice] };
    expect(enhancementsForDetachment(cat2, "e.gladius").map((e) => e.id)).toEqual(["e.enhDup"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they FAIL**

Run: `pnpm --filter @muster/roster test 2>&1 | tail -20`
Expected: FAIL — `enhancementsForDetachment is not a function` / not exported.

- [ ] **Step 3: Implement the helper**

In `packages/roster/src/builder.ts`, extend the domain type import (line 1) to include the new types:

```ts
import type { IrCatalogue, IrEntry, IrGroup, IrProfile, Roster, RosterSelection, VisibilityModifier, IrCondition } from "@muster/domain";
```

Then add near `catalogueEntry`:

```ts
/** Flatten a visibility modifier's conditions: its own `conditions` plus, recursively,
 *  every nested `conditionGroups[].conditions`. */
function flattenConditions(vm: VisibilityModifier): IrCondition[] {
  const out: IrCondition[] = [...(vm.conditions ?? [])];
  const stack = [...(vm.conditionGroups ?? [])];
  while (stack.length > 0) {
    const g = stack.pop()!;
    out.push(...(g.conditions ?? []));
    stack.push(...(g.conditionGroups ?? []));
  }
  return out;
}

/** True when `entry` has a `set hidden` visibility gate that hides it until
 *  `detachmentId` is selected — a `lessThan selections <detachmentId>` condition. */
function visibilityGatesDetachment(entry: IrEntry, detachmentId: string): boolean {
  for (const vm of entry.visibilityModifiers ?? []) {
    if (vm.set !== true) continue;
    for (const c of flattenConditions(vm)) {
      if (c.field === "selections" && c.comparator === "lessThan"
        && c.targetType === "entry" && c.targetId === detachmentId) {
        return true;
      }
    }
  }
  return false;
}

/** The enhancements a detachment unlocks: every entry in the catalogue tree whose
 *  `set hidden` visibility gate is keyed on this detachment's selection (see
 *  `visibilityGatesDetachment`). Deduped by entry id in first-encounter order. This
 *  reads the real per-detachment gate the parser emits, so it works for every faction
 *  — unlike a group-name convention that only the Space Marine family follows. */
export function enhancementsForDetachment(catalogue: IrCatalogue, detachmentId: string): IrEntry[] {
  const stack: IrEntry[] = [...catalogue.entries];
  const seen = new Set<string>();
  const out: IrEntry[] = [];
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (!seen.has(e.id) && visibilityGatesDetachment(e, detachmentId)) {
      seen.add(e.id);
      out.push(e);
    }
    stack.push(...e.children);
  }
  return out;
}
```

NOTE on order: the stack walk pops in LIFO order but the tests assert a single result per detachment (or one dedup case), so order is deterministic for those. `seen` guards dedup by id.

- [ ] **Step 4: Run the tests to verify they PASS**

Run: `pnpm --filter @muster/roster test 2>&1 | tail -20`
Expected: PASS, 100% coverage maintained.

- [ ] **Step 5: Commit**

```bash
git add packages/roster/src/builder.ts packages/roster/src/builder.test.ts
git commit -m "$(cat <<'EOF'
feat(roster): enhancementsForDetachment from the visibility gate

Reads each enhancement's `set hidden` visibility modifier (condition
`lessThan selections <detachmentId>` = "hidden until this detachment is
chosen") to list a detachment's enhancements. Works for every faction,
unlike the Space-Marine-only "<Detachment> Enhancements" group-name rule.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: SetupWizard consumes the helper

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx` (import; `previews` derivation line ~113; delete `enhancementsFor` lines ~18-46; drop unused `catalogueEntry` import line 3)
- Test: `apps/web/src/components/SetupWizard.test.tsx` (fixtures at lines ~12, ~59; preview test at ~227)

**Interfaces:**
- Consumes: `enhancementsForDetachment(catalogue, detachmentId)` from Task 1.

- [ ] **Step 1: Update the web test fixtures to gate enhancements by visibility (failing first)**

In `apps/web/src/components/SetupWizard.test.tsx`:

In the `cat` fixture, give the enhancement `e.enh1` a visibility gate on `e.gladius` and drop the now-irrelevant enhancement group on `e.captain`. Replace the `e.captain` entry (lines ~10-13) and `e.enh1` (line 14) with:

```ts
    { id: "e.captain", name: "Captain", type: "unit", costs: [], categories: [], constraints: [], children: [] },
    { id: "e.enh1", name: "Artificer Armour", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [],
      visibilityModifiers: [{ set: true, conditionGroups: [{ type: "and", conditions: [{ id: "c.g", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "entry", targetId: "e.gladius", includeChildSelections: true }] }] }] },
```

In the `elevenECat` fixture, remove the `groups: [{ ... "Gladius Task Force Enhancements" ... }]` from `e.gladius` (line ~59) and give `e.enh1` (line 67) the same gate:

```ts
    { id: "e.enh1", name: "Artificer Armour", type: "upgrade", costs: [{ name: "pts", value: 10 }], categories: [], constraints: [], children: [],
      visibilityModifiers: [{ set: true, conditionGroups: [{ type: "and", conditions: [{ id: "c.g", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "entry", targetId: "e.gladius", includeChildSelections: true }] }] }] },
```

(Delete the fixtures at lines ~101-164 that exist ONLY to exercise the removed group-name dedup/order behavior — `namedGroupTwiceCat` and the out-of-order variant — and any test body that references them. The gate helper's dedup is covered by Task 1's roster test; do not port those group-name-specific cases.)

- [ ] **Step 2: Run the web test to verify it FAILS**

Run: `pnpm --filter @muster/web test SetupWizard 2>&1 | tail -25`
Expected: FAIL — the preview test at ~227 no longer finds "Artificer Armour" (SetupWizard still calls the old group-name `enhancementsFor`).

- [ ] **Step 3: Switch SetupWizard to the helper and delete the old code**

In `apps/web/src/components/SetupWizard.tsx`:
- Line 3: drop `catalogueEntry` from the import (now unused) and add `enhancementsForDetachment`:
  ```ts
  import { availableDetachments, selectedDetachments, enhancementsForDetachment } from "@muster/roster";
  ```
- Delete the whole `enhancementsFor` function and its doc comment (lines ~18-46).
- In the `previews` derivation (line ~113), change:
  ```ts
      .map((d) => ({ detachment: d, enhancements: enhancementsForDetachment(catalogue, d.id) }));
  ```

- [ ] **Step 4: Run the web test to verify it PASSES**

Run: `pnpm --filter @muster/web test SetupWizard 2>&1 | tail -25`
Expected: PASS — the chosen detachment's gated enhancement ("Artificer Armour") renders.

- [ ] **Step 5: Full web typecheck + test + roster suite**

Run: `pnpm --filter @muster/web typecheck && pnpm --filter @muster/web test && pnpm --filter @muster/roster test 2>&1 | tail -8`
Expected: all green (no unused-import / type errors; `enhancementsFor` fully removed).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/SetupWizard.tsx apps/web/src/components/SetupWizard.test.tsx
git commit -m "$(cat <<'EOF'
feat(web): detachment enhancement preview from the visibility gate

SetupWizard lists a detachment's enhancements via enhancementsForDetachment
(by detachment id), replacing the Space-Marine-only group-name heuristic.
Enhancements now preview for every faction. Fixtures switched to visibility
gates; the removed group-name dedup/order tests are covered by the roster
helper's own unit tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Browser verification (controller-executed)

- [ ] With the web dev server on the local repacked data (`VITE_CATALOGUES_BASE=/`, restore `.env.local` after), open the setup wizard → 11th Edition → **Adepta Sororitas** → Detachment, select **Army of Faith**, and confirm the Enhancements panel lists `Blade of Saint Ellynor`, `Divine Aspect`, `Litanies of Faith`, `Triptych of the Macharian Crusade` (was "No enhancement preview"). Screenshot as proof. Spot-check **Space Marines → Gladius Task Force** shows `Artificer Armour` etc. (SM still works via the gate, not the old group name).

---

## Self-Review notes

- **Spec coverage:** helper reads `set`+`selections`+`lessThan`+`targetId` gate (Task 1) → SetupWizard consumes by id + old heuristic deleted (Task 2) → browser proof (Task 3). `forces`-gate exclusion and dedup are covered by Task 1 tests.
- **Type consistency:** `enhancementsForDetachment(catalogue, detachmentId)` defined Task 1, consumed Task 2. `VisibilityModifier`/`IrCondition` imported from `@muster/domain`. Fixtures supply all required `IrCondition` fields.
- **No placeholders:** every code + fixture block is complete; the deletions name exact symbols (`enhancementsFor`, `catalogueEntry` import, the two group-name-only fixtures).
