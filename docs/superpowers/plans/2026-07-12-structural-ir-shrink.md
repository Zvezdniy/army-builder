# Structural IR Shrink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Content-addressed дедуп поддеревьев `IrEntry` в упакованном wire-формате с рехидратацией на границе домена, сжимающий реальный SM IR со 104 MB до ~3 MB без изменения рантайм-контракта.

**Architecture:** Новый чистый модуль `packages/domain/src/packed.ts` (canonicalKey + `PackedCatalogue` схема + `packCatalogue`/`rehydrateCatalogue`/`loadCatalogue`). Парсер и его golden НЕ трогаются. `apps/web` грузит через `loadCatalogue`. Дистрибутивный упакованный файл производит `scripts/pack-ir.mjs`.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), Zod 3, Vitest, Node ESM.

## Global Constraints

- Рантайм-тип `IrCatalogue` и публичные сигнатуры `evaluate`/`hiddenEntryIds`/roster НЕ меняются.
- `rehydrate(pack(c))` глубоко равно `c` для любого валидированного `IrCatalogue`.
- Идентичные поддеревья после рехидратации — ОДИН общий объект (read-only шаринг); расходящиеся — раздельные (keystone-инвариант).
- Парсер (Rust) и его golden-фикстура НЕ изменяются.
- Код/идентификаторы/коммиты — на английском; `noUncheckedIndexedAccess` соблюдать (индексация даёт `T | undefined`).

---

### Task 1: domain `packed.ts` — canonicalKey, схемы, pack, rehydrate

**Files:**
- Create: `packages/domain/src/packed.ts`
- Test: `packages/domain/test/packed.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue`, `IrEntry` из `./ir`; `z` из `zod`.
- Produces:
  - `canonicalKey(value: unknown): string`
  - `PackedEntry` (Zod), `PackedCatalogue` (Zod) + inferred types
  - `packCatalogue(cat: IrCatalogue): PackedCatalogue`
  - `rehydrateCatalogue(p: PackedCatalogue): IrCatalogue`

- [ ] **Step 1: Write failing tests**

```ts
// packages/domain/test/packed.test.ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrEntry } from "../src/ir";
import { IrCatalogue as IrCatalogueSchema } from "../src/ir";
import { canonicalKey, packCatalogue, rehydrateCatalogue, PackedCatalogue } from "../src/packed";

// Minimal valid entry (Zod fills defaults on parse). Build via schema so runtime
// shape matches what the app feeds pack().
const entry = (over: Partial<IrEntry> & { id: string; name: string }): IrEntry =>
  IrCatalogueSchema.parse({
    id: "c", name: "c", gameSystemId: "g", revision: 1, entries: [over],
  }).entries[0]!;

const cat = (entries: IrEntry[]): IrCatalogue =>
  IrCatalogueSchema.parse({ id: "c", name: "c", gameSystemId: "g", revision: 1, entries });

describe("canonicalKey", () => {
  it("is order-independent over object keys but content-sensitive", () => {
    expect(canonicalKey({ a: 1, b: 2 })).toBe(canonicalKey({ b: 2, a: 1 }));
    expect(canonicalKey({ a: 1 })).not.toBe(canonicalKey({ a: 2 }));
    expect(canonicalKey([1, 2])).not.toBe(canonicalKey([2, 1]));
  });
});

describe("packCatalogue", () => {
  it("dedups identical inlined subtrees into one pool entry", () => {
    const shared = entry({ id: "w", name: "Bolter" });
    const a = entry({ id: "a", name: "A", children: [shared] });
    const b = entry({ id: "b", name: "B", children: [shared] });
    const packed = packCatalogue(cat([a, b]));
    // pool: shared(1) + a + b = 3 distinct; a and b each reference shared's index
    expect(packed.entryPool.length).toBe(3);
    expect(packed.entries.length).toBe(2);
    const poolA = packed.entryPool[packed.entries[0]!]!;
    const poolB = packed.entryPool[packed.entries[1]!]!;
    expect(poolA.children[0]).toBe(poolB.children[0]); // same shared index
  });

  it("keeps divergent same-id clones as separate pool entries (keystone)", () => {
    const a = entry({ id: "x", name: "X", costs: [{ name: "pts", value: 3 }] });
    const b = entry({ id: "x", name: "X", costs: [{ name: "pts", value: 5 }] });
    const packed = packCatalogue(cat([a, b]));
    expect(packed.entryPool.length).toBe(2);
  });

  it("treats child order as significant", () => {
    const p = entry({ id: "c1", name: "c1" });
    const q = entry({ id: "c2", name: "c2" });
    const ab = entry({ id: "ab", name: "ab", children: [p, q] });
    const ba = entry({ id: "ba", name: "ba", children: [q, p] });
    const packed = packCatalogue(cat([ab, ba]));
    // p, q, ab, ba => 4 distinct (ab and ba differ in child order + own id)
    expect(packed.entryPool.length).toBe(4);
  });
});

describe("rehydrateCatalogue", () => {
  it("shares one object for identical subtrees (DAG)", () => {
    const shared = entry({ id: "w", name: "Bolter" });
    const a = entry({ id: "a", name: "A", children: [shared] });
    const b = entry({ id: "b", name: "B", children: [shared] });
    const r = rehydrateCatalogue(packCatalogue(cat([a, b])));
    expect(r.entries[0]!.children[0]).toBe(r.entries[1]!.children[0]); // same ref
  });

  it("round-trips: rehydrate(pack(c)) deep-equals c", () => {
    const shared = entry({ id: "w", name: "Bolter", costs: [{ name: "pts", value: 2 }] });
    const a = entry({ id: "a", name: "A", children: [shared], categories: ["k"] });
    const b = entry({ id: "b", name: "B", children: [shared] });
    const c = cat([a, b]);
    expect(rehydrateCatalogue(packCatalogue(c))).toEqual(c);
  });

  it("produces a PackedCatalogue that its own schema accepts", () => {
    const packed = packCatalogue(cat([entry({ id: "a", name: "A" })]));
    expect(() => PackedCatalogue.parse(packed)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/domain test -- packed`
Expected: FAIL (`../src/packed` not found).

- [ ] **Step 3: Implement `packed.ts`**

```ts
// packages/domain/src/packed.ts
import { z } from "zod";
import type { IrCatalogue, IrEntry } from "./ir";
import { IrCost, IrConstraint, IrGroup, IrProfile } from "./ir";
import { VisibilityModifier } from "./visibility";
import { IrValidationRule } from "./validation-rules";
import { IrCategoryModifier } from "./category-modifiers";

// Deterministic serialization for content-addressing: object keys sorted
// recursively so key-order variance never changes the hash. Arrays keep order
// (semantically significant). No cycles: a packed tree is a DAG of subtrees.
export function canonicalKey(value: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(value));
}

// A pooled entry mirrors IrEntry but replaces the recursive children with
// indices into PackedCatalogue.entryPool.
export const PackedEntry = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["unit", "upgrade", "model"]).optional(),
  costs: z.array(IrCost).default([]),
  categories: z.array(z.string()).default([]),
  constraints: z.array(IrConstraint).default([]),
  children: z.array(z.number().int().nonnegative()).default([]),
  groups: z.array(IrGroup).default([]),
  profiles: z.array(IrProfile).default([]),
  hidden: z.boolean().default(false),
  visibilityModifiers: z.array(VisibilityModifier).default([]),
  validationRules: z.array(IrValidationRule).default([]),
  categoryModifiers: z.array(IrCategoryModifier).default([]),
});
export type PackedEntry = z.infer<typeof PackedEntry>;

export const PackedCatalogue = z.object({
  format: z.literal("packed-v1"),
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  revision: z.number().finite(),
  entryPool: z.array(PackedEntry),
  entries: z.array(z.number().int().nonnegative()),
  forceConstraints: z.array(IrConstraint).default([]),
  categoryNames: z.record(z.string()).default({}),
  ruleTexts: z.record(z.string()).optional(),
});
export type PackedCatalogue = z.infer<typeof PackedCatalogue>;

// Bottom-up interning: children are interned before their parent, so identical
// subtrees collapse to one pool entry and the pool is topologically ordered
// (every child index < its parent index).
export function packCatalogue(cat: IrCatalogue): PackedCatalogue {
  const pool: PackedEntry[] = [];
  const index = new Map<string, number>();
  const intern = (e: IrEntry): number => {
    const children = e.children.map(intern);
    const packed: PackedEntry = { ...e, children };
    const key = canonicalKey(packed);
    let i = index.get(key);
    if (i === undefined) {
      i = pool.length;
      pool.push(packed);
      index.set(key, i);
    }
    return i;
  };
  const entries = cat.entries.map(intern);
  return {
    format: "packed-v1",
    id: cat.id,
    name: cat.name,
    gameSystemId: cat.gameSystemId,
    revision: cat.revision,
    entryPool: pool,
    entries,
    forceConstraints: cat.forceConstraints,
    categoryNames: cat.categoryNames,
    ...(cat.ruleTexts !== undefined ? { ruleTexts: cat.ruleTexts } : {}),
  };
}

// Memoized rebuild: identical subtrees resolve to the SAME object (shared,
// read-only) so the runtime tree is a compact DAG. Order-independent, no cycles.
export function rehydrateCatalogue(p: PackedCatalogue): IrCatalogue {
  const built: (IrEntry | undefined)[] = new Array(p.entryPool.length);
  const build = (i: number): IrEntry => {
    const memo = built[i];
    if (memo) return memo;
    const pe = p.entryPool[i];
    if (!pe) throw new Error(`packed entry index out of range: ${i}`);
    const node: IrEntry = { ...pe, children: pe.children.map(build) };
    built[i] = node;
    return node;
  };
  const entries = p.entries.map(build);
  return {
    id: p.id,
    name: p.name,
    gameSystemId: p.gameSystemId,
    revision: p.revision,
    entries,
    forceConstraints: p.forceConstraints,
    categoryNames: p.categoryNames,
    ...(p.ruleTexts !== undefined ? { ruleTexts: p.ruleTexts } : {}),
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @muster/domain test -- packed`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/packed.ts packages/domain/test/packed.test.ts
git commit -m "feat(domain): content-addressed pack/rehydrate for IR subtree dedup"
```

---

### Task 2: domain `loadCatalogue` + export

**Files:**
- Modify: `packages/domain/src/packed.ts` (add `loadCatalogue`)
- Modify: `packages/domain/src/index.ts` (export `./packed`)
- Test: `packages/domain/test/packed.test.ts` (append `loadCatalogue` cases)

**Interfaces:**
- Consumes: `PackedCatalogue`, `rehydrateCatalogue` (Task 1); `IrCatalogue` schema from `./ir`.
- Produces: `loadCatalogue(raw: unknown): IrCatalogue`.

- [ ] **Step 1: Write failing tests (append)**

```ts
// append to packages/domain/test/packed.test.ts
import { loadCatalogue } from "../src/packed";

describe("loadCatalogue", () => {
  const tree = cat([entry({ id: "a", name: "A" })]);

  it("rehydrates a packed-v1 payload", () => {
    const packed = packCatalogue(tree);
    expect(loadCatalogue(JSON.parse(JSON.stringify(packed)))).toEqual(tree);
  });

  it("parses a plain tree IrCatalogue (backward compatible)", () => {
    expect(loadCatalogue(JSON.parse(JSON.stringify(tree)))).toEqual(tree);
  });

  it("throws on a malformed packed payload", () => {
    expect(() => loadCatalogue({ format: "packed-v1", id: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/domain test -- packed`
Expected: FAIL (`loadCatalogue` not exported).

- [ ] **Step 3: Implement `loadCatalogue` (append to packed.ts) + export**

Append to `packages/domain/src/packed.ts`:

```ts
import { IrCatalogue as IrCatalogueSchema } from "./ir";

// Single load seam: packed payloads are rehydrated; plain tree catalogues are
// validated as-is (backward compatible with pre-shrink fixtures).
export function loadCatalogue(raw: unknown): IrCatalogue {
  if (
    raw && typeof raw === "object" &&
    (raw as { format?: unknown }).format === "packed-v1"
  ) {
    return rehydrateCatalogue(PackedCatalogue.parse(raw));
  }
  return IrCatalogueSchema.parse(raw);
}
```

Add to `packages/domain/src/index.ts` (after the `./ir` export line):

```ts
export * from "./packed";
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @muster/domain test -- packed`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/packed.ts packages/domain/src/index.ts packages/domain/test/packed.test.ts
git commit -m "feat(domain): loadCatalogue seam dispatching packed vs tree IR"
```

---

### Task 3: pack CLI `scripts/pack-ir.mjs`

**Files:**
- Create: `scripts/pack-ir.mjs`
- Test: `packages/domain/test/pack-cli.test.ts` (round-trip via the exported functions on a temp file — the CLI is a thin wrapper; assert its transform equivalence)

**Interfaces:**
- Consumes: `packCatalogue`, `loadCatalogue` from `@muster/domain`.
- Produces: a runnable node CLI: `node scripts/pack-ir.mjs <tree-ir.json> <out-packed.json>`.

- [ ] **Step 1: Write failing test**

```ts
// packages/domain/test/pack-cli.test.ts
import { describe, it, expect } from "vitest";
import { IrCatalogue as IrCatalogueSchema } from "../src/ir";
import { packCatalogue, loadCatalogue } from "../src/packed";

// The CLI is a thin file wrapper around packCatalogue; this test pins the
// transform contract the CLI relies on: a parsed tree, packed then loaded,
// equals the parsed tree.
describe("pack CLI transform contract", () => {
  it("pack then load restores the parsed catalogue", () => {
    const tree = IrCatalogueSchema.parse({
      id: "c", name: "c", gameSystemId: "g", revision: 1,
      entries: [
        { id: "a", name: "A", children: [{ id: "w", name: "Bolter" }] },
        { id: "b", name: "B", children: [{ id: "w", name: "Bolter" }] },
      ],
    });
    const packed = packCatalogue(tree);
    expect(packed.entryPool.length).toBeLessThan(
      1 + tree.entries.reduce((n, e) => n + 1 + e.children.length, 0),
    );
    expect(loadCatalogue(JSON.parse(JSON.stringify(packed)))).toEqual(tree);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/domain test -- pack-cli`
Expected: FAIL until the test file exists and imports resolve (write test first; it should pass on the already-implemented functions — if so, this task's test is a guard; proceed to write the CLI which the manual verification exercises).

Note: this test passes on Task 1/2 code. Its purpose is a regression guard for the CLI contract. If it passes immediately, that is expected — continue to Step 3.

- [ ] **Step 3: Implement the CLI**

```js
// scripts/pack-ir.mjs
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { packCatalogue, loadCatalogue } from "@muster/domain";

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node scripts/pack-ir.mjs <tree-ir.json> <out-packed.json>");
  process.exit(1);
}

const tree = loadCatalogue(JSON.parse(readFileSync(inPath, "utf8")));
const packed = packCatalogue(tree);
writeFileSync(outPath, JSON.stringify(packed));

const before = statSync(inPath).size;
const after = statSync(outPath).size;
console.error(
  `packed ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB ` +
  `(${((1 - after / before) * 100).toFixed(1)}% smaller); ` +
  `pool ${packed.entryPool.length} subtrees`,
);
```

- [ ] **Step 4: Run the guard test + a manual smoke**

Run: `pnpm --filter @muster/domain test -- pack-cli`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/pack-ir.mjs packages/domain/test/pack-cli.test.ts
git commit -m "feat(scripts): pack-ir CLI producing distributable packed IR"
```

---

### Task 4: apps/web loads through `loadCatalogue`

**Files:**
- Modify: `apps/web/src/App.tsx` (use `loadCatalogue` for static fixture + file input)
- Test: `apps/web/src/packed-load.test.tsx` (packed fixture renders identically)

**Interfaces:**
- Consumes: `loadCatalogue`, `packCatalogue` from `@muster/domain`.
- Produces: no new exports; behavioral change to the load path only.

- [ ] **Step 1: Write failing test**

```tsx
// apps/web/src/packed-load.test.tsx
import { describe, it, expect } from "vitest";
import { loadCatalogue, packCatalogue, IrCatalogue as IrCatalogueSchema } from "@muster/domain";
import mini40k from "./mini40k.ir.json";

// The web load path must accept a packed-v1 payload and yield the same runtime
// catalogue as loading the tree fixture directly.
describe("web packed load path", () => {
  it("loadCatalogue(pack(tree)) equals loadCatalogue(tree)", () => {
    const tree = IrCatalogueSchema.parse(mini40k);
    const packed = JSON.parse(JSON.stringify(packCatalogue(tree)));
    expect(loadCatalogue(packed)).toEqual(loadCatalogue(mini40k));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- packed-load`
Expected: FAIL until imports resolve; passes on Task 1/2 code (guard). If it passes, continue — the App wiring in Step 3 is the real deliverable, covered by the existing `App.test.tsx` suite staying green.

- [ ] **Step 3: Rewire `App.tsx` load path**

In `apps/web/src/App.tsx`:

Replace the import line
```tsx
import { IrCatalogue as IrCatalogueSchema } from "@muster/domain";
```
with
```tsx
import { loadCatalogue } from "@muster/domain";
```
(keep `import type { IrCatalogue } from "@muster/domain";`)

Replace the initial state
```tsx
const [catalogue, setCatalogue] = useState<IrCatalogue>(() => IrCatalogueSchema.parse(mini40k));
```
with
```tsx
const [catalogue, setCatalogue] = useState<IrCatalogue>(() => loadCatalogue(mini40k));
```

Replace in `loadIr`
```tsx
const parsed = IrCatalogueSchema.parse(JSON.parse(await file.text()));
```
with
```tsx
const parsed = loadCatalogue(JSON.parse(await file.text()));
```

- [ ] **Step 4: Run web suite**

Run: `pnpm --filter web test`
Expected: PASS (packed-load guard + all existing App/builder tests green — runtime catalogue unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/packed-load.test.tsx
git commit -m "feat(web): load catalogues through loadCatalogue (packed or tree)"
```

---

## Self-Review

- **Spec coverage:** canonicalKey (T1), PackedEntry/PackedCatalogue schemas (T1), packCatalogue/rehydrateCatalogue + shared-ref/round-trip/keystone tests (T1), loadCatalogue dispatch (T2), pack CLI (T3), web load path + packed render (T4), post-merge real-SM pack+load verification (manual, controller). All covered.
- **Type consistency:** `packCatalogue`/`rehydrateCatalogue`/`loadCatalogue` signatures identical across tasks; `PackedCatalogue`/`PackedEntry` names stable.
- **`noUncheckedIndexedAccess`:** `p.entryPool[i]` guarded (`if (!pe) throw`); `built[i]` memo checked; test uses `!` on known-present indices.
- **Placeholder scan:** none.
