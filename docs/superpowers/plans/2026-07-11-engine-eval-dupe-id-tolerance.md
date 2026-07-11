# Engine-eval Duplicate-Id Tolerance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `buildSymbolTable` tolerates duplicate entry ids that arise from the parser inlining shared entries (identical copies dedup, first wins), while still failing loudly on a genuine id collision between two *different* definitions — so real BattleScribe catalogues can `evaluate()`.

**Architecture:** One-function change in `packages/engine-eval/src/symbols.ts`. On a repeated id, compare the two entries structurally via `JSON.stringify` (Zod normalizes key order across all `IrEntry` objects in a catalogue, so identical inlined clones serialize byte-identically). Equal → skip (first wins; do not re-walk the identical subtree, giving O(unique) traversal). Not equal → throw the existing `Duplicate entry id in catalogue: <id>` error. No parser, IR-shape, or web changes.

**Tech Stack:** TypeScript (strict, ESM), Vitest with 100%-coverage enforcement (via shared `vitest.shared.ts`, excludes `src/index.ts`).

## Global Constraints

- Change ONLY `packages/engine-eval/src/symbols.ts` (implementation) and `packages/engine-eval/test/symbols.test.ts` + `packages/engine-eval/test/evaluate.test.ts` (tests). Do NOT touch the parser, IR schema (`@muster/domain`), or `apps/web`.
- Preserve the never-miscompile invariant: differing entries under one id MUST still throw; only structurally-identical copies may dedup.
- The thrown error message stays exactly `Duplicate entry id in catalogue: ${entry.id}` (existing test matches `/duplicate/i`).
- 100% coverage is enforced on `@muster/engine-eval` — every new branch must be exercised by a test.
- Keep `assertDepth(depth, "Catalogue entry")` at the top of `walk` unchanged.
- Identifiers/comments in English; commit messages in English.

---

### Task 1: buildSymbolTable dedups identical duplicate ids, throws on differing ones

**Files:**
- Modify: `packages/engine-eval/src/symbols.ts`
- Test: `packages/engine-eval/test/symbols.test.ts`
- Test: `packages/engine-eval/test/evaluate.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue`, `IrEntry` from `@muster/domain`; `assertDepth` from `./limits`.
- Produces: `buildSymbolTable(catalogue: IrCatalogue): SymbolTable` — signature unchanged (`SymbolTable = Map<string, IrEntry>`). New behavior: identical duplicate ids dedup (first wins) instead of throwing; differing duplicate ids still throw.

- [ ] **Step 1: Write the failing tests**

Replace the body of `packages/engine-eval/test/symbols.test.ts` with the following (keeps the two existing cases, retitles the collision case, adds two dedup cases). Full file:

```typescript
import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrEntry } from "@muster/domain";
import { buildSymbolTable } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "cat.demo",
  name: "Demo",
  gameSystemId: "gs.40k",
  revision: 1,
  forceConstraints: [],
  entries: [
    {
      id: "e.unit",
      name: "Unit",
      costs: [],
      categories: [],
      constraints: [],
      children: [
        { id: "e.wargear", name: "Wargear", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
};

describe("buildSymbolTable", () => {
  it("indexes nested entries by id", () => {
    const table = buildSymbolTable(cat);
    expect(table.get("e.wargear")?.name).toBe("Wargear");
    expect(table.size).toBe(2);
  });

  it("throws on an id collision between differing entries", () => {
    const dup: IrCatalogue = {
      ...cat,
      entries: [
        { id: "dup", name: "A", costs: [], categories: [], constraints: [], children: [] },
        { id: "dup", name: "B", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    expect(() => buildSymbolTable(dup)).toThrow(/duplicate/i);
  });

  it("dedups an identical inlined entry (first wins, subtree walked once)", () => {
    const shared: IrEntry = {
      id: "e.shared",
      name: "Shared",
      costs: [],
      categories: [],
      constraints: [],
      children: [
        { id: "e.shared.child", name: "Child", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    const inlined: IrCatalogue = {
      ...cat,
      entries: [structuredClone(shared), structuredClone(shared)],
    };
    const table = buildSymbolTable(inlined);
    // e.shared + e.shared.child, each registered exactly once — no throw.
    expect(table.size).toBe(2);
    expect(table.get("e.shared")?.name).toBe("Shared");
    expect(table.get("e.shared.child")?.name).toBe("Child");
  });

  it("dedups the same shared entry inlined under two different parents", () => {
    const shared: IrEntry = {
      id: "e.bolter",
      name: "Bolter",
      costs: [],
      categories: [],
      constraints: [],
      children: [],
    };
    const nested: IrCatalogue = {
      ...cat,
      entries: [
        { id: "e.a", name: "A", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
        { id: "e.b", name: "B", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
      ],
    };
    const table = buildSymbolTable(nested);
    expect(table.size).toBe(3); // e.a, e.b, e.bolter (once)
    expect(table.get("e.bolter")?.name).toBe("Bolter");
  });
});
```

- [ ] **Step 2: Run the tests to verify the dedup cases fail**

Run: `pnpm --filter @muster/engine-eval test -- symbols`
Expected: the two new "dedups…" tests FAIL with `Duplicate entry id in catalogue: e.shared` / `… e.bolter` thrown by the current `buildSymbolTable`. The two original tests PASS.

- [ ] **Step 3: Implement the dedup-with-equality behavior**

Replace the full contents of `packages/engine-eval/src/symbols.ts` with:

```typescript
import type { IrCatalogue, IrEntry } from "@muster/domain";
import { assertDepth } from "./limits";

export type SymbolTable = Map<string, IrEntry>;

export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry, depth: number): void => {
    assertDepth(depth, "Catalogue entry");
    const existing = table.get(entry.id);
    if (existing) {
      // The parser inlines shared entries by cloning them into every referencing
      // site, so the same id legitimately reappears with a byte-identical subtree.
      // Zod normalizes key order across all IrEntry objects in a catalogue, so
      // structurally-identical clones serialize identically. First wins, and we do
      // NOT re-walk the subtree — its children are already registered under the
      // first occurrence, which also keeps traversal O(unique entries).
      if (JSON.stringify(existing) === JSON.stringify(entry)) return;
      // Two genuinely different definitions share one id: malformed input. Fail
      // loudly rather than silently pick one — preserve the never-miscompile invariant.
      throw new Error(`Duplicate entry id in catalogue: ${entry.id}`);
    }
    table.set(entry.id, entry);
    entry.children.forEach((child) => walk(child, depth + 1));
  };
  catalogue.entries.forEach((e) => walk(e, 1));
  return table;
}
```

- [ ] **Step 4: Run the tests to verify all four pass**

Run: `pnpm --filter @muster/engine-eval test -- symbols`
Expected: all four `buildSymbolTable` tests PASS.

- [ ] **Step 5: Add an evaluate()-level regression test**

Append this block to `packages/engine-eval/test/evaluate.test.ts` (after the final `});` of the existing top-level `describe` blocks — it is self-contained and does not use the mini40k fixtures):

```typescript
describe("evaluate tolerates inlined duplicate entry ids", () => {
  // Mirrors real catalogues: a shared entry inlined (cloned) under two units,
  // producing a duplicate id. evaluate() must not throw.
  const shared: IrEntry = {
    id: "e.shared.wargear", name: "Shared Wargear", costs: [], categories: [], constraints: [], children: [],
  };
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.u1", name: "U1", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
      { id: "e.u2", name: "U2", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
    ],
  };
  const emptyRoster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 100, selections: [],
  };

  it("evaluates an empty roster without a duplicate-id crash", () => {
    const result = evaluate(emptyRoster, cat);
    expect(result.totalPoints).toBe(0);
    expect(result.valid).toBe(true);
  });
});
```

Ensure `IrEntry` is imported in this file. The current header is `import type { IrCatalogue } from "@muster/domain";` — change it to:

```typescript
import type { IrCatalogue, IrEntry } from "@muster/domain";
```

- [ ] **Step 6: Run the engine-eval suite with coverage**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all tests PASS, coverage stays 100% (every branch of the new `if (existing)` block — the equal `return`, the throw, and the first-seen path — is exercised by the tests above).

- [ ] **Step 7: Run the full monorepo build to confirm no regressions**

Run: `pnpm -w turbo run test`
Expected: all packages green (domain, roster, engine-eval, web).

- [ ] **Step 8: Commit**

```bash
git add packages/engine-eval/src/symbols.ts packages/engine-eval/test/symbols.test.ts packages/engine-eval/test/evaluate.test.ts
git commit -m "feat(engine-eval): tolerate inlined duplicate entry ids (dedup identical, throw on collision)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Spec behavior 1 (new id → register) — unchanged code path, covered by "indexes nested entries by id".
- Spec behavior 2 (equal dup → first wins, skip children) — Task 1 Step 3 `return`, covered by both "dedups…" tests + evaluate regression.
- Spec behavior 3 (unequal dup → throw) — Task 1 Step 3 `throw`, covered by "throws on an id collision…".
- Spec test 1 (evaluate runs on dup catalogue) — Step 5 evaluate regression test.
- Spec test 2 (collision throws) — retitled existing test.
- Spec test 3 (child dedup) — "dedups an identical inlined entry (subtree walked once)".
- Spec test 4 (regression golden/mini40k) — Step 7 full turbo run.

**Placeholder scan:** none — all code and commands are concrete.

**Type consistency:** `buildSymbolTable(catalogue: IrCatalogue): SymbolTable` signature unchanged; `SymbolTable = Map<string, IrEntry>` unchanged; error string identical to the existing one. `structuredClone` is available in the Node runtime used by the test suite.

**Perf note (non-blocking):** `JSON.stringify` runs only on duplicate hits; each duplicate subtree is stringified once because equal copies are not re-walked. Acceptable one-time cost at table build. A hot shared entry inlined N times re-stringifies the first occurrence N times, but N is bounded and this is the minimal-unblock slice — structural shrink is a separate, deferred slice.

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent for Task 1, review, then final whole-branch review.
2. **Inline Execution** — execute Task 1 in this session with a checkpoint.

Given this is a single, tightly-scoped task (~15 lines + tests), inline execution is reasonable; subagent-driven adds a clean review gate. Ask the user which they prefer.
