# Modifier Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@muster/engine-eval` with the state-dependent modifier layer the spec calls risk #1: conditional `set/increment/decrement` modifiers on constraint bounds and costs, `conditions` / `conditionGroups` gating them, a terminating fixed-point resolver for the cost↔condition feedback loop, and an app-level override / house-rules layer (including understrength).

**Architecture:** Additive on plan 1's engine. New IR nodes (`IrCondition`, `IrConditionGroup`, `IrModifier`) attach to the existing `IrConstraint` and `IrCost`. The engine gains a `CostFn` cost-view that threads through `aggregate`/`totalCost` so conditions can be evaluated against *effective* (post-modifier) costs. `resolveCosts` iterates effective costs to a fixed point (bounded by a max-iteration guard — it must always terminate). Constraint bounds are then resolved against the converged costs, and `evaluate` applies a roster-level override layer that suppresses dismissed issues and flags house-rules. Everything degrades to plan-1 behavior when no modifiers/overrides are present.

**Tech Stack:** TypeScript (strict, ESM), Zod, Vitest, fast-check — unchanged from plan 1.

## Global Constraints

Every task's requirements implicitly include this section.

- **`engine-eval` stays pure TS with zero I/O.** No file/network/DB access. (§4, §5)
- **All shared types are Zod schemas** with inferred types in `@muster/domain`. `strict: true`, `noUncheckedIndexedAccess: true`, `tsc --noEmit` must pass clean.
- **Recursive Zod schemas** use the `z.ZodType<T, z.ZodTypeDef, unknown>` input-generic pattern (the `.default([])`/optional fields make the input type looser than the interface — learned in plan 1 for `IrEntry`/`RosterSelection`).
- **Backward compatibility is mandatory.** Every new field added to an *existing* schema (`IrConstraint.modifiers`, `IrCost.modifiers`, `Roster.overrides`) and every new list field is declared `.optional()`; the engine coalesces `undefined → []` at every read (`x ?? []`). A plan-1 catalogue/roster with no modifiers/overrides must produce a byte-identical `ValidationResult` (aside from the always-present new `dismissed: []` / `hasHouseRules: false` fields). Plan-1 tests and fixtures must keep passing untouched.
- **The fixed-point MUST terminate.** `resolveCosts` is bounded by `MAX_ITERATIONS = 32`; if it does not converge it returns `converged: false` and `evaluate` emits a non-blocking `severity: "warning"` issue (`modifiers.nonconvergent`). Never loop unbounded. (§5 gotcha: modifier order/cycles)
- **Modifier application is ordered and deterministic:** fold applicable modifiers in array order; `set` replaces the running value, `increment` adds `value`, `decrement` subtracts `value`. (§5)
- **Modifier gate semantics:** a modifier applies iff **every** condition in `conditions` passes **and** **every** group in `conditionGroups` passes (AND at the modifier level). An empty gate (no conditions, no groups) always applies. (§5)
- **Condition group semantics:** `type: "and"` → all members true (empty ⇒ true); `type: "or"` → any member true (empty ⇒ false). Members = `conditions` ∪ nested `conditionGroups`.
- **Never block edits.** `evaluate` always returns a result. Overrides *suppress* issues from the active set; they never prevent a state. Understrength and house-rules are the same override mechanism (a dismissed constraint), differentiated only by `source`. (§5, §9.2.5)
- **Perf budget:** re-evaluation of a ~2000-point roster (now including modifier resolution) stays **< ~50 ms**. (§15, §12.6)
- **Determinism:** `evaluate` remains a pure function; identical inputs ⇒ identical output (idempotent). (§12.1)

**Deliberately out of this plan (later plans, do not build here):**
- The Rust `engine-parser` and real `.cat` parsing (separate plan).
- `instanceOf`/`notInstanceOf` condition kinds, `repeat` nodes, and per-model/`shared` cost subtleties beyond what `effectiveCount` already models — deferred; this plan does numeric comparators + set/increment/decrement, which cover understrength, conditional bounds, and conditional costs.
- `apps/*`, sync, auth.

---

### Task 1: `domain` — `IrCondition` schema

A condition is a numeric comparison of an aggregated value (reusing the exact scope/field/target shape constraints already use) against a threshold.

**Files:**
- Create: `packages/domain/src/conditions.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/conditions.test.ts`

**Interfaces:**
- Produces: `IrCondition` = `{ id: string; comparator: "atLeast" | "atMost" | "equalTo" | "notEqualTo" | "greaterThan" | "lessThan"; value: number; field: "selections" | "points"; scope: "self" | "parent" | "force" | "roster"; targetType: "category" | "entry"; targetId: string; includeChildSelections: boolean (default false) }`.

- [ ] **Step 1: Write the failing test**

`packages/domain/test/conditions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { IrCondition } from "@muster/domain";

describe("IrCondition", () => {
  it("parses a condition and defaults includeChildSelections", () => {
    const c = IrCondition.parse({
      id: "cond1",
      comparator: "atLeast",
      value: 3,
      field: "selections",
      scope: "force",
      targetType: "category",
      targetId: "cat.troops",
    });
    expect(c.comparator).toBe("atLeast");
    expect(c.includeChildSelections).toBe(false);
  });

  it("rejects an unknown comparator", () => {
    expect(() =>
      IrCondition.parse({
        id: "c",
        comparator: "roughly",
        value: 1,
        field: "selections",
        scope: "self",
        targetType: "entry",
        targetId: "e.x",
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test conditions`
Expected: FAIL — `IrCondition` not exported.

- [ ] **Step 3: Implement the schema**

`packages/domain/src/conditions.ts`:
```ts
import { z } from "zod";

export const IrCondition = z.object({
  id: z.string(),
  comparator: z.enum([
    "atLeast",
    "atMost",
    "equalTo",
    "notEqualTo",
    "greaterThan",
    "lessThan",
  ]),
  value: z.number(),
  field: z.enum(["selections", "points"]),
  scope: z.enum(["self", "parent", "force", "roster"]),
  targetType: z.enum(["category", "entry"]),
  targetId: z.string(),
  includeChildSelections: z.boolean().default(false),
});
export type IrCondition = z.infer<typeof IrCondition>;
```

`packages/domain/src/index.ts` (add the export; keep the others):
```ts
export * from "./conditions";
export * from "./ir";
export * from "./roster";
export * from "./validation";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test conditions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/conditions.ts packages/domain/src/index.ts packages/domain/test/conditions.test.ts
git commit -m "feat(domain): add IrCondition schema"
```

---

### Task 2: `domain` — `IrConditionGroup` schema (recursive and/or)

Boolean composition of conditions and nested groups.

**Files:**
- Modify: `packages/domain/src/conditions.ts`
- Test: `packages/domain/test/conditions.test.ts`

**Interfaces:**
- Consumes: `IrCondition`.
- Produces: `IrConditionGroup` (recursive) = `{ type: "and" | "or"; conditions?: IrCondition[]; conditionGroups?: IrConditionGroup[] }`. Both list fields are optional (backward-compat / ergonomic literals); the engine coalesces `undefined → []`.

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/test/conditions.test.ts`:
```ts
import { IrConditionGroup } from "@muster/domain";

describe("IrConditionGroup", () => {
  it("parses a nested and/or group; list fields are optional", () => {
    const g = IrConditionGroup.parse({
      type: "or",
      conditions: [
        { id: "a", comparator: "atLeast", value: 1, field: "selections", scope: "force", targetType: "category", targetId: "cat.hq" },
      ],
      conditionGroups: [
        { type: "and" }, // no lists provided — allowed
      ],
    });
    expect(g.type).toBe("or");
    expect(g.conditionGroups?.[0]?.type).toBe("and");
  });

  it("allows a bare group with no lists", () => {
    const g = IrConditionGroup.parse({ type: "and" });
    expect(g.conditions).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test conditions`
Expected: FAIL — `IrConditionGroup` not exported.

- [ ] **Step 3: Implement the recursive schema**

Append to `packages/domain/src/conditions.ts`:
```ts
export interface IrConditionGroup {
  type: "and" | "or";
  conditions?: IrCondition[];
  conditionGroups?: IrConditionGroup[];
}
// Input generic `unknown` for the recursive schema (same reason as IrEntry in plan 1).
export const IrConditionGroup: z.ZodType<IrConditionGroup, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    type: z.enum(["and", "or"]),
    conditions: z.array(IrCondition).optional(),
    conditionGroups: z.array(IrConditionGroup).optional(),
  }),
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test conditions`
Expected: PASS. Also run `pnpm --filter @muster/domain typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/conditions.ts packages/domain/test/conditions.test.ts
git commit -m "feat(domain): add recursive IrConditionGroup schema"
```

---

### Task 3: `domain` — `IrModifier` + attach `modifiers` to `IrConstraint` and `IrCost`

A modifier mutates a numeric value (a constraint bound or a cost) when its gate passes.

**Files:**
- Create: `packages/domain/src/modifiers.ts`
- Modify: `packages/domain/src/ir.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/test/modifiers.test.ts`

**Interfaces:**
- Consumes: `IrCondition`, `IrConditionGroup`.
- Produces:
  - `IrModifier` = `{ id: string; type: "set" | "increment" | "decrement"; value: number; conditions?: IrCondition[]; conditionGroups?: IrConditionGroup[] }` (list fields optional).
  - `IrConstraint` gains `modifiers?: IrModifier[]` (optional). `IrCost` gains `modifiers?: IrModifier[]` (optional).

- [ ] **Step 1: Write the failing test**

`packages/domain/test/modifiers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { IrModifier, IrConstraint, IrCost } from "@muster/domain";

describe("IrModifier", () => {
  it("parses a gated modifier", () => {
    const m = IrModifier.parse({
      id: "m1",
      type: "set",
      value: 0,
      conditions: [
        { id: "c", comparator: "lessThan", value: 10, field: "selections", scope: "self", targetType: "category", targetId: "cat.model", includeChildSelections: true },
      ],
    });
    expect(m.type).toBe("set");
    expect(m.conditions?.[0]?.comparator).toBe("lessThan");
  });

  it("rejects an unknown modifier type", () => {
    expect(() => IrModifier.parse({ id: "m", type: "multiply", value: 2 })).toThrow();
  });
});

describe("modifiers attach to constraints and costs", () => {
  it("IrConstraint accepts an optional modifiers array", () => {
    const c = IrConstraint.parse({
      id: "k1", type: "max", value: 1, field: "selections", scope: "force",
      targetType: "category", targetId: "cat.hq",
      modifiers: [{ id: "m", type: "increment", value: 1 }],
    });
    expect(c.modifiers?.[0]?.type).toBe("increment");
  });

  it("IrConstraint still parses with no modifiers (backward compat)", () => {
    const c = IrConstraint.parse({
      id: "k2", type: "min", value: 1, field: "selections", scope: "force",
      targetType: "category", targetId: "cat.troops",
    });
    expect(c.modifiers).toBeUndefined();
  });

  it("IrCost accepts an optional modifiers array", () => {
    const cost = IrCost.parse({
      name: "points", value: 100,
      modifiers: [{ id: "m", type: "decrement", value: 10 }],
    });
    expect(cost.modifiers?.[0]?.value).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/domain test modifiers`
Expected: FAIL — `IrModifier` not exported; `modifiers` not on `IrConstraint`/`IrCost`.

- [ ] **Step 3: Implement**

`packages/domain/src/modifiers.ts`:
```ts
import { z } from "zod";
import { IrCondition, IrConditionGroup } from "./conditions";

export const IrModifier = z.object({
  id: z.string(),
  type: z.enum(["set", "increment", "decrement"]),
  value: z.number(),
  conditions: z.array(IrCondition).optional(),
  conditionGroups: z.array(IrConditionGroup).optional(),
});
export type IrModifier = z.infer<typeof IrModifier>;
```

Modify `packages/domain/src/ir.ts` — add the import and the optional `modifiers` field to both `IrCost` and `IrConstraint`. The full updated top of the file:
```ts
import { z } from "zod";
import { IrModifier } from "./modifiers";

export const IrCost = z.object({
  name: z.string(),
  value: z.number(),
  modifiers: z.array(IrModifier).optional(),
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
  modifiers: z.array(IrModifier).optional(),
});
export type IrConstraint = z.infer<typeof IrConstraint>;
```
(Leave `IrEntry` and `IrCatalogue` in `ir.ts` unchanged below that.)

`packages/domain/src/index.ts` (add `./modifiers`; final list):
```ts
export * from "./conditions";
export * from "./ir";
export * from "./modifiers";
export * from "./roster";
export * from "./validation";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/domain test` (all domain tests, incl. prior ir/roster/validation) → green; `pnpm --filter @muster/domain typecheck` → clean.
Expected: PASS — existing IR tests unaffected (modifiers optional).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/modifiers.ts packages/domain/src/ir.ts packages/domain/src/index.ts packages/domain/test/modifiers.test.ts
git commit -m "feat(domain): add IrModifier; attach optional modifiers to IrConstraint/IrCost"
```

---

### Task 4: `domain` — `RosterOverride` + `Roster.overrides` + extend `ValidationResult`

The app-level override layer's data: a roster carries a list of dismissed constraints; the result reports what was dismissed and whether house-rules are in play.

**Files:**
- Modify: `packages/domain/src/roster.ts`
- Modify: `packages/domain/src/validation.ts`
- Test: `packages/domain/test/roster.test.ts`
- Test: `packages/domain/test/validation.test.ts`

**Interfaces:**
- Produces:
  - `RosterOverride` = `{ constraintId: string; selectionId?: string; source: "user" | "system"; reason?: string }`.
  - `Roster` gains `overrides?: RosterOverride[]` (optional — keeps plan-1 `Roster` literals valid).
  - `ValidationResult` gains `dismissed: Issue[]` (default `[]`) and `hasHouseRules: boolean` (default `false`).

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/test/roster.test.ts`:
```ts
import { RosterOverride } from "@muster/domain";

describe("RosterOverride", () => {
  it("parses a user override", () => {
    const o = RosterOverride.parse({ constraintId: "k1", source: "user", reason: "club house rule" });
    expect(o.source).toBe("user");
    expect(o.selectionId).toBeUndefined();
  });

  it("Roster still parses with no overrides (backward compat)", () => {
    const r = Roster.parse({
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    });
    expect(r.overrides).toBeUndefined();
  });
});
```

Append to `packages/domain/test/validation.test.ts`:
```ts
it("ValidationResult defaults dismissed and hasHouseRules", () => {
  const r = ValidationResult.parse({ valid: true, totalPoints: 0, pointsLimit: 2000, issues: [] });
  expect(r.dismissed).toEqual([]);
  expect(r.hasHouseRules).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @muster/domain test roster validation`
Expected: FAIL — `RosterOverride` not exported; `dismissed`/`hasHouseRules` absent.

- [ ] **Step 3: Implement**

Modify `packages/domain/src/roster.ts` — add `RosterOverride` and the optional `overrides` field. Add above `Roster`:
```ts
export const RosterOverride = z.object({
  constraintId: z.string(),
  selectionId: z.string().optional(),
  source: z.enum(["user", "system"]),
  reason: z.string().optional(),
});
export type RosterOverride = z.infer<typeof RosterOverride>;
```
And add to the `Roster` object (after `selections`):
```ts
  overrides: z.array(RosterOverride).optional(),
```

Modify `packages/domain/src/validation.ts` — add two fields to `ValidationResult`:
```ts
export const ValidationResult = z.object({
  valid: z.boolean(),
  totalPoints: z.number(),
  pointsLimit: z.number(),
  issues: z.array(Issue),
  dismissed: z.array(Issue).default([]),
  hasHouseRules: z.boolean().default(false),
});
export type ValidationResult = z.infer<typeof ValidationResult>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/domain test` → all green; `pnpm --filter @muster/domain typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/roster.ts packages/domain/src/validation.ts packages/domain/test/roster.test.ts packages/domain/test/validation.test.ts
git commit -m "feat(domain): add RosterOverride + Roster.overrides; extend ValidationResult"
```

---

### Task 5: `engine-eval` — thread a `CostFn` cost-view through cost + aggregate

Enabling refactor: let `aggregate`/`totalCost` compute the `points` field against an injected effective-cost view instead of always the raw cost. Default view = `nodePoints`, so all plan-1 behavior and tests are preserved. Also generalize `aggregate`'s spec parameter so conditions (which share the same scope/field/target shape) can reuse it.

**Files:**
- Modify: `packages/engine-eval/src/cost.ts`
- Modify: `packages/engine-eval/src/scopes.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/cost.test.ts`

**Interfaces:**
- Produces:
  - `type CostFn = (node: EvalNode) => number` (exported from `cost.ts`).
  - `nodePoints(node): number` — unchanged (raw "points" cost × effectiveCount). This is the default `CostFn`.
  - `totalCost(state: EvalState, costOf?: CostFn): number` — sums `costOf(node)` over `state.all`; `costOf` defaults to `nodePoints`.
  - `interface AggregateSpec { id: string; field: "selections" | "points"; scope: "self" | "parent" | "force" | "roster"; targetType: "category" | "entry"; targetId: string; includeChildSelections: boolean }` (exported from `scopes.ts`). `IrConstraint` and `IrCondition` are both structurally assignable to it.
  - `aggregate(node: EvalNode | null, spec: AggregateSpec, state: EvalState, costOf?: CostFn): number` — points branch sums `costOf(node)`; `costOf` defaults to `nodePoints`.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine-eval/test/cost.test.ts`:
```ts
import type { CostFn } from "@muster/engine-eval";

describe("totalCost with an injected cost view", () => {
  it("uses the provided CostFn instead of raw cost", () => {
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "s.squad", entryId: "e.squad", count: 2, selections: [] }],
    };
    const state = buildState(roster, buildSymbolTable(cat));
    const flat: CostFn = () => 7;
    expect(totalCost(state, flat)).toBe(7); // one node, view returns 7
    expect(totalCost(state)).toBe(200); // default = raw: squad 100 * 2
  });
});
```
(This reuses the `cat` fixture already defined at the top of `cost.test.ts` in plan 1 — a squad worth 100 points.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test cost`
Expected: FAIL — `CostFn` not exported / `totalCost` takes no second arg.

- [ ] **Step 3: Implement**

`packages/engine-eval/src/cost.ts`:
```ts
import type { EvalNode, EvalState } from "./state";

export type CostFn = (node: EvalNode) => number;

export function nodePoints(node: EvalNode): number {
  const cost = node.entry.costs.find((c) => c.name === "points");
  return (cost?.value ?? 0) * node.effectiveCount;
}

export function totalCost(state: EvalState, costOf: CostFn = nodePoints): number {
  return state.all.reduce((sum, node) => sum + costOf(node), 0);
}
```

`packages/engine-eval/src/scopes.ts` — generalize the spec param and thread `costOf`. Full file:
```ts
import type { EvalNode, EvalState } from "./state";
import { nodePoints, type CostFn } from "./cost";

// The shared shape aggregate() reads. Both IrConstraint and IrCondition satisfy it.
export interface AggregateSpec {
  id: string;
  field: "selections" | "points";
  scope: "self" | "parent" | "force" | "roster";
  targetType: "category" | "entry";
  targetId: string;
  includeChildSelections: boolean;
}

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

function scopeNodes(
  node: EvalNode | null,
  spec: AggregateSpec,
  state: EvalState,
): EvalNode[] {
  switch (spec.scope) {
    // Walking-skeleton simplification: force and roster collapse to the same set because
    // there is currently a single implicit force per roster. Once multiple forces/detachments
    // land, `force` scope must narrow to the owning force's nodes rather than the whole roster.
    case "force":
    case "roster":
      return state.all;
    case "self":
      if (!node) throw new Error(`Spec ${spec.id} (scope=self) requires an owning node`);
      return subtree(node, spec.includeChildSelections);
    case "parent": {
      if (!node) throw new Error(`Spec ${spec.id} (scope=parent) requires an owning node`);
      const anchor = node.parent ?? node;
      return subtree(anchor, spec.includeChildSelections);
    }
  }
}

function matchesTarget(node: EvalNode, spec: AggregateSpec): boolean {
  return spec.targetType === "category"
    ? node.categories.includes(spec.targetId)
    : node.entry.id === spec.targetId;
}

export function aggregate(
  node: EvalNode | null,
  spec: AggregateSpec,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  const matched = scopeNodes(node, spec, state).filter((n) => matchesTarget(n, spec));
  if (spec.field === "selections") {
    return matched.reduce((sum, n) => sum + n.effectiveCount, 0);
  }
  return matched.reduce((sum, n) => sum + costOf(n), 0);
}
```

`packages/engine-eval/src/index.ts` (order alphabetical; unchanged entries stay):
```ts
export * from "./constraints";
export * from "./cost";
export * from "./evaluate";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```
(No new module yet — `constraints.ts` will be updated in Task 10; leave the export list as-is if already present.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @muster/engine-eval test` → all prior tests green + the new one; `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS. `checkConstraint` still calls `aggregate(node, constraint, state)` (3 args) — the `IrConstraint` is assignable to `AggregateSpec`, and `costOf` defaults, so it compiles and behaves identically.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/cost.ts packages/engine-eval/src/scopes.ts packages/engine-eval/test/cost.test.ts
git commit -m "refactor(engine-eval): thread CostFn view through aggregate/totalCost"
```

---

### Task 6: `engine-eval` — condition evaluation

Evaluate a single `IrCondition` to a boolean by comparing its aggregate against its threshold.

**Files:**
- Create: `packages/engine-eval/src/conditions.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/conditions.test.ts`

**Interfaces:**
- Consumes: `IrCondition`; `aggregate` + `AggregateSpec` from `./scopes`; `CostFn`, `nodePoints` from `./cost`; `EvalNode`, `EvalState`.
- Produces: `evaluateCondition(condition: IrCondition, node: EvalNode | null, state: EvalState, costOf?: CostFn): boolean` (`costOf` defaults to `nodePoints`).

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/conditions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrCondition } from "@muster/domain";
import { buildSymbolTable, buildState, evaluateCondition } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e.troop", name: "Troop", costs: [{ name: "points", value: 10 }], categories: ["cat.troops"], constraints: [], children: [] }],
};
const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "t1", entryId: "e.troop", count: 1, selections: [] },
    { id: "t2", entryId: "e.troop", count: 1, selections: [] },
    { id: "t3", entryId: "e.troop", count: 1, selections: [] },
  ],
};
const cond = (over: Partial<IrCondition>): IrCondition => ({
  id: "cond", comparator: "atLeast", value: 3, field: "selections", scope: "force",
  targetType: "category", targetId: "cat.troops", includeChildSelections: false, ...over,
});

describe("evaluateCondition", () => {
  it("atLeast true at the boundary", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    expect(evaluateCondition(cond({ comparator: "atLeast", value: 3 }), null, state)).toBe(true);
    expect(evaluateCondition(cond({ comparator: "atLeast", value: 4 }), null, state)).toBe(false);
  });

  it("covers every comparator (actual = 3 troops)", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    expect(evaluateCondition(cond({ comparator: "atMost", value: 3 }), null, state)).toBe(true);
    expect(evaluateCondition(cond({ comparator: "equalTo", value: 3 }), null, state)).toBe(true);
    expect(evaluateCondition(cond({ comparator: "notEqualTo", value: 3 }), null, state)).toBe(false);
    expect(evaluateCondition(cond({ comparator: "greaterThan", value: 3 }), null, state)).toBe(false);
    expect(evaluateCondition(cond({ comparator: "lessThan", value: 4 }), null, state)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test conditions`
Expected: FAIL — `evaluateCondition` not exported.

- [ ] **Step 3: Implement**

`packages/engine-eval/src/conditions.ts`:
```ts
import type { IrCondition } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate } from "./scopes";
import { nodePoints, type CostFn } from "./cost";

export function evaluateCondition(
  condition: IrCondition,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  const actual = aggregate(node, condition, state, costOf);
  switch (condition.comparator) {
    case "atLeast":
      return actual >= condition.value;
    case "atMost":
      return actual <= condition.value;
    case "equalTo":
      return actual === condition.value;
    case "notEqualTo":
      return actual !== condition.value;
    case "greaterThan":
      return actual > condition.value;
    case "lessThan":
      return actual < condition.value;
  }
}
```

`packages/engine-eval/src/index.ts` — add `./conditions` (alphabetical, before `./cost`):
```ts
export * from "./conditions";
export * from "./constraints";
export * from "./cost";
export * from "./evaluate";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test conditions`; then `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/conditions.ts packages/engine-eval/src/index.ts packages/engine-eval/test/conditions.test.ts
git commit -m "feat(engine-eval): evaluate IrCondition against aggregated state"
```

---

### Task 7: `engine-eval` — condition groups + modifier gate

Recursive and/or over conditions and nested groups, and the modifier-level gate (all conditions AND all groups).

**Files:**
- Modify: `packages/engine-eval/src/conditions.ts`
- Test: `packages/engine-eval/test/conditions.test.ts`

**Interfaces:**
- Consumes: `IrConditionGroup`, `IrModifier`; `evaluateCondition`.
- Produces:
  - `evaluateConditionGroup(group: IrConditionGroup, node: EvalNode | null, state: EvalState, costOf?: CostFn): boolean` — `and` ⇒ every member true (empty ⇒ true); `or` ⇒ any member true (empty ⇒ false); members = `(conditions ?? [])` ∪ `(conditionGroups ?? [])`.
  - `gatePasses(modifier: IrModifier, node: EvalNode | null, state: EvalState, costOf?: CostFn): boolean` — `(modifier.conditions ?? [])` all true AND `(modifier.conditionGroups ?? [])` all true. Empty gate ⇒ true.

- [ ] **Step 1: Write the failing test**

Append to `packages/engine-eval/test/conditions.test.ts`:
```ts
import type { IrConditionGroup, IrModifier } from "@muster/domain";
import { evaluateConditionGroup, gatePasses } from "@muster/engine-eval";

describe("evaluateConditionGroup", () => {
  const state = () => buildState(roster, buildSymbolTable(cat)); // 3 troops
  const cTrue = cond({ comparator: "equalTo", value: 3 });   // true
  const cFalse = cond({ comparator: "equalTo", value: 99 }); // false

  it("and requires all; or requires any", () => {
    const andG: IrConditionGroup = { type: "and", conditions: [cTrue, cFalse] };
    const orG: IrConditionGroup = { type: "or", conditions: [cTrue, cFalse] };
    expect(evaluateConditionGroup(andG, null, state())).toBe(false);
    expect(evaluateConditionGroup(orG, null, state())).toBe(true);
  });

  it("empty and is true; empty or is false", () => {
    expect(evaluateConditionGroup({ type: "and" }, null, state())).toBe(true);
    expect(evaluateConditionGroup({ type: "or" }, null, state())).toBe(false);
  });

  it("nests groups", () => {
    const g: IrConditionGroup = { type: "and", conditions: [cTrue], conditionGroups: [{ type: "or", conditions: [cFalse, cTrue] }] };
    expect(evaluateConditionGroup(g, null, state())).toBe(true);
  });
});

describe("gatePasses", () => {
  const state = () => buildState(roster, buildSymbolTable(cat));
  const cTrue = cond({ comparator: "equalTo", value: 3 });
  const cFalse = cond({ comparator: "equalTo", value: 99 });

  it("empty gate always passes", () => {
    const m: IrModifier = { id: "m", type: "set", value: 0 };
    expect(gatePasses(m, null, state())).toBe(true);
  });

  it("all conditions must pass", () => {
    expect(gatePasses({ id: "m", type: "set", value: 0, conditions: [cTrue] }, null, state())).toBe(true);
    expect(gatePasses({ id: "m", type: "set", value: 0, conditions: [cTrue, cFalse] }, null, state())).toBe(false);
  });

  it("conditions AND groups both required", () => {
    const m: IrModifier = { id: "m", type: "set", value: 0, conditions: [cTrue], conditionGroups: [{ type: "or", conditions: [cFalse] }] };
    expect(gatePasses(m, null, state())).toBe(false); // group is false
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test conditions`
Expected: FAIL — `evaluateConditionGroup`/`gatePasses` not exported.

- [ ] **Step 3: Implement**

Append to `packages/engine-eval/src/conditions.ts` (add the imports for the new types at the top):
```ts
import type { IrConditionGroup, IrModifier } from "@muster/domain";

export function evaluateConditionGroup(
  group: IrConditionGroup,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  const conditionResults = (group.conditions ?? []).map((c) =>
    evaluateCondition(c, node, state, costOf),
  );
  const groupResults = (group.conditionGroups ?? []).map((g) =>
    evaluateConditionGroup(g, node, state, costOf),
  );
  const members = [...conditionResults, ...groupResults];
  return group.type === "and" ? members.every(Boolean) : members.some(Boolean);
}

export function gatePasses(
  modifier: IrModifier,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): boolean {
  const conditionsOk = (modifier.conditions ?? []).every((c) =>
    evaluateCondition(c, node, state, costOf),
  );
  const groupsOk = (modifier.conditionGroups ?? []).every((g) =>
    evaluateConditionGroup(g, node, state, costOf),
  );
  return conditionsOk && groupsOk;
}
```
(Merge the new `import type { IrConditionGroup, IrModifier } from "@muster/domain";` into the existing `@muster/domain` import line — the file already imports `IrCondition`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test conditions`; `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/conditions.ts packages/engine-eval/test/conditions.test.ts
git commit -m "feat(engine-eval): condition groups (and/or) + modifier gate"
```

---

### Task 8: `engine-eval` — apply modifiers to a value

Fold applicable modifiers over a base number in array order.

**Files:**
- Create: `packages/engine-eval/src/modifiers.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/modifiers.test.ts`

**Interfaces:**
- Consumes: `IrModifier`; `gatePasses`; `CostFn`, `nodePoints`; `EvalNode`, `EvalState`.
- Produces: `applyModifiers(base: number, modifiers: IrModifier[] | undefined, node: EvalNode | null, state: EvalState, costOf?: CostFn): number` — starts at `base`; for each modifier whose gate passes, `set` → replace, `increment` → `+= value`, `decrement` → `-= value`, in array order. `undefined` modifiers ⇒ returns `base` unchanged.

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/modifiers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrModifier } from "@muster/domain";
import { buildSymbolTable, buildState, applyModifiers } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e.x", name: "X", costs: [], categories: ["cat.x"], constraints: [], children: [] }],
};
const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "x1", entryId: "e.x", count: 1, selections: [] }],
};
const state = () => buildState(roster, buildSymbolTable(cat));

describe("applyModifiers", () => {
  it("returns base when modifiers is undefined", () => {
    expect(applyModifiers(100, undefined, null, state())).toBe(100);
  });

  it("applies set, increment, decrement in order", () => {
    const mods: IrModifier[] = [
      { id: "a", type: "increment", value: 10 }, // 110
      { id: "b", type: "set", value: 50 },       // 50 (set overrides running value)
      { id: "c", type: "decrement", value: 5 },  // 45
    ];
    expect(applyModifiers(100, mods, null, state())).toBe(45);
  });

  it("skips a modifier whose gate fails", () => {
    const mods: IrModifier[] = [
      { id: "gated", type: "set", value: 0, conditions: [
        { id: "c", comparator: "atLeast", value: 999, field: "selections", scope: "force", targetType: "category", targetId: "cat.x", includeChildSelections: false },
      ] },
    ];
    expect(applyModifiers(100, mods, null, state())).toBe(100); // gate false → unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test modifiers`
Expected: FAIL — `applyModifiers` not exported.

- [ ] **Step 3: Implement**

`packages/engine-eval/src/modifiers.ts`:
```ts
import type { IrModifier } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { gatePasses } from "./conditions";
import { nodePoints, type CostFn } from "./cost";

export function applyModifiers(
  base: number,
  modifiers: IrModifier[] | undefined,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  let value = base;
  for (const modifier of modifiers ?? []) {
    if (!gatePasses(modifier, node, state, costOf)) continue;
    switch (modifier.type) {
      case "set":
        value = modifier.value;
        break;
      case "increment":
        value += modifier.value;
        break;
      case "decrement":
        value -= modifier.value;
        break;
    }
  }
  return value;
}
```

`packages/engine-eval/src/index.ts` — add `./modifiers` (alphabetical, after `./cost`... actually place before `./scopes`):
```ts
export * from "./conditions";
export * from "./constraints";
export * from "./cost";
export * from "./evaluate";
export * from "./modifiers";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test modifiers`; `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/modifiers.ts packages/engine-eval/src/index.ts packages/engine-eval/test/modifiers.test.ts
git commit -m "feat(engine-eval): apply set/increment/decrement modifiers in order"
```

---

### Task 9: `engine-eval` — fixed-point cost resolver

Resolve every node's effective points cost to a fixed point: cost modifiers can be gated on `points`-field conditions, which read costs — so iterate until stable, bounded by a hard cap.

**Files:**
- Create: `packages/engine-eval/src/resolve.ts`
- Modify: `packages/engine-eval/src/index.ts`
- Test: `packages/engine-eval/test/resolve.test.ts`

**Interfaces:**
- Consumes: `applyModifiers`; `nodePoints`, `CostFn`; `EvalNode`, `EvalState`.
- Produces:
  - `MAX_ITERATIONS = 32` (exported const).
  - `effectiveNodePoints(node: EvalNode, state: EvalState, costOf: CostFn): number` — the node's "points" cost value after its cost-modifiers, × `effectiveCount` (0 if no "points" cost).
  - `interface CostResolution { costOf: CostFn; converged: boolean; iterations: number }`.
  - `resolveCosts(state: EvalState): CostResolution` — fixed-point over `effectiveNodePoints`. Iterates: compute each node's effective points using the *previous* iteration's cost view (falling back to raw `nodePoints` on the first pass); stop when a full pass changes nothing (`converged: true`) or after `MAX_ITERATIONS` (`converged: false`). The returned `costOf` reflects the final iteration.

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/resolve.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { buildSymbolTable, buildState, resolveCosts, totalCost } from "@muster/engine-eval";

// A troop costs 10, but gets a -3 discount when the army fields at least 3 troops.
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{
    id: "e.troop", name: "Troop", categories: ["cat.troops"], constraints: [], children: [],
    costs: [{
      name: "points", value: 10,
      modifiers: [{
        id: "bulk", type: "decrement", value: 3,
        conditions: [{ id: "c", comparator: "atLeast", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false }],
      }],
    }],
  }],
};

function rosterOf(n: number) {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, entryId: "e.troop", count: 1, selections: [] })),
  };
}

describe("resolveCosts", () => {
  it("applies a bulk discount when the count condition holds (converges)", () => {
    const state = buildState(rosterOf(3), buildSymbolTable(cat));
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(totalCost(state, res.costOf)).toBe(21); // 3 troops * (10 - 3)
  });

  it("no discount below the threshold", () => {
    const state = buildState(rosterOf(2), buildSymbolTable(cat));
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(totalCost(state, res.costOf)).toBe(20); // 2 * 10
  });

  it("terminates and reports converged for a plain catalogue", () => {
    const plain: IrCatalogue = { ...cat, entries: [{ id: "e.troop", name: "T", categories: [], constraints: [], children: [], costs: [{ name: "points", value: 10 }] }] };
    const state = buildState(rosterOf(5), buildSymbolTable(plain));
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(res.iterations).toBeLessThanOrEqual(2);
    expect(totalCost(state, res.costOf)).toBe(50);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test resolve`
Expected: FAIL — `resolveCosts` not exported.

- [ ] **Step 3: Implement**

`packages/engine-eval/src/resolve.ts`:
```ts
import type { EvalNode, EvalState } from "./state";
import { nodePoints, type CostFn } from "./cost";
import { applyModifiers } from "./modifiers";

export const MAX_ITERATIONS = 32;

export function effectiveNodePoints(
  node: EvalNode,
  state: EvalState,
  costOf: CostFn,
): number {
  const cost = node.entry.costs.find((c) => c.name === "points");
  if (!cost) return 0;
  const unit = applyModifiers(cost.value, cost.modifiers, node, state, costOf);
  return unit * node.effectiveCount;
}

export interface CostResolution {
  costOf: CostFn;
  converged: boolean;
  iterations: number;
}

export function resolveCosts(state: EvalState): CostResolution {
  // `costMap` is reassigned each pass; `costOf` closes over the binding so it
  // always reads the latest map. A pass computes the next map from the current
  // one, so conditions see the previous iteration's effective costs.
  let costMap = new Map<EvalNode, number>();
  const costOf: CostFn = (n) => costMap.get(n) ?? nodePoints(n);

  let iterations = 0;
  let converged = false;
  while (iterations < MAX_ITERATIONS) {
    iterations++;
    const next = new Map<EvalNode, number>();
    for (const node of state.all) {
      next.set(node, effectiveNodePoints(node, state, costOf));
    }
    const stable = state.all.every((n) => next.get(n) === costMap.get(n));
    costMap = next;
    if (stable) {
      converged = true;
      break;
    }
  }
  return { costOf, converged, iterations };
}
```

`packages/engine-eval/src/index.ts` — add `./resolve` (alphabetical, after `./modifiers`):
```ts
export * from "./conditions";
export * from "./constraints";
export * from "./cost";
export * from "./evaluate";
export * from "./modifiers";
export * from "./resolve";
export * from "./scopes";
export * from "./state";
export * from "./symbols";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test resolve`; `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/resolve.ts packages/engine-eval/src/index.ts packages/engine-eval/test/resolve.test.ts
git commit -m "feat(engine-eval): fixed-point resolver for effective costs"
```

---

### Task 10: `engine-eval` — effective constraint bounds in `checkConstraint`

Constraint bounds can themselves carry modifiers (e.g. "you may take one more Heavy if you field ≥ 6 Troops"). Resolve the effective bound against the (converged) cost view and use the injected `costOf` for the constraint's own aggregate.

**Files:**
- Modify: `packages/engine-eval/src/constraints.ts`
- Test: `packages/engine-eval/test/constraints.test.ts`

**Interfaces:**
- Consumes: `applyModifiers`; `CostFn`, `nodePoints`.
- Produces:
  - `effectiveConstraintValue(constraint: IrConstraint, node: EvalNode | null, state: EvalState, costOf?: CostFn): number` — `applyModifiers(constraint.value, constraint.modifiers, node, state, costOf)`.
  - `checkConstraint(constraint: IrConstraint, node: EvalNode | null, state: EvalState, costOf?: CostFn): Issue | null` — now compares `aggregate(node, constraint, state, costOf)` against the *effective* bound; `costOf` defaults to `nodePoints` (so plan-1 3-arg calls still behave identically when no modifiers exist).

- [ ] **Step 1: Write the failing test**

Append to `packages/engine-eval/test/constraints.test.ts`:
```ts
import { effectiveConstraintValue } from "@muster/engine-eval";
import type { IrCatalogue } from "@muster/domain";

describe("checkConstraint with a modified bound", () => {
  // Heavy max is 1, but +1 when there are at least 2 heavies present (unlocks a second slot).
  const catMod: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [{ id: "e.heavy", name: "Heavy", costs: [], categories: ["cat.heavy"], constraints: [], children: [] }],
    forceConstraints: [{
      id: "fc.heavy", type: "max", value: 1, field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy",
      modifiers: [{ id: "unlock", type: "increment", value: 1, conditions: [
        { id: "c", comparator: "atLeast", value: 2, field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy", includeChildSelections: false },
      ] }],
    }],
  };
  const rosterN = (n: number) => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: Array.from({ length: n }, (_, i) => ({ id: `h${i}`, entryId: "e.heavy", count: 1, selections: [] })),
  });

  it("effectiveConstraintValue reflects an applicable increment", () => {
    const state = buildState(rosterN(2), buildSymbolTable(catMod));
    const c = catMod.forceConstraints[0]!;
    expect(effectiveConstraintValue(c, null, state)).toBe(2); // base 1 + 1 (>=2 heavies)
  });

  it("2 heavies is legal because the bound became 2", () => {
    const state = buildState(rosterN(2), buildSymbolTable(catMod));
    const c = catMod.forceConstraints[0]!;
    expect(checkConstraint(c, null, state)).toBeNull();
  });

  it("3 heavies still violates the raised bound of 2", () => {
    const state = buildState(rosterN(3), buildSymbolTable(catMod));
    const c = catMod.forceConstraints[0]!;
    const issue = checkConstraint(c, null, state);
    expect(issue?.code).toBe("constraint.max");
    expect(issue?.message).toMatch(/3 .*max 2/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test constraints`
Expected: FAIL — `effectiveConstraintValue` not exported; `checkConstraint` uses the raw bound.

- [ ] **Step 3: Implement**

`packages/engine-eval/src/constraints.ts` (full file):
```ts
import type { IrConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";
import { aggregate } from "./scopes";
import { applyModifiers } from "./modifiers";
import { nodePoints, type CostFn } from "./cost";

export function effectiveConstraintValue(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): number {
  return applyModifiers(constraint.value, constraint.modifiers, node, state, costOf);
}

export function checkConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): Issue | null {
  const actual = aggregate(node, constraint, state, costOf);
  const limit = effectiveConstraintValue(constraint, node, state, costOf);
  const violated = constraint.type === "max" ? actual > limit : actual < limit;
  if (!violated) return null;

  const target = `${constraint.targetType} "${constraint.targetId}"`;
  const message =
    constraint.type === "max"
      ? `Too many ${target}: ${actual} exceeds max ${limit}`
      : `Not enough ${target}: ${actual} below min ${limit}`;

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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test constraints` (new + plan-1 constraint tests); `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS. Plan-1 constraint tests still pass — with no modifiers, `effectiveConstraintValue` returns the base value.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/constraints.ts packages/engine-eval/test/constraints.test.ts
git commit -m "feat(engine-eval): resolve modified constraint bounds in checkConstraint"
```

---

### Task 11: `engine-eval` — wire resolved costs + bounds into `evaluate`

Make `evaluate` resolve costs first, then use the resolved view everywhere (points total, aggregates, constraint bounds), and emit a non-blocking warning if the fixed-point did not converge.

**Files:**
- Modify: `packages/engine-eval/src/evaluate.ts`
- Test: `packages/engine-eval/test/evaluate.test.ts`

**Interfaces:**
- Consumes: `resolveCosts`, `totalCost`, `checkConstraint`.
- Produces: `evaluate(roster, catalogue): ValidationResult` — unchanged signature; now resolves the cost view once and threads it through `totalCost` and every `checkConstraint`. Adds a `severity: "warning"`, `code: "modifiers.nonconvergent"` issue when `!converged`. Result includes `dismissed: []` and `hasHouseRules: false` for now (the override layer lands in Task 12).

- [ ] **Step 1: Write the failing test**

Append to `packages/engine-eval/test/evaluate.test.ts`:
```ts
import type { IrCatalogue } from "@muster/domain";

describe("evaluate with cost modifiers", () => {
  // Each troop 10 pts, -3 when >=3 troops. 3 troops => 21, under a 25 cap = legal.
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [{
      id: "e.troop", name: "Troop", categories: ["cat.troops"], constraints: [], children: [],
      costs: [{ name: "points", value: 10, modifiers: [{ id: "bulk", type: "decrement", value: 3, conditions: [
        { id: "c", comparator: "atLeast", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false },
      ] }] }],
    }],
  };
  const roster3 = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 25,
    selections: [
      { id: "t1", entryId: "e.troop", count: 1, selections: [] },
      { id: "t2", entryId: "e.troop", count: 1, selections: [] },
      { id: "t3", entryId: "e.troop", count: 1, selections: [] },
    ],
  };

  it("uses discounted total (21) so a 25-pt cap passes", () => {
    const result = evaluate(roster3, cat);
    expect(result.totalPoints).toBe(21);
    expect(result.valid).toBe(true);
    expect(result.dismissed).toEqual([]);
    expect(result.hasHouseRules).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test evaluate`
Expected: FAIL — `totalPoints` is 30 (raw), not 21.

- [ ] **Step 3: Implement**

`packages/engine-eval/src/evaluate.ts` (full file):
```ts
import type { Roster, IrCatalogue, ValidationResult, Issue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState } from "./state";
import { totalCost } from "./cost";
import { resolveCosts } from "./resolve";
import { checkConstraint } from "./constraints";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const { costOf, converged } = resolveCosts(state);
  const issues: Issue[] = [];

  const totalPoints = totalCost(state, costOf);
  if (totalPoints > roster.pointsLimit) {
    issues.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
    });
  }

  if (!converged) {
    issues.push({
      severity: "warning",
      code: "modifiers.nonconvergent",
      message: "Cost modifiers did not reach a stable value; results may be approximate.",
    });
  }

  for (const constraint of catalogue.forceConstraints) {
    const issue = checkConstraint(constraint, null, state, costOf);
    if (issue) issues.push(issue);
  }

  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state, costOf);
      if (issue) issues.push(issue);
    }
  }

  const valid = !issues.some((i) => i.severity === "error");
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues, dismissed: [], hasHouseRules: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test evaluate` (new + plan-1 evaluate tests); `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS. Plan-1 evaluate tests still pass — no modifiers ⇒ resolved costs equal raw costs, `converged` true, `dismissed`/`hasHouseRules` are the defaults those tests don't assert on.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/evaluate.ts packages/engine-eval/test/evaluate.test.ts
git commit -m "feat(engine-eval): thread resolved costs through evaluate + nonconvergence warning"
```

---

### Task 12: `engine-eval` — override / house-rules layer (incl. understrength)

Post-process the issue list: a roster's `overrides` dismiss matching constraint issues. Dismissed issues move to `dismissed`; `valid` is computed on the remaining active issues; `hasHouseRules` is true when any *user*-source override actually dismissed something. Understrength is the same mechanism with `source: "system"`.

**Files:**
- Modify: `packages/engine-eval/src/evaluate.ts`
- Test: `packages/engine-eval/test/overrides.test.ts`

**Interfaces:**
- Consumes: `RosterOverride` (via `roster.overrides`).
- Produces: `evaluate` now partitions issues. An override matches an issue when `issue.constraintId === override.constraintId` and (`override.selectionId` is undefined **or** `override.selectionId === issue.selectionId`). Matched issues go to `dismissed`; unmatched stay in `issues`. `valid = !issues.some(i => i.severity === "error")` (active only). `hasHouseRules = dismissed.some(d => a matching override has source === "user")`. Issues without a `constraintId` (e.g. `points.over`, `modifiers.nonconvergent`) can never be dismissed.

- [ ] **Step 1: Write the failing test**

`packages/engine-eval/test/overrides.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// A unit requires min 5 models (a "min" constraint on its own children count).
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    {
      id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: ["cat.troops"], children: [],
      constraints: [{
        id: "k.minmodels", type: "min", value: 5, field: "selections", scope: "self",
        targetType: "entry", targetId: "e.model", includeChildSelections: true,
      }],
    },
    { id: "e.model", name: "Model", costs: [], categories: ["cat.model"], constraints: [], children: [] },
  ],
};

// Understrength: squad with only 3 models (min is 5).
function rosterWith(overrides?: Roster["overrides"]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "sq", entryId: "e.squad", count: 1,
      selections: [{ id: "m", entryId: "e.model", count: 3, selections: [] }],
    }],
    overrides,
  };
}

describe("override / house-rules layer", () => {
  it("without overrides, the min-models violation is active and invalid", () => {
    const r = evaluate(rosterWith(), cat);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.constraintId === "k.minmodels")).toBe(true);
    expect(r.dismissed).toEqual([]);
    expect(r.hasHouseRules).toBe(false);
  });

  it("a system (understrength) override dismisses it → valid, not flagged as house-rules", () => {
    const r = evaluate(rosterWith([{ constraintId: "k.minmodels", selectionId: "sq", source: "system", reason: "understrength" }]), cat);
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.constraintId === "k.minmodels")).toBe(false);
    expect(r.dismissed.some((i) => i.constraintId === "k.minmodels")).toBe(true);
    expect(r.hasHouseRules).toBe(false); // system, not user
  });

  it("a user override dismisses it → valid AND flagged as house-rules", () => {
    const r = evaluate(rosterWith([{ constraintId: "k.minmodels", source: "user", reason: "casual game" }]), cat);
    expect(r.valid).toBe(true);
    expect(r.hasHouseRules).toBe(true);
  });

  it("selectionId-scoped override only dismisses the matching selection", () => {
    const r = evaluate(rosterWith([{ constraintId: "k.minmodels", selectionId: "other", source: "user" }]), cat);
    expect(r.valid).toBe(false); // selectionId doesn't match "sq" → not dismissed
    expect(r.hasHouseRules).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @muster/engine-eval test overrides`
Expected: FAIL — overrides are ignored; violation stays active.

- [ ] **Step 3: Implement**

Update `packages/engine-eval/src/evaluate.ts` — replace the final `valid`/return section (everything after the two constraint loops) with the override layer. The two loops now push into a local `raw` array; then:
```ts
  // ... build `raw: Issue[]` exactly as before (points.over, nonconvergent, force + node constraints) ...

  const overrides = roster.overrides ?? [];
  const matchingOverride = (issue: Issue) =>
    issue.constraintId === undefined
      ? undefined
      : overrides.find(
          (o) =>
            o.constraintId === issue.constraintId &&
            (o.selectionId === undefined || o.selectionId === issue.selectionId),
        );

  const dismissed: Issue[] = [];
  const active: Issue[] = [];
  for (const issue of raw) {
    if (matchingOverride(issue)) dismissed.push(issue);
    else active.push(issue);
  }

  const hasHouseRules = dismissed.some((d) => matchingOverride(d)?.source === "user");
  const valid = !active.some((i) => i.severity === "error");
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues: active, dismissed, hasHouseRules };
```
Rename the working array from `issues` to `raw` throughout the function body (the `push` sites), so the final partition reads cleanly. The full updated file:
```ts
import type { Roster, IrCatalogue, ValidationResult, Issue } from "@muster/domain";
import { buildSymbolTable } from "./symbols";
import { buildState } from "./state";
import { totalCost } from "./cost";
import { resolveCosts } from "./resolve";
import { checkConstraint } from "./constraints";

export function evaluate(roster: Roster, catalogue: IrCatalogue): ValidationResult {
  const symbols = buildSymbolTable(catalogue);
  const state = buildState(roster, symbols);
  const { costOf, converged } = resolveCosts(state);
  const raw: Issue[] = [];

  const totalPoints = totalCost(state, costOf);
  if (totalPoints > roster.pointsLimit) {
    raw.push({
      severity: "error",
      code: "points.over",
      message: `Over points limit: ${totalPoints} exceeds ${roster.pointsLimit}`,
    });
  }

  if (!converged) {
    raw.push({
      severity: "warning",
      code: "modifiers.nonconvergent",
      message: "Cost modifiers did not reach a stable value; results may be approximate.",
    });
  }

  for (const constraint of catalogue.forceConstraints) {
    const issue = checkConstraint(constraint, null, state, costOf);
    if (issue) raw.push(issue);
  }
  for (const node of state.all) {
    for (const constraint of node.entry.constraints) {
      const issue = checkConstraint(constraint, node, state, costOf);
      if (issue) raw.push(issue);
    }
  }

  const overrides = roster.overrides ?? [];
  const matchingOverride = (issue: Issue) =>
    issue.constraintId === undefined
      ? undefined
      : overrides.find(
          (o) =>
            o.constraintId === issue.constraintId &&
            (o.selectionId === undefined || o.selectionId === issue.selectionId),
        );

  const dismissed: Issue[] = [];
  const active: Issue[] = [];
  for (const issue of raw) {
    if (matchingOverride(issue)) dismissed.push(issue);
    else active.push(issue);
  }

  const hasHouseRules = dismissed.some((d) => matchingOverride(d)?.source === "user");
  const valid = !active.some((i) => i.severity === "error");
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues: active, dismissed, hasHouseRules };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @muster/engine-eval test overrides` and the whole engine suite; `pnpm --filter @muster/engine-eval typecheck` → clean.
Expected: PASS. Plan-1 + Task-11 evaluate tests still pass — with no `overrides`, nothing is dismissed and `hasHouseRules` stays false.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/evaluate.ts packages/engine-eval/test/overrides.test.ts
git commit -m "feat(engine-eval): override/house-rules layer (understrength + casual dismiss)"
```

---

### Task 13: `engine-eval` — property + perf coverage for the modifier engine

Lock in termination, determinism, and the perf budget with modifiers in play.

**Files:**
- Test: `packages/engine-eval/test/modifier-property.test.ts`
- Test: `packages/engine-eval/test/modifier-perf.test.ts`

**Interfaces:**
- Consumes: `evaluate`, `resolveCosts`, `buildState`, `buildSymbolTable`, `MAX_ITERATIONS`; `fast-check`.

- [ ] **Step 1: Write the property test**

`packages/engine-eval/test/modifier-property.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { IrCatalogue } from "@muster/domain";
import { evaluate, buildState, buildSymbolTable, resolveCosts, MAX_ITERATIONS } from "@muster/engine-eval";

// Catalogue whose troop cost steps down by 2 at >=3 and by another 2 at >=6 troops.
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{
    id: "e.troop", name: "Troop", categories: ["cat.troops"], constraints: [], children: [],
    costs: [{ name: "points", value: 10, modifiers: [
      { id: "d1", type: "decrement", value: 2, conditions: [{ id: "a", comparator: "atLeast", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false }] },
      { id: "d2", type: "decrement", value: 2, conditions: [{ id: "b", comparator: "atLeast", value: 6, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false }] },
    ] }],
  }],
};

describe("modifier engine invariants", () => {
  it("resolveCosts always terminates, converges, and evaluate is idempotent", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 0, max: 1000 }), (n, limit) => {
        const roster = {
          id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: limit,
          selections: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, entryId: "e.troop", count: 1, selections: [] })),
        };
        const state = buildState(roster, buildSymbolTable(cat));
        const res = resolveCosts(state);
        expect(res.iterations).toBeLessThanOrEqual(MAX_ITERATIONS);
        expect(res.converged).toBe(true); // monotone step-downs converge
        const a = evaluate(roster, cat);
        const b = evaluate(roster, cat);
        expect(a).toEqual(b);
        expect(a.totalPoints).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
```

- [ ] **Step 2: Run it to verify it passes**

Run: `pnpm --filter @muster/engine-eval test modifier-property`
Expected: PASS. (A failure means a real convergence/idempotence defect — investigate the engine, do not weaken the test.)

- [ ] **Step 3: Write the perf test**

`packages/engine-eval/test/modifier-perf.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{
    id: "e.troop", name: "Troop", categories: ["cat.troops"], constraints: [], children: [],
    costs: [{ name: "points", value: 10, modifiers: [
      { id: "bulk", type: "decrement", value: 1, conditions: [{ id: "a", comparator: "atLeast", value: 10, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false }] },
    ] }],
  }],
};

describe("modifier engine performance", () => {
  it("evaluates a ~2000-pt roster with cost modifiers well under 50ms", () => {
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 5000,
      selections: Array.from({ length: 220 }, (_, i) => ({ id: `t${i}`, entryId: "e.troop", count: 1, selections: [] })),
    };
    evaluate(roster, cat); // warm up
    const start = performance.now();
    evaluate(roster, cat);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @muster/engine-eval test modifier-perf`
Expected: PASS. If it fails, report the measured time — do not inflate the threshold.

- [ ] **Step 5: Run the whole monorepo suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS across `@muster/domain` and `@muster/engine-eval`; `tsc --noEmit` clean in both.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/test/modifier-property.test.ts packages/engine-eval/test/modifier-perf.test.ts
git commit -m "test(engine-eval): modifier-engine termination, determinism, perf"
```

---

## Self-Review

**1. Spec coverage (§5 modifier engine / risk #1):**
- Conditional `set/increment/decrement` against live state (§5) → Tasks 3, 8, 10 (costs + bounds).
- Conditions + condition-group (and/or) + gating (§5) → Tasks 1, 2, 6, 7.
- State-dependent fixed-point, terminating (§5) → Task 9 (`resolveCosts`, `MAX_ITERATIONS`), Task 13 (termination property).
- Effective costs feed `points`-field conditions/aggregates (the coupling) → Task 5 (`CostFn` threading), 9, 11.
- Understrength as override (info not in `.cat`) (§5) → Task 12 (`source: "system"`).
- App-level override = house-rules mechanism (dismiss/override a constraint; roster flagged) (§5) → Tasks 4, 12 (`hasHouseRules`, `dismissed`).
- Never-block (warning for nonconvergence; overrides suppress, don't prevent) (§9.2.5) → Tasks 11, 12.
- Determinism + property invariants (§12.1, §12.5) → Task 13.
- Perf < 50 ms with modifiers (§15) → Task 13.
- Backward compatibility (plan-1 data unchanged) → optional fields + `?? []` throughout; every task re-runs plan-1 tests.
- **Explicitly deferred (labeled, not gaps):** `instanceOf`/`notInstanceOf`, `repeat`, `shared`/per-model cost nuance, Rust parser, apps — in Global Constraints.

**2. Placeholder scan:** No TBD/TODO; every step carries complete code and expected results; no "similar to Task N".

**3. Type consistency:** `IrCondition` fields identical across Tasks 1, 6; `IrConditionGroup` optional-list shape identical across Tasks 2, 7; `IrModifier` shape identical across Tasks 3, 7, 8; `CostFn` signature identical across Tasks 5, 6, 7, 8, 9, 10; `AggregateSpec` (Task 5) is satisfied by both `IrConstraint` and `IrCondition`; `resolveCosts` → `{ costOf, converged, iterations }` consistent between Tasks 9, 11, 13; `checkConstraint(constraint, node, state, costOf?)` consistent between Tasks 10, 11; `evaluate(roster, catalogue)` return shape (`issues`/`dismissed`/`hasHouseRules`) consistent between Tasks 11, 12 and the `ValidationResult` schema (Task 4). Override match rule (constraintId + optional selectionId) identical between the Task 12 spec and its implementation.

---

## Follow-on plans (unchanged from plan 1's roadmap)

1. **`engine-parser` (Rust)** — real `.catz/.rosz/.gst` → the `domain` IR (now including conditions/modifiers), with §10.1 security hardening and reference-graph resolution. Feeds real catalogues (which carry real modifiers) into this engine.
2. **`apps/mobile` builder slice** — Expo builder screens over the engine (live validation, override toggles for house-rules/understrength, effective points display).

Deferred within the engine itself (future engine plan, when real data demands it): `instanceOf`/`notInstanceOf` conditions, `repeat` nodes, `shared`/per-model cost semantics, and narrowing `force` scope once multiple forces/detachments exist.
