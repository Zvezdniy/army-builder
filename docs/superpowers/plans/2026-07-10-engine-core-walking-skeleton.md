# Engine Core (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the TypeScript monorepo and build the roster **evaluation engine** (`engine-eval`) plus its shared **IR/roster/validation contract** (`domain`), proving on hand-authored IR fixtures that scope-aggregated constraint validation and points totaling work correctly — the spec's stated risk #1.

**Architecture:** Two workspace packages. `@muster/domain` holds Zod schemas + inferred types for the catalogue IR, the roster tree, and the validation result — the single contract every other package consumes. `@muster/engine-eval` is pure TypeScript (no I/O): it loads a catalogue IR into a symbol table, flattens a roster into an evaluable node tree, and computes points cost + constraint violations with granular reasons. Everything is driven by synthetic IR fixtures now; the Rust parser (real `.cat` → IR) and the Expo builder are follow-on plans that reuse this exact contract.

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript (strict, ESM), Zod, Vitest, fast-check. Node LTS (20+).

## Global Constraints

Every task's requirements implicitly include this section. Values copied from the spec.

- **`engine-eval` is pure TS with zero I/O** — it is imported and tested in isolation, and later executes both on-client (offline) and on-server (authoritative). No file/network/DB access. (§4, §5)
- **All cross-package shared types are Zod schemas** with inferred TS types living in `@muster/domain`. (§4)
- **TypeScript `strict: true`**, ESM (`"type": "module"`), `moduleResolution: "Bundler"`.
- **Scope aggregation is correctness-risk #1** — its test suite is written early and broadly (self/parent/force/roster × selections/points × includeChildSelections). (§4, §12.1)
- **Never block edits** — validation reports issues, it does not prevent states. `evaluate` always returns a result; hard problems are `severity: "error"`, soft ones `severity: "warning"`. (§9.2.5)
- **Determinism** — `evaluate` is a pure function; identical inputs give identical output (idempotent re-eval). (§12.1)
- **Perf budget** — re-evaluation of a ~2000-point roster must be **< ~50 ms**. (§15, §12.6)
- **Tooling:** monorepo orchestrated by **Turborepo**; package manager **pnpm** (workspaces). (§18)
- **Naming:** npm scope `@muster/*` is a placeholder tracking the TBD public name (§13.5); it is trivially renamable and carries no GW terms. The internal codename "Astronomican Lighthouse" never appears in package names or user-facing strings. (§14)

**Deliberately out of this plan (documented boundaries, later plans):**
- Conditional modifiers (`set/increment/decrement`), conditions/condition-group/repeat, and the fixed-point loop — the modifier engine is the **next** engine plan. This plan validates the static subset (points cap, category slots, per-selection min/max). Detachment rules, understrength (`set min=0`), and the app-level override / house-rules layer depend on modifiers and are therefore deferred. (§5)
- The Rust `engine-parser` and real `.cat`/`.gst` parsing — separate plan. This plan consumes hand-authored IR that conforms to the `domain` schema. (§5)
- `apps/mobile`, `apps/api`, `apps/web`, sync, auth — later plans. (§4)

---

### Task 1: Monorepo scaffold + `@muster/domain` bootstrap

Establishes the workspace, shared tooling, and one trivial Zod schema with a passing test — proving the toolchain end-to-end before piling on schemas.

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `vitest.shared.ts`
- Create: `.nvmrc`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/domain/vitest.config.ts`
- Create: `packages/domain/src/validation.ts`
- Create: `packages/domain/src/index.ts`
- Test: `packages/domain/test/validation.test.ts`

**Interfaces:**
- Produces: `Issue` (Zod schema + type) with fields `{ severity: "error" | "warning"; code: string; message: string; selectionId?: string; entryId?: string; constraintId?: string }`. `ValidationResult` (Zod schema + type) with `{ valid: boolean; totalPoints: number; pointsLimit: number; issues: Issue[] }`.

- [ ] **Step 1: Create root workspace config**

`package.json`:
```json
{
  "name": "muster",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "scripts": {
    "test": "turbo run test",
    "typecheck": "turbo run typecheck"
  },
  "devDependencies": {
    "@types/node": "^22.7.0",
    "fast-check": "^3.22.0",
    "turbo": "^2.1.0",
    "typescript": "^5.6.0",
    "vite-tsconfig-paths": "^5.0.0",
    "vitest": "^2.1.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`turbo.json`:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "test": {},
    "typecheck": {}
  }
}
```

`.nvmrc`:
```
20
```

- [ ] **Step 2: Create shared TS + Vitest config**

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "baseUrl": ".",
    "paths": {
      "@muster/domain": ["packages/domain/src/index.ts"],
      "@muster/engine-eval": ["packages/engine-eval/src/index.ts"]
    }
  }
}
```

`vitest.shared.ts`:
```ts
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Shared Vitest config. tsconfigPaths resolves "@muster/*" workspace
// imports to package source via tsconfig.base.json "paths" (extends-aware),
// so tests run against TS source with no build step.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { globals: true, environment: "node" },
});
```

- [ ] **Step 3: Create the `@muster/domain` package**

`packages/domain/package.json`:
```json
{
  "name": "@muster/domain",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

`packages/domain/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/domain/vitest.config.ts`:
```ts
import shared from "../../vitest.shared";

export default shared;
```

- [ ] **Step 4: Write the failing test**

`packages/domain/test/validation.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Issue, ValidationResult } from "@muster/domain";

describe("validation schemas", () => {
  it("accepts a well-formed Issue", () => {
    const parsed = Issue.parse({
      severity: "error",
      code: "points.over",
      message: "Over points limit",
    });
    expect(parsed.severity).toBe("error");
  });

  it("rejects an unknown severity", () => {
    expect(() => Issue.parse({ severity: "info", code: "x", message: "y" })).toThrow();
  });

  it("accepts a well-formed ValidationResult", () => {
    const result = ValidationResult.parse({
      valid: true,
      totalPoints: 0,
      pointsLimit: 2000,
      issues: [],
    });
    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @muster/domain test`
Expected: FAIL — cannot resolve `@muster/domain` / `Issue` is not exported (files not created yet).

- [ ] **Step 6: Implement the schemas**

`packages/domain/src/validation.ts`:
```ts
import { z } from "zod";

export const Issue = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.string(),
  message: z.string(),
  selectionId: z.string().optional(),
  entryId: z.string().optional(),
  constraintId: z.string().optional(),
});
export type Issue = z.infer<typeof Issue>;

export const ValidationResult = z.object({
  valid: z.boolean(),
  totalPoints: z.number(),
  pointsLimit: z.number(),
  issues: z.array(Issue),
});
export type ValidationResult = z.infer<typeof ValidationResult>;
```

`packages/domain/src/index.ts`:
```ts
export * from "./validation";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json vitest.shared.ts .nvmrc packages/domain pnpm-lock.yaml
git commit -m "chore: scaffold pnpm/turbo monorepo + domain validation schemas"
```

---

### Task 2: `domain` — catalogue IR schemas

The IR is the compiled contract the Rust parser will emit and the engine consumes: entries with costs, categories, constraints, and nested children, plus force-level constraints.

**Files:**
- Create: `packages/domain/src/ir.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/ir.test.ts`

**Interfaces:**
- Produces:
  - `IrCost` — `{ name: string; value: number }`.
  - `IrConstraint` — `{ id: string; type: "min" | "max"; value: number; field: "selections" | "points"; scope: "self" | "parent" | "force" | "roster"; targetType: "category" | "entry"; targetId: string; includeChildSelections: boolean }`.
  - `IrEntry` (recursive) — `{ id: string; name: string; costs: IrCost[]; categories: string[]; constraints: IrConstraint[]; children: IrEntry[] }`.
  - `IrCatalogue` — `{ id: string; name: string; gameSystemId: string; revision: number; entries: IrEntry[]; forceConstraints: IrConstraint[] }`.

- [ ] **Step 1: Write the failing test**

`packages/domain/test/ir.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { IrCatalogue, IrConstraint } from "@muster/domain";

describe("IR schemas", () => {
  it("defaults includeChildSelections to false", () => {
    const c = IrConstraint.parse({
      id: "c1",
      type: "max",
      value: 3,
      field: "selections",
      scope: "force",
      targetType: "category",
      targetId: "cat.heavy",
    });
    expect(c.includeChildSelections).toBe(false);
  });

  it("parses a recursive catalogue with nested children", () => {
    const cat = IrCatalogue.parse({
      id: "cat.demo",
      name: "Demo",
      gameSystemId: "gs.40k",
      revision: 1,
      forceConstraints: [],
      entries: [
        {
          id: "e.unit",
          name: "Unit",
          costs: [{ name: "points", value: 100 }],
          categories: ["cat.troops"],
          constraints: [],
          children: [
            { id: "e.wargear", name: "Wargear", costs: [{ name: "points", value: 5 }] },
          ],
        },
      ],
    });
    expect(cat.entries[0]?.children[0]?.name).toBe("Wargear");
    // children/categories/constraints default to [] when omitted
    expect(cat.entries[0]?.children[0]?.children).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test ir`
Expected: FAIL — `IrCatalogue` not exported.

- [ ] **Step 3: Implement the IR schemas**

`packages/domain/src/ir.ts`:
```ts
import { z } from "zod";

export const IrCost = z.object({
  name: z.string(),
  value: z.number(),
});
export type IrCost = z.infer<typeof IrCost>;

export const IrConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number(),
  field: z.enum(["selections", "points"]),
  scope: z.enum(["self", "parent", "force", "roster"]),
  targetType: z.enum(["category", "entry"]),
  targetId: z.string(),
  includeChildSelections: z.boolean().default(false),
});
export type IrConstraint = z.infer<typeof IrConstraint>;

// Recursive type declared explicitly so the Zod lazy schema can annotate itself.
export interface IrEntry {
  id: string;
  name: string;
  costs: IrCost[];
  categories: string[];
  constraints: IrConstraint[];
  children: IrEntry[];
}
// Input generic is `unknown`: the `.default([])` fields are optional in the
// schema's INPUT type, so pinning Input to IrEntry (required fields) fails
// strict typecheck. Output stays IrEntry; `.parse` takes unknown anyway.
export const IrEntry: z.ZodType<IrEntry, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    name: z.string(),
    costs: z.array(IrCost).default([]),
    categories: z.array(z.string()).default([]),
    constraints: z.array(IrConstraint).default([]),
    children: z.array(IrEntry).default([]),
  }),
);

export const IrCatalogue = z.object({
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  revision: z.number(),
  entries: z.array(IrEntry),
  forceConstraints: z.array(IrConstraint).default([]),
});
export type IrCatalogue = z.infer<typeof IrCatalogue>;
```

`packages/domain/src/index.ts`:
```ts
export * from "./ir";
export * from "./validation";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test ir`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/src/index.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): add catalogue IR schemas"
```

---

### Task 3: `domain` — roster schemas

The living roster tree the engine evaluates: nested selections referencing IR entries by id, each with a multiplicity.

**Files:**
- Create: `packages/domain/src/roster.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/roster.test.ts`

**Interfaces:**
- Produces:
  - `RosterSelection` (recursive) — `{ id: string; entryId: string; count: number; selections: RosterSelection[] }`. `count` is a positive integer.
  - `Roster` — `{ id: string; name: string; gameSystemId: string; catalogueId: string; catalogueRevision: number; pointsLimit: number; selections: RosterSelection[] }`.

- [ ] **Step 1: Write the failing test**

`packages/domain/test/roster.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Roster, RosterSelection } from "@muster/domain";

describe("roster schemas", () => {
  it("rejects a non-positive count", () => {
    expect(() =>
      RosterSelection.parse({ id: "s1", entryId: "e.unit", count: 0 }),
    ).toThrow();
  });

  it("parses a nested roster and defaults selections to []", () => {
    const roster = Roster.parse({
      id: "r1",
      name: "My List",
      gameSystemId: "gs.40k",
      catalogueId: "cat.demo",
      catalogueRevision: 1,
      pointsLimit: 2000,
      selections: [
        {
          id: "s1",
          entryId: "e.unit",
          count: 1,
          selections: [{ id: "s2", entryId: "e.wargear", count: 2 }],
        },
      ],
    });
    expect(roster.selections[0]?.selections[0]?.count).toBe(2);
    expect(roster.selections[0]?.selections[0]?.selections).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test roster`
Expected: FAIL — `Roster` not exported.

- [ ] **Step 3: Implement the roster schemas**

`packages/domain/src/roster.ts`:
```ts
import { z } from "zod";

export interface RosterSelection {
  id: string;
  entryId: string;
  count: number;
  selections: RosterSelection[];
}
// Input generic is `unknown` for the same reason as IrEntry: the
// `.default([])` on `selections` makes it optional in the input type.
export const RosterSelection: z.ZodType<RosterSelection, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    id: z.string(),
    entryId: z.string(),
    count: z.number().int().positive(),
    selections: z.array(RosterSelection).default([]),
  }),
);

export const Roster = z.object({
  id: z.string(),
  name: z.string(),
  gameSystemId: z.string(),
  catalogueId: z.string(),
  catalogueRevision: z.number(),
  pointsLimit: z.number(),
  selections: z.array(RosterSelection).default([]),
});
export type Roster = z.infer<typeof Roster>;
```

`packages/domain/src/index.ts`:
```ts
export * from "./ir";
export * from "./roster";
export * from "./validation";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test roster`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/roster.ts packages/domain/src/index.ts packages/domain/test/roster.test.ts
git commit -m "feat(domain): add roster tree schemas"
```

---

### Task 4: `engine-eval` scaffold + symbol table

Creates the second package and its first real unit: a symbol table indexing every IR entry (including nested children) by id, with duplicate-id detection.

**Files:**
- Create: `packages/engine-eval/package.json`
- Create: `packages/engine-eval/tsconfig.json`
- Create: `packages/engine-eval/vitest.config.ts`
- Create: `packages/engine-eval/src/symbols.ts`
- Create: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/symbols.test.ts`

**Interfaces:**
- Consumes: `IrCatalogue`, `IrEntry` from `@muster/domain`.
- Produces:
  - `type SymbolTable = Map<string, IrEntry>`.
  - `buildSymbolTable(catalogue: IrCatalogue): SymbolTable` — indexes all entries recursively; throws `Error` on a duplicate id.

- [ ] **Step 1: Create the package**

`packages/engine-eval/package.json`:
```json
{
  "name": "@muster/engine-eval",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@muster/domain": "workspace:*"
  }
}
```

`packages/engine-eval/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/engine-eval/vitest.config.ts`:
```ts
import shared from "../../vitest.shared";

export default shared;
```

- [ ] **Step 2: Write the failing test**

`packages/engine-eval/test/symbols.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
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

  it("throws on duplicate ids", () => {
    const dup: IrCatalogue = {
      ...cat,
      entries: [
        { id: "dup", name: "A", costs: [], categories: [], constraints: [], children: [] },
        { id: "dup", name: "B", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    expect(() => buildSymbolTable(dup)).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test`
Expected: FAIL — `buildSymbolTable` not exported.

- [ ] **Step 4: Implement the symbol table**

`packages/engine-eval/src/symbols.ts`:
```ts
import type { IrCatalogue, IrEntry } from "@muster/domain";

export type SymbolTable = Map<string, IrEntry>;

export function buildSymbolTable(catalogue: IrCatalogue): SymbolTable {
  const table: SymbolTable = new Map();
  const walk = (entry: IrEntry): void => {
    if (table.has(entry.id)) {
      throw new Error(`Duplicate entry id in catalogue: ${entry.id}`);
    }
    table.set(entry.id, entry);
    entry.children.forEach(walk);
  };
  catalogue.entries.forEach(walk);
  return table;
}
```

`packages/engine-eval/src/index.ts`:
```ts
export * from "./symbols";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval pnpm-lock.yaml
git commit -m "feat(engine-eval): scaffold package + catalogue symbol table"
```

---

### Task 5: `engine-eval` — eval state builder

Flattens a roster into an `EvalNode` tree: each node resolves its IR entry, carries its own `count`, an inherited `multiplier` (product of ancestor counts), and `effectiveCount = count * multiplier`, plus parent/child links and categories. This node model is what every downstream computation walks.

**Files:**
- Create: `packages/engine-eval/src/state.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/state.test.ts`

**Interfaces:**
- Consumes: `Roster`, `RosterSelection`, `IrEntry` from `@muster/domain`; `SymbolTable` from `./symbols`.
- Produces:
  - `interface EvalNode { selectionId: string; entry: IrEntry; count: number; multiplier: number; effectiveCount: number; categories: string[]; parent: EvalNode | null; children: EvalNode[] }`.
  - `interface EvalState { roots: EvalNode[]; all: EvalNode[] }`.
  - `buildState(roster: Roster, symbols: SymbolTable): EvalState` — throws `Error` on an unknown `entryId`. `all` is a flat list of every node (pre-order).

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/state.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildSymbolTable, buildState } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.squad", name: "Squad", costs: [], categories: ["cat.troops"], constraints: [],
      children: [{ id: "e.model", name: "Model", costs: [], categories: [], constraints: [], children: [] }] },
  ],
};

const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "s.squad", entryId: "e.squad", count: 2,
      selections: [{ id: "s.model", entryId: "e.model", count: 5, selections: [] }] },
  ],
};

describe("buildState", () => {
  it("computes multiplier and effectiveCount down the tree", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    const squad = state.roots[0]!;
    expect(squad.multiplier).toBe(1);
    expect(squad.effectiveCount).toBe(2);
    const model = squad.children[0]!;
    expect(model.multiplier).toBe(2); // ancestor squad count
    expect(model.effectiveCount).toBe(10); // 5 models * 2 squads
    expect(model.parent).toBe(squad);
    expect(state.all).toHaveLength(2);
  });

  it("throws on an unknown entryId", () => {
    const bad: Roster = { ...roster, selections: [{ id: "x", entryId: "nope", count: 1, selections: [] }] };
    expect(() => buildState(bad, buildSymbolTable(cat))).toThrow(/unknown entryid/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test state`
Expected: FAIL — `buildState` not exported.

- [ ] **Step 3: Implement the state builder**

`packages/engine-eval/src/state.ts`:
```ts
import type { Roster, RosterSelection, IrEntry } from "@muster/domain";
import type { SymbolTable } from "./symbols";

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

export function buildState(roster: Roster, symbols: SymbolTable): EvalState {
  const all: EvalNode[] = [];

  const build = (
    selection: RosterSelection,
    parent: EvalNode | null,
    parentMultiplier: number,
  ): EvalNode => {
    const entry = symbols.get(selection.entryId);
    if (!entry) {
      throw new Error(`Unknown entryId in roster: ${selection.entryId}`);
    }
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
      build(child, node, node.effectiveCount),
    );
    return node;
  };

  const roots = roster.selections.map((s) => build(s, null, 1));
  return { roots, all };
}
```

`packages/engine-eval/src/index.ts`:
```ts
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/state.ts packages/engine-eval/src/index.ts packages/engine-eval/test/state.test.ts
git commit -m "feat(engine-eval): build eval-node state tree from roster"
```

---

### Task 6: `engine-eval` — cost aggregation

Points totaling: each node contributes `(its "points" cost) * effectiveCount`; the roster total is the sum over all nodes.

**Files:**
- Create: `packages/engine-eval/src/cost.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/cost.test.ts`

**Interfaces:**
- Consumes: `EvalState`, `EvalNode` from `./state`.
- Produces:
  - `nodePoints(node: EvalNode): number` — the node's own "points" cost × `effectiveCount` (0 if no points cost).
  - `totalCost(state: EvalState): number` — sum of `nodePoints` over `state.all`.

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/cost.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildSymbolTable, buildState, totalCost } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: [], constraints: [],
      children: [{ id: "e.gun", name: "Gun", costs: [{ name: "points", value: 5 }], categories: [], constraints: [], children: [] }] },
  ],
};

describe("totalCost", () => {
  it("multiplies costs by effectiveCount through the tree", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "s.squad", entryId: "e.squad", count: 2,
          selections: [{ id: "s.gun", entryId: "e.gun", count: 3, selections: [] }] },
      ],
    };
    // squad: 100 * 2 = 200; gun: 5 * (3 * 2) = 30 => 230
    const state = buildState(roster, buildSymbolTable(cat));
    expect(totalCost(state)).toBe(230);
  });

  it("is 0 for an empty roster", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000, selections: [],
    };
    expect(totalCost(buildState(roster, buildSymbolTable(cat)))).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test cost`
Expected: FAIL — `totalCost` not exported.

- [ ] **Step 3: Implement cost aggregation**

`packages/engine-eval/src/cost.ts`:
```ts
import type { EvalNode, EvalState } from "./state";

export function nodePoints(node: EvalNode): number {
  const cost = node.entry.costs.find((c) => c.name === "points");
  return (cost?.value ?? 0) * node.effectiveCount;
}

export function totalCost(state: EvalState): number {
  return state.all.reduce((sum, node) => sum + nodePoints(node), 0);
}
```

`packages/engine-eval/src/index.ts`:
```ts
export * from "./cost";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test cost`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/cost.ts packages/engine-eval/src/index.ts packages/engine-eval/test/cost.test.ts
git commit -m "feat(engine-eval): points cost aggregation"
```

---

### Task 7: `engine-eval` — scope aggregation (risk #1)

The centerpiece. Given a constraint and (for self/parent) an owning node, compute the aggregated value the constraint compares against: resolve the scope's node set, filter to nodes matching the target (category or entry), then sum `effectiveCount` (field `selections`) or points (field `points`). This is the spec's correctness-risk #1, so the test suite is broad.

**Files:**
- Create: `packages/engine-eval/src/scopes.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/scopes.test.ts`

**Interfaces:**
- Consumes: `IrConstraint` from `@muster/domain`; `EvalState`, `EvalNode` from `./state`.
- Produces:
  - `aggregate(node: EvalNode | null, constraint: IrConstraint, state: EvalState): number`. For `scope` `force`/`roster`, `node` is ignored (pass `null`). For `self`/`parent`, `node` is required; passing `null` throws. `self` = the node's subtree if `includeChildSelections` else just the node; `parent` = the parent's subtree (or the node's own subtree if it has no parent), same include rule.

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/scopes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrConstraint, Roster } from "@muster/domain";
import { buildSymbolTable, buildState, aggregate } from "@muster/engine-eval";
import type { EvalNode } from "@muster/engine-eval";

// Catalogue: two HQ, three Heavy units; a squad with 2 special-weapon options.
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.hq", name: "HQ", costs: [{ name: "points", value: 80 }], categories: ["cat.hq"], constraints: [], children: [] },
    { id: "e.heavy", name: "Heavy", costs: [{ name: "points", value: 150 }], categories: ["cat.heavy"], constraints: [], children: [] },
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: ["cat.troops"], constraints: [],
      children: [{ id: "e.special", name: "Special", costs: [{ name: "points", value: 10 }], categories: ["cat.special"], constraints: [], children: [] }] },
  ],
};

const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "s.hq1", entryId: "e.hq", count: 1, selections: [] },
    { id: "s.heavy1", entryId: "e.heavy", count: 1, selections: [] },
    { id: "s.heavy2", entryId: "e.heavy", count: 1, selections: [] },
    { id: "s.heavy3", entryId: "e.heavy", count: 1, selections: [] },
    { id: "s.squad", entryId: "e.squad", count: 1,
      selections: [{ id: "s.sp", entryId: "e.special", count: 2, selections: [] }] },
  ],
};

function setup() {
  const state = buildState(roster, buildSymbolTable(cat));
  const byId = (id: string): EvalNode => state.all.find((n) => n.selectionId === id)!;
  return { state, byId };
}

const base = { id: "c1", value: 0, includeChildSelections: false } as const;

describe("aggregate", () => {
  it("force/roster scope counts selections by category across the whole roster", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(null, c, state)).toBe(3);
  });

  it("roster scope sums points by category", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "points", scope: "roster", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(null, c, state)).toBe(450); // 3 * 150
  });

  it("counts selections by entry id", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "min", field: "selections", scope: "force", targetType: "entry", targetId: "e.hq" };
    expect(aggregate(null, c, state)).toBe(1);
  });

  it("self scope without includeChildSelections sees only the node", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad");
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(aggregate(squad, c, state)).toBe(0); // special is a child, excluded
  });

  it("self scope with includeChildSelections sees descendants (effectiveCount)", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(aggregate(squad, c, state)).toBe(2); // 2 special weapons
  });

  it("parent scope counts within the parent subtree", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "selections", scope: "parent", targetType: "category", targetId: "cat.special" };
    expect(aggregate(special, c, state)).toBe(2);
  });

  it("throws if self/parent scope is given a null node", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(() => aggregate(null, c, state)).toThrow(/requires an owning node/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test scopes`
Expected: FAIL — `aggregate` not exported.

- [ ] **Step 3: Implement scope aggregation**

`packages/engine-eval/src/scopes.ts`:
```ts
import type { IrConstraint } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";

function subtree(node: EvalNode, includeChildren: boolean): EvalNode[] {
  if (!includeChildren) return [node];
  const acc: EvalNode[] = [];
  const walk = (n: EvalNode): void => {
    acc.push(n);
    n.children.forEach(walk);
  };
  walk(node);
  return acc;
}

// The candidate node set a constraint sees, before target filtering.
function scopeNodes(
  node: EvalNode | null,
  constraint: IrConstraint,
  state: EvalState,
): EvalNode[] {
  switch (constraint.scope) {
    case "force":
    case "roster":
      return state.all;
    case "self":
      if (!node) throw new Error(`Constraint ${constraint.id} (scope=self) requires an owning node`);
      return subtree(node, constraint.includeChildSelections);
    case "parent": {
      if (!node) throw new Error(`Constraint ${constraint.id} (scope=parent) requires an owning node`);
      const anchor = node.parent ?? node;
      return subtree(anchor, constraint.includeChildSelections);
    }
  }
}

function matchesTarget(node: EvalNode, constraint: IrConstraint): boolean {
  return constraint.targetType === "category"
    ? node.categories.includes(constraint.targetId)
    : node.entry.id === constraint.targetId;
}

export function aggregate(
  node: EvalNode | null,
  constraint: IrConstraint,
  state: EvalState,
): number {
  const matched = scopeNodes(node, constraint, state).filter((n) =>
    matchesTarget(n, constraint),
  );
  if (constraint.field === "selections") {
    return matched.reduce((sum, n) => sum + n.effectiveCount, 0);
  }
  return matched.reduce((sum, n) => {
    const cost = n.entry.costs.find((c) => c.name === "points");
    return sum + (cost?.value ?? 0) * n.effectiveCount;
  }, 0);
}
```

`packages/engine-eval/src/index.ts`:
```ts
export * from "./cost";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test scopes`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/scopes.ts packages/engine-eval/src/index.ts packages/engine-eval/test/scopes.test.ts
git commit -m "feat(engine-eval): scope-aggregated constraint values (risk #1)"
```

---

### Task 8: `engine-eval` — constraint check → Issue

Turns one constraint into a granular `Issue` (or `null` if satisfied): compares the aggregated value against min/max and emits a human-readable reason carrying the offending selection/entry/constraint ids.

**Files:**
- Create: `packages/engine-eval/src/constraints.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/constraints.test.ts`

**Interfaces:**
- Consumes: `IrConstraint`, `Issue` from `@muster/domain`; `EvalState`, `EvalNode` from `./state`; `aggregate` from `./scopes`.
- Produces:
  - `checkConstraint(constraint: IrConstraint, node: EvalNode | null, state: EvalState): Issue | null`. `max` violated when actual > value; `min` violated when actual < value. Issue `code` is `constraint.min` or `constraint.max`, `severity` `"error"`.

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/constraints.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrConstraint, Roster } from "@muster/domain";
import { buildSymbolTable, buildState, checkConstraint } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e.heavy", name: "Heavy", costs: [], categories: ["cat.heavy"], constraints: [], children: [] }],
};
const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "h1", entryId: "e.heavy", count: 1, selections: [] },
    { id: "h2", entryId: "e.heavy", count: 1, selections: [] },
    { id: "h3", entryId: "e.heavy", count: 1, selections: [] },
    { id: "h4", entryId: "e.heavy", count: 1, selections: [] },
  ],
};
const c = (over: Partial<IrConstraint>): IrConstraint => ({
  id: "c1", type: "max", value: 3, field: "selections", scope: "force",
  targetType: "category", targetId: "cat.heavy", includeChildSelections: false, ...over,
});

describe("checkConstraint", () => {
  it("returns an error Issue when a max is exceeded", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    const issue = checkConstraint(c({}), null, state);
    expect(issue?.severity).toBe("error");
    expect(issue?.code).toBe("constraint.max");
    expect(issue?.constraintId).toBe("c1");
    expect(issue?.message).toMatch(/4 .*max 3/);
  });

  it("returns null when satisfied", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    expect(checkConstraint(c({ value: 4 }), null, state)).toBeNull();
  });

  it("flags a min violation", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    const issue = checkConstraint(c({ type: "min", value: 6 }), null, state);
    expect(issue?.code).toBe("constraint.min");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test constraints`
Expected: FAIL — `checkConstraint` not exported.

- [ ] **Step 3: Implement the constraint check**

`packages/engine-eval/src/constraints.ts`:
```ts
import type { IrConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate } from "./scopes";

export function checkConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
): Issue | null {
  const actual = aggregate(node, constraint, state);
  const violated =
    constraint.type === "max"
      ? actual > constraint.value
      : actual < constraint.value;
  if (!violated) return null;

  const target = `${constraint.targetType} "${constraint.targetId}"`;
  const message =
    constraint.type === "max"
      ? `Too many ${target}: ${actual} exceeds max ${constraint.value}`
      : `Not enough ${target}: ${actual} below min ${constraint.value}`;

  return {
    severity: "error",
    code: `constraint.${constraint.type}`,
    message,
    selectionId: node?.selectionId,
    entryId: node?.entry.id,
    constraintId: constraint.id,
  };
}
```

`packages/engine-eval/src/index.ts`:
```ts
export * from "./constraints";
export * from "./cost";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test constraints`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/constraints.ts packages/engine-eval/src/index.ts packages/engine-eval/test/constraints.test.ts
git commit -m "feat(engine-eval): constraint check produces granular Issues"
```

---

### Task 9: `engine-eval` — top-level `evaluate` + realistic 40k-shaped fixture

Wires everything into the public entry point: build symbols + state, total the points against the roster cap, run force constraints and every node's own constraints, and return a `ValidationResult`. Integration-tested against a hand-authored 40k-shaped mini catalogue with one legal roster and several illegal variants (over points, too many Heavy Support, missing HQ).

**Files:**
- Create: `packages/engine-eval/src/evaluate.ts`
- Create: `packages/engine-eval/test/fixtures/mini40k.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/evaluate.test.ts`

**Interfaces:**
- Consumes: `Roster`, `IrCatalogue`, `ValidationResult`, `Issue` from `@muster/domain`; `buildSymbolTable`, `buildState`, `totalCost`, `checkConstraint`.
- Produces:
  - `evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult`. Adds a `points.over` error when `totalCost > roster.pointsLimit`. `valid` is true iff no `error`-severity issues. Force constraints (from `catalogue.forceConstraints`) evaluated with `node = null`; entry constraints evaluated per node.
- Fixture produces: `mini40kCatalogue: IrCatalogue`, `legalRoster: Roster`, and helper `rosterWith(selections): Roster`.

- [ ] **Step 1: Write the fixture**

`packages/engine-eval/test/fixtures/mini40k.ts`:
```ts
import type { IrCatalogue, Roster, RosterSelection } from "@muster/domain";

// A 40k-shaped mini catalogue: force requires 1-2 HQ and max 3 Heavy Support.
export const mini40kCatalogue: IrCatalogue = {
  id: "cat.mini40k",
  name: "Mini 40k",
  gameSystemId: "gs.40k",
  revision: 1,
  forceConstraints: [
    { id: "fc.hq.min", type: "min", value: 1, field: "selections", scope: "force", targetType: "category", targetId: "cat.hq", includeChildSelections: false },
    { id: "fc.hq.max", type: "max", value: 2, field: "selections", scope: "force", targetType: "category", targetId: "cat.hq", includeChildSelections: false },
    { id: "fc.heavy.max", type: "max", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy", includeChildSelections: false },
  ],
  entries: [
    { id: "e.captain", name: "Captain", costs: [{ name: "points", value: 80 }], categories: ["cat.hq"], constraints: [], children: [] },
    { id: "e.troops", name: "Battle Line", costs: [{ name: "points", value: 100 }], categories: ["cat.troops"], constraints: [], children: [] },
    { id: "e.heavy", name: "Heavy Support", costs: [{ name: "points", value: 150 }], categories: ["cat.heavy"], constraints: [], children: [] },
  ],
};

let seq = 0;
const sel = (entryId: string, count = 1): RosterSelection => ({
  id: `s${seq++}`,
  entryId,
  count,
  selections: [],
});

export function rosterWith(selections: RosterSelection[], pointsLimit = 1000): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs.40k",
    catalogueId: "cat.mini40k", catalogueRevision: 1,
    pointsLimit, selections,
  };
}

// 80 + 100 + 100 + 150 = 430, 1 HQ, 1 Heavy — legal at 1000.
export const legalRoster: Roster = rosterWith([
  sel("e.captain"),
  sel("e.troops"),
  sel("e.troops"),
  sel("e.heavy"),
]);

export { sel };
```

- [ ] **Step 2: Write the failing test**

`packages/engine-eval/test/evaluate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, legalRoster, rosterWith, sel } from "./fixtures/mini40k";

describe("evaluate", () => {
  it("passes a legal roster", () => {
    const result = evaluate(legalRoster, mini40kCatalogue);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.totalPoints).toBe(430);
  });

  it("flags going over the points cap", () => {
    const result = evaluate(rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy")], 200), mini40kCatalogue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "points.over")).toBe(true);
  });

  it("flags too many Heavy Support (force max)", () => {
    const result = evaluate(
      rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy"), sel("e.heavy"), sel("e.heavy")]),
      mini40kCatalogue,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.heavy.max")).toBe(true);
  });

  it("flags a missing HQ (force min)", () => {
    const result = evaluate(rosterWith([sel("e.troops")]), mini40kCatalogue);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.min")).toBe(true);
  });

  it("is deterministic / idempotent", () => {
    const a = evaluate(legalRoster, mini40kCatalogue);
    const b = evaluate(legalRoster, mini40kCatalogue);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test evaluate`
Expected: FAIL — `evaluate` not exported.

- [ ] **Step 4: Implement `evaluate`**

`packages/engine-eval/src/evaluate.ts`:
```ts
import type { Roster, IrCatalogue, ValidationResult, Issue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState } from "./state";
import { totalCost } from "./cost";
import { checkConstraint } from "./constraints";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const issues: Issue[] = [];

  const totalPoints = totalCost(state);
  if (totalPoints > roster.pointsLimit) {
    issues.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
    });
  }

  for (const constraint of catalogue.forceConstraints) {
    const issue = checkConstraint(constraint, null, state);
    if (issue) issues.push(issue);
  }

  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state);
      if (issue) issues.push(issue);
    }
  }

  const valid = !issues.some((i) => i.severity === "error");
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues };
}
```

`packages/engine-eval/src/index.ts`:
```ts
export * from "./constraints";
export * from "./cost";
export * from "./evaluate";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test evaluate`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/evaluate.ts packages/engine-eval/src/index.ts packages/engine-eval/test/evaluate.test.ts packages/engine-eval/test/fixtures/mini40k.ts
git commit -m "feat(engine-eval): top-level evaluate + 40k-shaped integration fixture"
```

---

### Task 10: `engine-eval` — property-based invariants + perf budget

Locks in the engine's guarantees: fast-check throws random legal rosters at `evaluate` to assert it never crashes, totals are non-negative, and re-eval is idempotent; a perf smoke test asserts a ~2000-point roster evaluates under the spec's 50 ms budget.

**Files:**
- Test: `packages/engine-eval/test/property.test.ts`
- Test: `packages/engine-eval/test/perf.test.ts`

**Interfaces:**
- Consumes: `evaluate` and the `mini40k` fixture; `fast-check`.

- [ ] **Step 1: Write the property test**

`packages/engine-eval/test/property.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, rosterWith, sel } from "./fixtures/mini40k";

const entryIds = ["e.captain", "e.troops", "e.heavy"] as const;

const arbSelections = fc.array(
  fc.record({
    entry: fc.constantFrom(...entryIds),
    count: fc.integer({ min: 1, max: 10 }),
  }),
  { maxLength: 30 },
);

describe("evaluate invariants", () => {
  it("never throws and totals are non-negative and idempotent", () => {
    fc.assert(
      fc.property(arbSelections, fc.integer({ min: 0, max: 3000 }), (specs, limit) => {
        const roster = rosterWith(specs.map((s) => sel(s.entry, s.count)), limit);
        const a = evaluate(roster, mini40kCatalogue);
        const b = evaluate(roster, mini40kCatalogue);
        expect(a.totalPoints).toBeGreaterThanOrEqual(0);
        expect(a).toEqual(b);
      }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm --filter @muster/engine-eval test property`
Expected: PASS. (If it fails, a real invariant bug was found — fix the engine, not the test.)

- [ ] **Step 3: Write the perf smoke test**

`packages/engine-eval/test/perf.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, rosterWith, sel } from "./fixtures/mini40k";

describe("evaluate performance", () => {
  it("evaluates a ~2000-point roster well under 50ms", () => {
    // ~20 units (~2000 pts of Heavy/Troops) + HQ.
    const selections = [sel("e.captain")];
    for (let i = 0; i < 10; i++) selections.push(sel("e.heavy"));
    for (let i = 0; i < 5; i++) selections.push(sel("e.troops"));
    const roster = rosterWith(selections, 2500);

    // Warm up, then measure a single re-eval.
    evaluate(roster, mini40kCatalogue);
    const start = performance.now();
    evaluate(roster, mini40kCatalogue);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
  });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @muster/engine-eval test perf`
Expected: PASS (comfortably; this subset is far under budget).

- [ ] **Step 5: Run the whole suite + typecheck from the root**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across `@muster/domain` and `@muster/engine-eval`; `tsc --noEmit` clean in both.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/test/property.test.ts packages/engine-eval/test/perf.test.ts
git commit -m "test(engine-eval): property-based invariants + perf budget"
```

---

## Self-Review

**1. Spec coverage (this plan's scope = engine core / risk #1):**
- Two-stage engine split, `engine-eval` pure TS, client+server reuse (§4, §5) → Tasks 4–9; purity enforced by no-I/O constraint.
- Scope aggregation with self/parent/force/roster × selections/points × includeChildSelections (§4, §12.1) → Task 7 (broad suite).
- Points cost aggregation + cap (§8) → Tasks 6, 9.
- Category-slot & min/max validation with granular *reasons* (§8, §9.2.5) → Tasks 8, 9 (Issue carries message + ids).
- Never-block (result always returned, error vs warning) (§9.2.5) → Issue.severity; `evaluate` returns unconditionally.
- Determinism / idempotent re-eval (§12.1) → Tasks 9, 10.
- Property-based invariants via fast-check (§12.5) → Task 10.
- Perf budget <50 ms (§15, §12.6) → Task 10.
- Zod shared contract in `domain` (§4) → Tasks 1–3.
- pnpm + Turborepo + Vitest dev experience (§18) → Task 1.
- **Explicitly deferred and labeled** (not gaps): Rust parser & real `.cat` (§5), conditional modifiers/conditions/repeat/fixed-point & understrength & detachment & house-rules override (§5), apps/sync/auth (§4). Called out in Global Constraints. Each gets its own follow-on plan.

**2. Placeholder scan:** No TBD/TODO; every code and test step shows complete content; no "similar to Task N".

**3. Type consistency:** `IrConstraint` shape (incl. `targetType`/`targetId`/`includeChildSelections`) identical across Tasks 2, 7, 8, 9. `EvalNode`/`EvalState` fields identical across Tasks 5–9. `aggregate(node|null, constraint, state)`, `checkConstraint(constraint, node|null, state)`, `evaluate(roster, catalogue)` signatures consistent between their defining task, `index.ts` exports, and call sites. `Issue`/`ValidationResult` fields consistent between Task 1 and Task 9. Package name `@muster/domain` / `@muster/engine-eval` consistent throughout.

---

## Follow-on plans (complete Phase 1a, then 1b)

1. **`engine-eval` modifiers & conditions** — `set/increment/decrement` against live state, conditions/condition-group/repeat, fixed-point loop, understrength (`set min=0`), detachment rules, and the app-level override / house-rules layer (§5). Reuses this plan's `domain` IR (extended) and `EvalNode` state.
2. **`engine-parser` (Rust)** — real `.catz/.rosz/.gst` → the `domain` IR, with the security hardening of §10.1 (no-XXE, anti-zip-bomb/slip, resource limits) and reference-graph resolution (§5). Feeds real 40k catalogues into this engine.
3. **`apps/mobile` builder slice** — Expo builder screens (§9.2): army list, add-unit picker, unit-config sheet, live two-tier validation display, SQLite persistence — the end-to-end walking skeleton on a device.

These, plus this plan, deliver Phase 1a. Phase 1b (accounts/sync, import `.ros/.rosz`, sharing/export, Reference Mode, multi-system, i18n) and Phases 2a/2b/3 get their own specs → plans.
