# hidden selected nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flag roster selections whose effective visibility is `hidden` under the current army state as a non-blocking `warning`, without changing points or validity.

**Architecture:** New `nodeHidden(node, state)` computes a real node's effective hidden (no owner-skip — real nodes have real ancestors); `hiddenSelectionIds(roster, catalogue)` collects such selectionIds; `evaluate()` emits a `selection.hidden` warning per hidden node; the web marks units whose subtree contains a hidden selection and shows the issue in the existing list. Points/constraints untouched; domain unchanged.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`), Vitest, React 18 (Vite, jsdom). `@muster/engine-eval` requires 100% coverage (excl. `src/index.ts`).

## Global Constraints

- **Never miscompile**: points (`totalPoints`) and constraint checks are UNCHANGED. The feature only ADDS `Issue`s. A hidden selected node still costs points and still counts for constraints.
- Product decision: severity is **`warning`**; the roster stays `valid` (unless other errors exist).
- Real nodes have real ancestors, so `nodeHidden` must NOT apply the no-owner context-scope skip that `hiddenEntryIds` uses. Do NOT modify `hiddenEntryIds`'s existing behavior.
- Domain is NOT modified — `Issue` already has `severity`, `code: string`, `selectionId?`, `entryId?`.
- `passesGate(conditions, conditionGroups, node, state)` is exported from `packages/engine-eval/src/conditions.ts`.
- Issue code string: `"selection.hidden"`. Message: `` `${node.entry.name} is not available in the current army configuration` ``.
- TS strict: no non-null assertions on index access; guard `.find()` results.

---

### Task 1: engine-eval — `nodeHidden` + `hiddenSelectionIds`

**Files:**
- Modify: `packages/engine-eval/src/visibility.ts`
- Test: `packages/engine-eval/test/visibility.test.ts`

Note: `src/index.ts` already does `export * from "./visibility"`, so both `hiddenSelectionIds` and `nodeHidden` are re-exported automatically — no index.ts edit needed. `nodeHidden` being public is acceptable (small pure utility).

**Interfaces:**
- Produces: `nodeHidden(node: EvalNode, state: EvalState): boolean` (exported for evaluate.ts, Task 2); `hiddenSelectionIds(roster: Roster, catalogue: IrCatalogue): Set<string>` (public).

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine-eval/test/visibility.test.ts` (reuse the file's existing `cat()` and `roster(members)` helpers: `e.enh` is hidden when the roster holds no `cat.det` detachment; `e.static` is statically hidden; import `hiddenSelectionIds` from `@muster/engine-eval`):

```typescript
describe("hiddenSelectionIds", () => {
  it("flags a selected node hidden under current roster state", () => {
    // e.enh is hidden when no cat.det detachment is present.
    const ids = hiddenSelectionIds(roster(["e.enh"]), cat());
    expect(ids.has("s0")).toBe(true); // s0 is e.enh's selection id
  });

  it("does not flag the node once its gate no longer fires", () => {
    // With a detachment present, e.enh is visible.
    const ids = hiddenSelectionIds(roster(["e.det", "e.enh"]), cat());
    expect(ids.has("s1")).toBe(false); // s1 is e.enh's selection id here
  });

  it("flags a statically hidden selected node", () => {
    const ids = hiddenSelectionIds(roster(["e.static"]), cat());
    expect(ids.has("s0")).toBe(true);
  });

  it("returns an empty set when nothing is hidden", () => {
    const ids = hiddenSelectionIds(roster(["e.plain"]), cat());
    expect(ids.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/engine-eval test visibility`
Expected: FAIL — `hiddenSelectionIds` is not exported / undefined.

- [ ] **Step 3: Implement in `visibility.ts`**

Add `EvalState` to the state import at the top:
```typescript
import { buildState, type EvalNode, type EvalState } from "./state";
```

Add these two functions at the end of `visibility.ts`:

```typescript
// Effective `hidden` of a REAL roster node given its actual place in `state`.
// Unlike hiddenEntryIds (which builds ownerless synthetic candidate nodes and
// must skip context scopes), a real node always has its real ancestor chain, so
// every gate — including parent/root-entry/ancestor/type scopes — resolves
// directly. Modifiers apply in order; the last matching gate wins.
export function nodeHidden(node: EvalNode, state: EvalState): boolean {
  let isHidden = node.entry.hidden ?? false;
  for (const m of node.entry.visibilityModifiers ?? []) {
    if (passesGate(m.conditions, m.conditionGroups, node, state)) isHidden = m.set;
  }
  return isHidden;
}

// selectionIds of roster nodes whose effective visibility is hidden under the
// current roster state (e.g. an enhancement gated to a detachment the roster no
// longer holds). These are still valid data / still cost points — callers
// surface them as a warning, not a removal.
export function hiddenSelectionIds(roster: Roster, catalogue: IrCatalogue): Set<string> {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const hidden = new Set<string>();
  for (const node of state.all) {
    if (nodeHidden(node, state)) hidden.add(node.selectionId);
  }
  return hidden;
}
```

- [ ] **Step 4: (no index.ts change needed)**

`src/index.ts` already re-exports the whole module via `export * from "./visibility"`, so `hiddenSelectionIds` (and `nodeHidden`) are exported automatically. Nothing to edit.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm --filter @muster/engine-eval test visibility`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/visibility.ts packages/engine-eval/src/index.ts packages/engine-eval/test/visibility.test.ts
git commit -m "feat(engine-eval): hiddenSelectionIds for now-hidden roster nodes"
```

---

### Task 2: engine-eval — `evaluate()` emits `selection.hidden`

**Files:**
- Modify: `packages/engine-eval/src/evaluate.ts`
- Test: `packages/engine-eval/test/evaluate.test.ts`

**Interfaces:**
- Consumes: `nodeHidden` from `./visibility` (Task 1).
- Produces: `Issue { severity: "warning", code: "selection.hidden", selectionId, entryId, message }` per hidden selected node.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine-eval/test/evaluate.test.ts` (build a catalogue+roster mirroring the visibility `cat()`/`roster` pattern used elsewhere; if that file has its own fixtures, follow them. The assertions that matter):

```typescript
it("warns about a selected node that is hidden under current state", () => {
  const catalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      { id: "e.det", name: "Detachment", costs: [], categories: ["cat.det"], constraints: [], children: [] },
      {
        id: "e.enh", name: "Relic Blade", costs: [{ name: "pts", value: 15 }], categories: [], constraints: [], children: [],
        visibilityModifiers: [{ set: true, conditions: [{ id: "c1", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det", includeChildSelections: false }] }],
      },
    ],
  } as any;
  const roster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{ id: "s0", entryId: "e.enh", count: 1, selections: [] }],
  } as any;
  const result = evaluate(roster, catalogue);
  const issue = result.issues.find((i) => i.code === "selection.hidden");
  expect(issue).toBeDefined();
  expect(issue!.severity).toBe("warning");
  expect(issue!.selectionId).toBe("s0");
  expect(issue!.entryId).toBe("e.enh");
  expect(result.valid).toBe(true);       // warning does not invalidate
  expect(result.totalPoints).toBe(15);   // hidden node still costs points
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/engine-eval test evaluate`
Expected: FAIL — no `selection.hidden` issue emitted.

- [ ] **Step 3: Implement in `evaluate.ts`**

Add the import near the other engine-eval imports:
```typescript
import { nodeHidden } from "./visibility";
```

Inside the existing `for (const node of state.all) { ... }` loop (the one that runs constraint/group checks), add after the group-constraint inner loop, still inside the node loop:
```typescript
    if (nodeHidden(node, state)) {
      raw.push({
        severity: "warning",
        code: "selection.hidden",
        selectionId: node.selectionId,
        entryId: node.entry.id,
        message: `${node.entry.name} is not available in the current army configuration`,
      });
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @muster/engine-eval test evaluate`
Expected: PASS.

- [ ] **Step 5: Full package suite (coverage gate)**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all green AND 100% coverage (excl. `src/index.ts`). If a new branch in `nodeHidden`/`hiddenSelectionIds`/`evaluate` is uncovered, add a targeted assertion (e.g. the `roster(["e.plain"])` empty case already covers the not-hidden branch; ensure the evaluate loop's hidden branch and non-hidden path are both hit).

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/evaluate.ts packages/engine-eval/test/evaluate.test.ts
git commit -m "feat(engine-eval): evaluate emits selection.hidden warning for now-hidden nodes"
```

---

### Task 3: web — flag units containing a hidden selection

**Files:**
- Modify: `apps/web/src/App.tsx` (compute + pass hidden set)
- Modify: `apps/web/src/components/RosterList.tsx` (marker + `unitHasHiddenSelection`)
- Test: `apps/web/src/components/RosterList.test.tsx`

**Interfaces:**
- Consumes: `hiddenSelectionIds` from `@muster/engine-eval` (Task 1). `Roster`/`RosterSelection` shape: a unit `u` has `u.id` and `u.selections: RosterSelection[]` (recursive `.selections`).

- [ ] **Step 1: Write the failing test**

In `apps/web/src/components/RosterList.test.tsx` (reuse the file's existing render/catalogue/roster helpers), add a test that a unit whose subtree contains a hidden selection renders a marker, and one without does not. The essential behavior:

```typescript
it("marks a unit whose subtree contains a hidden selection", () => {
  // hiddenIds contains the id of a selection nested in the rendered unit.
  renderRosterListWith({ hiddenIds: new Set(["nested-sel-id"]) }); // adapt to the file's harness
  expect(screen.getByTitle(/not available|unavailable/i)).toBeInTheDocument();
});
```

Adapt to the actual test harness in that file; if `RosterList` currently takes no `hiddenIds` prop, the test drives adding it. Cover both: a unit that transitively contains a hidden selection id → marker present; empty `hiddenIds` → no marker.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test RosterList`
Expected: FAIL — no `hiddenIds` prop / no marker.

- [ ] **Step 3: Implement the recursive helper + marker in `RosterList.tsx`**

Add an OPTIONAL `hiddenIds?: Set<string>` prop to `RosterList`'s props type (optional so the 3 pre-existing tests that don't pass it still compile/render), and inside the component default it: `const hidden = hiddenIds ?? new Set<string>();`. Add this helper above the component (it takes a roster selection subtree):

```typescript
function unitHasHiddenSelection(
  sel: { id: string; selections: { id: string; selections: unknown[] }[] },
  hidden: Set<string>,
): boolean {
  if (hidden.has(sel.id)) return true;
  return sel.selections.some((c) => unitHasHiddenSelection(c as typeof sel, hidden));
}
```

In the unit `<li>`/`<button>`, compute `const flagged = unitHasHiddenSelection(u, hidden);` (using the defaulted `hidden` set) and render a marker when true, e.g. after the name span:

```tsx
{flagged && <span className="rl-warn" title="Contains a selection not available in the current army configuration">⚠</span>}
```

- [ ] **Step 4: Wire it in `App.tsx`**

Import `hiddenSelectionIds` alongside the existing `hiddenEntryIds` import. Add:
```typescript
const hiddenSelIds = useMemo(() => hiddenSelectionIds(roster, catalogue), [roster, catalogue]);
```
Pass `hiddenIds={hiddenSelIds}` to `<RosterList ... />`.

- [ ] **Step 5: Style the marker**

In the stylesheet defining `.rl-unit` (find via `rg -l "rl-unit" apps/web/src`), add:
```css
.rl-warn { color: var(--warn); margin-left: 6px; }
```

- [ ] **Step 6: Run web tests**

Run: `pnpm --filter web test`
Expected: PASS (new + pre-existing).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/components/RosterList.tsx apps/web/src/components/RosterList.test.tsx apps/web/src
git commit -m "feat(web): flag units containing a now-hidden selection"
```

---

### Task 4: full-suite verification

**Files:** none.

- [ ] **Step 1: Whole workspace**

Run: `pnpm turbo run test` and (parser unaffected but sanity) confirm 4/4 green; engine-eval coverage 100%.

- [ ] **Step 2: (evidence) real-catalogue spot check**

If a scratchpad real catalogue is available, build a small roster with a detachment-gated enhancement, switch the detachment, and confirm `hiddenSelectionIds` flags the now-orphaned selection and `evaluate` surfaces a `selection.hidden` warning while `totalPoints` is unchanged. Evidence for the final report, not a committed test.

---

## Self-Review

**Spec coverage:**
- `nodeHidden` (no owner-skip, real node) → Task 1 Step 3. ✓
- `hiddenSelectionIds` → Task 1 Step 3–4. ✓
- `evaluate()` warning issue, points/constraints unchanged → Task 2 Step 3. ✓
- Domain untouched (Issue already fits) → no domain task. ✓
- Web unit marker + recursive `unitHasHiddenSelection` + issue list (existing) → Task 3. ✓
- Never-miscompile (points unchanged, warning severity, valid stays true) → Task 2 test asserts `totalPoints`/`valid`. ✓
- Real evidence → Task 4. ✓

**Placeholder scan:** No TBD/TODO; engine code is concrete. Web test/style steps say "adapt to the file's harness" only where fixtures are file-local; the required behavior + helper code are explicit. ✓

**Type consistency:** `nodeHidden(node: EvalNode, state: EvalState): boolean` used identically in `hiddenSelectionIds` and `evaluate.ts`. `hiddenSelectionIds(roster, catalogue): Set<string>` returns selectionIds consumed by `unitHasHiddenSelection`/`App`. Issue fields (`severity`,`code`,`selectionId`,`entryId`,`message`) match the domain `Issue` schema. ✓
