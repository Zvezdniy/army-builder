# Per-placement Addressing Keystone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve roster selections against the catalogue TREE (parent context) instead of a flat symbol table keyed by bare entryId, so each placement uses its own inlined instance (with per-placement modifiers) and `evaluate()` no longer throws "Duplicate entry id" on divergent same-id clones — unblocking real-catalogue evaluation.

**Architecture:** engine-eval only. Two coordinated changes: (1) `buildSymbolTable` becomes a tolerant flat index (first-wins, no throw) — per-placement divergence of same-id clones is now legitimate; (2) `buildState(roster, catalogue)` resolves each selection via its parent's `children` (root selections via `catalogue.entries`), with the tolerant flat index as a fallback and unknown-id detection. Downstream (`scopes`, `constraints`, `visibility`, `evaluate`) is unchanged; `evaluate`/`hiddenEntryIds`/`hiddenSelectionIds` keep their public signatures.

**Tech Stack:** TypeScript (Zod domain, pure-TS engine-eval); Vitest.

## Global Constraints

- Never break existing behavior: for catalogues without same-id divergence, tree resolution finds the child under its parent — the same entry the flat lookup returned — so results are identical. A test roster referencing a top-level entry not under its parent still resolves via the flat fallback. Existing engine-eval tests must stay green (100% coverage).
- Per-placement correctness: a child selection resolves to the instance under ITS parent (tree), so divergent same-id inlined clones are addressed correctly.
- `buildSymbolTable` no longer throws on id collisions — first entry wins on any collision (identical or divergent). It stays exported and is still used by `hiddenEntryIds` (`symbols.values()` iteration) and as `buildState`'s fallback index.
- Unknown entryId (not under parent AND not in the flat index) still throws `Unknown entryId in roster: <id>`.
- Public API unchanged for `evaluate(roster, catalogue)`, `hiddenEntryIds(...)`, `hiddenSelectionIds(...)`. Only `buildState`'s signature changes (`symbols` → `catalogue`).
- Domain, parser, and web are NOT touched.
- Code/identifiers/commit messages in English. Repo stays local (do not push).

---

### Task 1: make `buildSymbolTable` a tolerant flat index

**Files:**
- Modify: `packages/engine-eval/src/symbols.ts`
- Modify: `packages/engine-eval/src/limits.ts` (stale comment)
- Test: `packages/engine-eval/test/symbols.test.ts`

**Interfaces:**
- Produces: `buildSymbolTable(catalogue): Map<string, IrEntry>` — first-wins on any id collision, never throws. Consumed by `buildState` (Task 2) and `hiddenEntryIds`.

- [ ] **Step 1: Flip the collision test to expect first-wins**

In `packages/engine-eval/test/symbols.test.ts`, replace the test `"throws on an id collision between differing entries"` with:

```ts
  it("first-wins on an id collision between differing entries (per-placement clones are legitimate)", () => {
    const dup: IrCatalogue = {
      ...cat,
      entries: [
        { id: "dup", name: "A", costs: [], categories: [], constraints: [], children: [] },
        { id: "dup", name: "B", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    const table = buildSymbolTable(dup);
    expect(table.get("dup")?.name).toBe("A"); // first wins, no throw
    expect(table.size).toBe(2); // e.unit (from cat) + dup
  });
```

(Leave the other three tests — nested index, identical-clone dedup, shared-under-two-parents — unchanged.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test -- symbols.test.ts`
Expected: the new first-wins test FAILS — `buildSymbolTable` currently throws on the divergent `dup` entries.

- [ ] **Step 3: Remove the throw (tolerant first-wins)**

In `packages/engine-eval/src/symbols.ts`, change the collision handling so any already-registered id is skipped (first wins) without a structural comparison or throw:

```ts
import type { IrCatalogue, IrEntry } from "@muster/domain";
import { assertDepth } from "./limits";

export type SymbolTable = Map<string, IrEntry>;

// A flat id -> entry index over the catalogue tree. The parser inlines shared
// entries by cloning them into every referencing site, so the same id legitimately
// reappears — and, since per-placement modifiers now make those clones diverge, the
// clones are NOT byte-identical. This index is deliberately tolerant: first
// occurrence wins on any collision and its subtree is walked once (keeping traversal
// O(unique ids)); it never throws. It is used as buildState's fallback resolver and
// for iterating the catalogue's unique entries (hiddenEntryIds). Correct per-placement
// resolution is the caller's job (buildState walks the tree by parent context).
export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry, depth: number): void => {
    assertDepth(depth, "Catalogue entry");
    if (table.has(entry.id)) return; // first wins; do not re-walk the subtree
    table.set(entry.id, entry);
    entry.children.forEach((child) => walk(child, depth + 1));
  };
  catalogue.entries.forEach((e) => walk(e, 1));
  return table;
}
```

- [ ] **Step 4: Fix the stale comment in limits.ts**

In `packages/engine-eval/src/limits.ts`, the doc comment references "cf. buildSymbolTable's duplicate-id throw" (around line 7). Replace that clause so it no longer cites a throw that no longer exists, e.g. change "(cf. buildSymbolTable's duplicate-id throw)" to "(cf. buildState's unknown-entryId throw)".

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test -- symbols.test.ts`
Expected: all four symbols tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/symbols.ts packages/engine-eval/src/limits.ts packages/engine-eval/test/symbols.test.ts
git commit -m "feat(engine-eval): make buildSymbolTable a tolerant first-wins index

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: tree-based `buildState(roster, catalogue)`

**Files:**
- Modify: `packages/engine-eval/src/state.ts`
- Modify: `packages/engine-eval/src/evaluate.ts` (caller)
- Modify: `packages/engine-eval/src/visibility.ts` (two callers)
- Test: `packages/engine-eval/test/state.test.ts` (new per-placement tests + update the two existing call sites)
- Test: the other 11 engine-eval test files that call `buildState(X, buildSymbolTable(Y))` (mechanical rewrite)

**Interfaces:**
- Consumes: `IrCatalogue`, `Roster` from `@muster/domain`; `buildSymbolTable` from `./symbols` (Task 1, tolerant); `assertDepth` from `./limits`.
- Produces: `buildState(roster: Roster, catalogue: IrCatalogue): EvalState` — resolves each selection against its parent's `children` (root selections against `catalogue.entries`), falling back to the tolerant flat index, throwing `Unknown entryId in roster: <id>` if neither resolves.

- [ ] **Step 1: Write the failing per-placement tests**

Add to `packages/engine-eval/test/state.test.ts` (imports already include `buildState`; add `buildSymbolTable` stays imported for the other existing tests you'll rewrite in Step 5). New tests:

```ts
describe("buildState per-placement tree resolution", () => {
  // The SAME wargear id is inlined under two units with DIFFERENT costs (a
  // per-placement clone). Tree resolution must give each placement its own instance.
  const cat2 = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.a", name: "A", costs: [], categories: [], constraints: [],
        children: [{ id: "e.w", name: "W", costs: [{ name: "points", value: 3 }], categories: [], constraints: [], children: [] }] },
      { id: "e.b", name: "B", costs: [], categories: [], constraints: [],
        children: [{ id: "e.w", name: "W", costs: [{ name: "points", value: 5 }], categories: [], constraints: [], children: [] }] },
    ],
  } as unknown as IrCatalogue;

  const rosterUnder = (host: "e.a" | "e.b"): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{ id: "u", entryId: host, count: 1,
      selections: [{ id: "w", entryId: "e.w", count: 1, selections: [] }] }],
  } as unknown as Roster);

  it("resolves a child to the instance under ITS parent (divergent same-id clones)", () => {
    const underA = buildState(rosterUnder("e.a"), cat2);
    const underB = buildState(rosterUnder("e.b"), cat2);
    const wA = underA.all.find((n) => n.entry.id === "e.w")!;
    const wB = underB.all.find((n) => n.entry.id === "e.w")!;
    expect(wA.entry.costs[0]!.value).toBe(3); // e.a's placement
    expect(wB.entry.costs[0]!.value).toBe(5); // e.b's placement
  });

  it("resolves a root selection from catalogue.entries", () => {
    const st = buildState(rosterUnder("e.a"), cat2);
    expect(st.roots[0]!.entry.id).toBe("e.a");
  });

  it("falls back to the flat index when a child is not under its parent", () => {
    // Roster nests e.a under e.a (e.a has no e.a child) → not found under parent →
    // flat fallback finds the top-level e.a. No throw.
    const weird: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "u", entryId: "e.a", count: 1,
        selections: [{ id: "x", entryId: "e.b", count: 1, selections: [] }] }],
    } as unknown as Roster;
    const st = buildState(weird, cat2);
    expect(st.all.find((n) => n.selectionId === "x")!.entry.id).toBe("e.b");
  });
});
```

- [ ] **Step 2: Run to verify the divergence test fails**

Run: `pnpm --filter @muster/engine-eval test -- state.test.ts`
Expected: compile error first (the new tests call `buildState(roster, cat2)` — 2-arg with a catalogue — while the current signature is `(roster, symbols)`). That signature mismatch is the expected red; it is resolved in Step 3.

- [ ] **Step 3: Rewrite `buildState` for tree resolution**

Replace `packages/engine-eval/src/state.ts` with:

```ts
import type { Roster, RosterSelection, IrEntry, IrCatalogue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { assertDepth } from "./limits";

export interface EvalNode {
  selectionId: string;
  entry: IrEntry;
  count: number;
  multiplier: number;
  effectiveCount: number;
  categories: string[];
  parent: EvalNode | null;
  children: EvalNode[];
}

export interface EvalState {
  roots: EvalNode[];
  all: EvalNode[];
}

// Resolve each roster selection against the catalogue TREE: a child resolves
// among its parent's children (root selections among catalogue.entries), so the
// per-placement inlined instance (with its own modifiers) is used. The tolerant
// flat index is a fallback for a selection not found under its parent (e.g. a
// roster built against a slightly different catalogue); an id in neither is unknown.
export function buildState(roster: Roster, catalogue: IrCatalogue): EvalState {
  const flat = buildSymbolTable(catalogue);
  const all: EvalNode[] = [];

  const resolve = (parentEntry: IrEntry | null, entryId: string): IrEntry => {
    const siblings = parentEntry ? parentEntry.children : catalogue.entries;
    const local = siblings.find((e) => e.id === entryId);
    if (local) return local;
    const fallback = flat.get(entryId);
    if (fallback) return fallback;
    throw new Error(`Unknown entryId in roster: ${entryId}`);
  };

  const build = (
    selection: RosterSelection,
    parent: EvalNode | null,
    parentMultiplier: number,
    depth: number,
  ): EvalNode => {
    assertDepth(depth, "Roster selection");
    const entry = resolve(parent ? parent.entry : null, selection.entryId);
    const node: EvalNode = {
      selectionId: selection.id,
      entry,
      count: selection.count,
      multiplier: parentMultiplier,
      effectiveCount: selection.count * parentMultiplier,
      categories: entry.categories,
      parent,
      children: [],
    };
    all.push(node);
    node.children = selection.selections.map((child) =>
      build(child, node, node.effectiveCount, depth + 1),
    );
    return node;
  };

  const roots = roster.selections.map((s) => build(s, null, 1, 1));
  return { roots, all };
}
```

- [ ] **Step 4: Update the three production callers**

`packages/engine-eval/src/evaluate.ts` — remove the `buildSymbolTable` call and pass the catalogue:

```ts
// remove: import { buildSymbolTable } from "./symbols";
// remove: const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, catalogue);
```

`packages/engine-eval/src/visibility.ts` `hiddenEntryIds` — keep `buildSymbolTable` (still needed for `symbols.values()`), change the buildState call:

```ts
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, catalogue);
```

`packages/engine-eval/src/visibility.ts` `hiddenSelectionIds` — drop the now-unused `buildSymbolTable` local:

```ts
  const state = buildState(roster, catalogue);
```

(If `buildSymbolTable` is no longer referenced anywhere in visibility.ts after this — it still is, in `hiddenEntryIds` — keep the import. Do not remove an import that is still used.)

- [ ] **Step 5: Mechanically rewrite the 35 test call sites**

Across the engine-eval test files, rewrite every `buildState(X, buildSymbolTable(Y))` to `buildState(X, Y)`. Run this from the repo root:

```bash
cd packages/engine-eval/test
perl -0pi -e 's/buildState\(([^,]+?),\s*buildSymbolTable\(([^()]+)\)\)/buildState($1, $2)/g' \
  modifier-property.test.ts security.test.ts conditions.test.ts constraints.test.ts \
  scopes.test.ts cost.test.ts parser-contract.test.ts state.test.ts resolve.test.ts \
  modifiers.test.ts resolve-feedback.test.ts
cd -
```

Then, in each of those files EXCEPT `symbols.test.ts`, remove any now-unused `buildSymbolTable` import (if the file no longer references `buildSymbolTable` anywhere). Verify with `grep -n buildSymbolTable <file>` per file: if the only remaining hits are in the import line, drop `buildSymbolTable` from that import (keep `buildState`/other named imports). `symbols.test.ts` keeps its `buildSymbolTable` import (it tests it directly). Any file that still uses `buildSymbolTable` directly for another purpose keeps the import.

- [ ] **Step 6: Run the full engine-eval suite + typecheck**

Run: `pnpm --filter @muster/engine-eval test && pnpm --filter @muster/engine-eval exec tsc --noEmit`
Expected: all green, 100% coverage. The per-placement divergence test passes; the unknown-id test still throws; every rewritten call site compiles and passes (unchanged behavior for non-divergent catalogues). If any test fails, investigate whether tree resolution changed a result — for a non-divergent catalogue it must not; if a test roster references an entry not under its parent, the flat fallback must resolve it (do not weaken the test).

- [ ] **Step 7: Commit**

```bash
git add packages/engine-eval/src/state.ts packages/engine-eval/src/evaluate.ts packages/engine-eval/src/visibility.ts packages/engine-eval/test
git commit -m "feat(engine-eval): resolve roster selections via the catalogue tree (per-placement)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: cross-language contract — divergent per-placement now evaluates

**Files:**
- Test: `packages/engine-eval/test/parser-contract.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue` (Zod), `evaluate`. A catalogue with the SAME entry id inlined under two units with divergent per-placement costs — the exact shape that previously threw in `buildSymbolTable` — now validates and evaluates with correct per-placement pricing.
- Produces: none (leaf test).

- [ ] **Step 1: Write the test**

Append a `describe` to `packages/engine-eval/test/parser-contract.test.ts` (it already imports `IrCatalogue`, `evaluate`, `Roster`):

```ts
describe("parser IR contract — same-id per-placement now evaluates (keystone)", () => {
  // The SAME shared id `e.wargear` inlined under two units, one placement
  // discounted via costs[].modifiers. Before the keystone this threw in
  // buildSymbolTable ("Duplicate entry id"); now tree resolution gives each
  // placement its own instance and evaluate() prices them independently.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [
      {
        id: "e.a", name: "A", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5, modifiers: [{ id: "m0", type: "decrement", value: 2 }] }],
        }],
      },
      {
        id: "e.b", name: "B", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5 }],
        }],
      },
    ],
  };

  const roster = (host: "e.a" | "e.b"): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: host, count: 1,
      selections: [{ id: "w", entryId: "e.wargear", count: 1, selections: [] }],
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("evaluates without throwing and prices each placement independently", () => {
    const cat = IrCatalogue.parse(shaped);
    expect(() => evaluate(roster("e.a"), cat)).not.toThrow();
    expect(evaluate(roster("e.a"), cat).totalPoints).toBe(3); // discounted placement
    expect(evaluate(roster("e.b"), cat).totalPoints).toBe(5); // plain placement
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @muster/engine-eval test -- parser-contract.test.ts`
Expected: PASS (tree resolution + tolerant index from Tasks 1-2 make the same-id divergent case evaluate correctly).

- [ ] **Step 3: Run the full suites**

Run: `pnpm --filter @muster/engine-eval test && pnpm --filter @muster/domain test`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add packages/engine-eval/test/parser-contract.test.ts
git commit -m "test(engine-eval): contract for same-id per-placement evaluation (keystone)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- tolerant `buildSymbolTable` (first-wins, no throw) → Task 1. ✓
- tree-based `buildState(roster, catalogue)` with flat fallback + unknown-throw → Task 2 Step 3. ✓
- three production callers updated → Task 2 Step 4. ✓
- 35 test call sites rewritten + unused imports removed → Task 2 Step 5. ✓
- limits.ts stale comment fixed → Task 1 Step 4. ✓
- previously-throwing same-id per-placement now evaluates → Task 3. ✓
- existing behavior preserved (non-divergent = same result; top-level-not-under-parent = flat fallback) → Task 2 Step 6 + the fallback test. ✓

**Type consistency:** `buildState(roster: Roster, catalogue: IrCatalogue)` — all three production callers pass `catalogue`; all 35 test sites become `buildState(X, Y)` where `Y` is the catalogue. `resolve(parentEntry, entryId)` uses `parentEntry.children` / `catalogue.entries` (both `IrEntry[]`). `buildSymbolTable(catalogue)` return type unchanged (`Map<string, IrEntry>`).

**Placeholder scan:** none — every code step is complete.
