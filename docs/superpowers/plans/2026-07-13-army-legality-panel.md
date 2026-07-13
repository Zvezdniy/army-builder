# Army Legality Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface matched-play legality in the web UI — points meter, LEGAL/ILLEGAL verdict, a positive pass/fail checklist of army-level rules, and grouped/clickable issues — backed by a small additive `checks` field on the engine's `ValidationResult`.

**Architecture:** Engine stays the source of truth. Add a positive enumeration of army-level rules (`checks`) to `ValidationResult` without touching `issues`/`valid`. The web app renders a new `LegalityPanel` from the existing `evaluate()` output, replacing the plain points span and issues list.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, ESM), Zod (@muster/domain), Vitest against TS source via vite-tsconfig-paths, React 18 + Vite (apps/web, jsdom vitest, no coverage thresholds).

## Global Constraints

- engine-eval keeps 100% line coverage excluding `src/index.ts`; @muster/domain keeps 100%.
- `checks` is purely additive: `issues`, `valid`, `totalPoints`, `pointsLimit`, `dismissed`, `hasHouseRules` are unchanged in shape and value.
- `ValidationResult` MUST still parse input that omits `checks` (→ `[]`) — existing test literals must not need edits.
- The web element carrying `data-testid="points"` MUST have `textContent` that STARTS with `{totalPoints} / {pointsLimit}` (builder tests anchor `/^{n} \/ {limit}/`).
- No real BSData catalogue data committed. Engine tests use synthetic catalogues; web tests use the bundled `mini40k`.
- Rust parser untouched; parser golden test unaffected.
- Code, identifiers, commit messages in English. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: domain `LegalityCheck` + `ValidationResult.checks`

**Files:**
- Modify: `packages/domain/src/validation.ts`
- Test: `packages/domain/test/validation.test.ts` (create if absent; otherwise add cases)

**Interfaces:**
- Produces: `LegalityCheck` zod object + type with fields `{ id: string; kind: "points"|"force"; label: string; actual: number; limit: number; satisfied: boolean; constraintType?: "min"|"max" }`; `ValidationResult` gains `checks: LegalityCheck[]` (default `[]`).

- [ ] **Step 1: Write failing tests**

Add to the domain test file:

```ts
import { describe, it, expect } from "vitest";
import { LegalityCheck, ValidationResult } from "../src/validation";

describe("LegalityCheck", () => {
  it("parses a points check", () => {
    const c = LegalityCheck.parse({
      id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true,
    });
    expect(c.satisfied).toBe(true);
    expect(c.constraintType).toBeUndefined();
  });

  it("parses a force check with constraintType", () => {
    const c = LegalityCheck.parse({
      id: "f1", kind: "force", label: 'At least 1 category "Battleline"',
      actual: 0, limit: 1, satisfied: false, constraintType: "min",
    });
    expect(c.constraintType).toBe("min");
  });
});

describe("ValidationResult.checks", () => {
  it("defaults checks to [] when omitted", () => {
    const r = ValidationResult.parse({
      valid: true, totalPoints: 0, pointsLimit: 2000, issues: [],
    });
    expect(r.checks).toEqual([]);
  });

  it("keeps supplied checks", () => {
    const r = ValidationResult.parse({
      valid: true, totalPoints: 0, pointsLimit: 2000, issues: [],
      checks: [{ id: "points", kind: "points", label: "Points", actual: 0, limit: 2000, satisfied: true }],
    });
    expect(r.checks).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @muster/domain test -- validation`
Expected: FAIL — `LegalityCheck` is not exported / `checks` undefined.

- [ ] **Step 3: Implement**

In `packages/domain/src/validation.ts`, add before `ValidationResult`:

```ts
export const LegalityCheck = z.object({
  id: z.string(),
  kind: z.enum(["points", "force"]),
  label: z.string(),
  actual: z.number(),
  limit: z.number(),
  satisfied: z.boolean(),
  constraintType: z.enum(["min", "max"]).optional(),
});
export type LegalityCheck = z.infer<typeof LegalityCheck>;
```

Add to the `ValidationResult` object (after `hasHouseRules`):

```ts
  checks: z.array(LegalityCheck).default([]),
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @muster/domain test`
Expected: PASS (including existing tests). Confirm coverage still 100%.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/validation.ts packages/domain/test/validation.test.ts
git commit -m "feat(domain): add LegalityCheck and ValidationResult.checks"
```

---

### Task 2: engine `describeConstraint`

**Files:**
- Modify: `packages/engine-eval/src/constraints.ts`
- Test: `packages/engine-eval/test/constraints.test.ts` (add cases; create if absent)

**Interfaces:**
- Consumes: `IrConstraint`, `EvalNode`, `EvalState`, `CostFn`, existing `aggregate`, `scopeUnanchored`, `effectiveConstraintValue`.
- Produces: `describeConstraint(constraint, node, state, costOf?) => { actual: number; limit: number; satisfied: boolean } | null`. Returns `null` under the same conditions `checkConstraint` returns `null` early for inapplicability (force-level node-relative scope; `scopeUnanchored`). Non-null always (satisfied or not).

- [ ] **Step 1: Write failing tests**

Use the same synthetic-catalogue/state helpers the existing engine tests use (mirror `checkConstraint` tests in the same/neighbor file). Add:

```ts
import { describeConstraint } from "../src/constraints";
// ... reuse existing test scaffolding to build `state` and a force-scope IrConstraint `c`.

it("describeConstraint reports a satisfied min", () => {
  // build state where the aggregated actual >= limit for a roster/force-scope min constraint
  const d = describeConstraint(cMinSatisfied, null, state);
  expect(d).toEqual({ actual: expect.any(Number), limit: expect.any(Number), satisfied: true });
});

it("describeConstraint reports a violated min", () => {
  const d = describeConstraint(cMinViolated, null, state);
  expect(d?.satisfied).toBe(false);
});

it("describeConstraint reports a max", () => {
  const d = describeConstraint(cMax, null, state);
  expect(d?.satisfied).toBe(true); // actual <= limit
});

it("describeConstraint returns null for a force-level node-relative scope", () => {
  expect(describeConstraint(cSelfScope, null, state)).toBeNull();
});
```

> Implementer: construct `cMinSatisfied`/`cMinViolated`/`cMax`/`cSelfScope` by copying the shape of the `IrConstraint` fixtures already used in this test file's `checkConstraint` cases, adjusting `type`, `value`, and `scope` only. Values must make actual/limit deterministic against the built `state`.

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm --filter @muster/engine-eval test -- constraints`
Expected: FAIL — `describeConstraint` not exported.

- [ ] **Step 3: Implement**

Add to `packages/engine-eval/src/constraints.ts`:

```ts
export function describeConstraint(
  constraint: IrConstraint,
  node: EvalNode | null,
  state: EvalState,
  costOf: CostFn = nodePoints,
): { actual: number; limit: number; satisfied: boolean } | null {
  if (node === null && constraint.scope !== "force" && constraint.scope !== "roster") return null;
  if (scopeUnanchored(node, constraint, state)) return null;
  const actual = aggregate(node, constraint, state, costOf);
  const limit = effectiveConstraintValue(constraint, node, state, costOf);
  const satisfied = constraint.type === "max" ? actual <= limit : actual >= limit;
  return { actual, limit, satisfied };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @muster/engine-eval test -- constraints`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/constraints.ts packages/engine-eval/test/constraints.test.ts
git commit -m "feat(engine-eval): describeConstraint for positive rule enumeration"
```

---

### Task 3: engine `evaluate` builds `checks`

**Files:**
- Modify: `packages/engine-eval/src/evaluate.ts`
- Test: `packages/engine-eval/test/evaluate.test.ts` (or the existing evaluate/legality test file)

**Interfaces:**
- Consumes: `describeConstraint` (Task 2), existing `totalCost`, `targetNamer` (`nameOf`), `catalogue.forceConstraints`.
- Produces: `evaluate()` result now includes `checks: LegalityCheck[]` — first a `points` check, then one `force` check per applicable `forceConstraint`.

- [ ] **Step 1: Write failing tests**

```ts
it("evaluate reports a satisfied points check under the limit", () => {
  const r = evaluate(rosterUnderLimit, catalogue);
  const pts = r.checks.find((c) => c.kind === "points");
  expect(pts).toMatchObject({ id: "points", satisfied: true, limit: r.pointsLimit, actual: r.totalPoints });
});

it("evaluate reports an unsatisfied points check over the limit", () => {
  const r = evaluate(rosterOverLimit, catalogue); // pointsLimit tiny
  expect(r.checks.find((c) => c.kind === "points")?.satisfied).toBe(false);
});

it("evaluate emits a force check per applicable forceConstraint and mirrors issues", () => {
  const r = evaluate(rosterMissingBattleline, catalogueWithForceMin);
  const force = r.checks.find((c) => c.kind === "force");
  expect(force).toBeDefined();
  expect(force?.satisfied).toBe(false);
  // invariant: an unsatisfied force check has a paired constraint issue with the same id
  expect(r.issues.some((i) => i.constraintId === force?.id)).toBe(true);
});

it("evaluate marks a force check satisfied when the rule is met (no paired issue)", () => {
  const r = evaluate(rosterWithBattleline, catalogueWithForceMin);
  const force = r.checks.find((c) => c.kind === "force");
  expect(force?.satisfied).toBe(true);
  expect(r.issues.some((i) => i.constraintId === force?.id)).toBe(false);
});
```

> Implementer: reuse the existing evaluate-test catalogue/roster builders. `catalogueWithForceMin` needs one `forceConstraints` entry (min, field selections, scope roster, targetType category) — copy the shape from an existing force-constraint fixture if present, else from `apps/web/public/real.ir.json`'s `forceConstraints[0]` shape (id/type/value/field/scope/targetType/targetId/includeChildSelections).

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm --filter @muster/engine-eval test -- evaluate`
Expected: FAIL — `checks` is `[]`/undefined.

- [ ] **Step 3: Implement**

In `packages/engine-eval/src/evaluate.ts`:

1. Import `describeConstraint` (extend the existing `./constraints` import) and `LegalityCheck` type from `@muster/domain`.
2. After `totalPoints` is computed, build the checks array:

```ts
  const checks: LegalityCheck[] = [
    {
      id: "points",
      kind: "points",
      label: "Points",
      actual: totalPoints,
      limit: roster.pointsLimit,
      satisfied: totalPoints <= roster.pointsLimit,
    },
  ];
  for (const constraint of catalogue.forceConstraints) {
    const d = describeConstraint(constraint, null, state, costOf);
    if (!d) continue;
    const name = nameOf(constraint.targetType, constraint.targetId);
    const target = `${constraint.targetType} "${name}"`;
    const label =
      constraint.type === "min"
        ? `At least ${d.limit} ${target}`
        : `At most ${d.limit} ${target}`;
    checks.push({
      id: constraint.id,
      kind: "force",
      label,
      actual: d.actual,
      limit: d.limit,
      satisfied: d.satisfied,
      constraintType: constraint.type,
    });
  }
```

3. Add `checks` to the returned object:

```ts
  return { valid, totalPoints, pointsLimit: roster.pointsLimit, issues: active, dismissed, hasHouseRules, checks };
```

> Note: `nameOf` and `costOf` already exist in scope in `evaluate()`. The force-constraint loop for `checks` is separate from the existing `issues` loop — do not merge them; the issues loop must stay byte-for-byte behaviorally identical.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter @muster/engine-eval test`
Expected: PASS. Coverage 100% (excl. `src/index.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/engine-eval/src/evaluate.ts packages/engine-eval/test/evaluate.test.ts
git commit -m "feat(engine-eval): emit army-level legality checks in evaluate"
```

---

### Task 4: web `LegalityPanel` component

**Files:**
- Create: `apps/web/src/components/LegalityPanel.tsx`
- Create: `apps/web/src/components/LegalityPanel.test.tsx`
- Modify: `apps/web/src/index.css` (panel styles)

**Interfaces:**
- Consumes: `ValidationResult` (with `checks`) from `@muster/domain`.
- Produces: `LegalityPanel` React component.

```ts
export type LegalityPanelProps = {
  result: ValidationResult;
  unitNameOf: (selectionId: string) => string | undefined;
  onEditPoints: () => void;
  onFocusUnit: (selectionId: string) => void;
};
export function LegalityPanel(props: LegalityPanelProps): JSX.Element;
```

- [ ] **Step 1: Write failing tests**

`apps/web/src/components/LegalityPanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LegalityPanel } from "./LegalityPanel";
import type { ValidationResult } from "@muster/domain";

function baseResult(over: Partial<ValidationResult> = {}): ValidationResult {
  return {
    valid: true, totalPoints: 90, pointsLimit: 2000, issues: [], dismissed: [], hasHouseRules: false,
    checks: [{ id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true }],
    ...over,
  };
}

describe("LegalityPanel", () => {
  it("shows LEGAL verdict when valid", () => {
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={() => {}} onFocusUnit={() => {}} />);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/legal/i);
  });

  it("shows ILLEGAL verdict when invalid", () => {
    render(<LegalityPanel result={baseResult({ valid: false })} unitNameOf={() => undefined} onEditPoints={() => {}} onFocusUnit={() => {}} />);
    expect(screen.getByTestId("verdict")).toHaveTextContent(/illegal/i);
  });

  it("points element text starts with total / limit", () => {
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={() => {}} onFocusUnit={() => {}} />);
    expect(screen.getByTestId("points").textContent ?? "").toMatch(/^90 \/ 2000/);
  });

  it("renders a check row per check with ✓/✗ semantics", () => {
    const result = baseResult({
      checks: [
        { id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true },
        { id: "f1", kind: "force", label: 'At least 1 category "Battleline"', actual: 0, limit: 1, satisfied: false, constraintType: "min" },
      ],
    });
    render(<LegalityPanel result={result} unitNameOf={() => undefined} onEditPoints={() => {}} onFocusUnit={() => {}} />);
    const checks = screen.getByTestId("army-checks");
    expect(checks).toHaveTextContent("Battleline");
    expect(checks.querySelectorAll("[data-satisfied='false']").length).toBe(1);
  });

  it("calls onFocusUnit when a unit issue is clicked", () => {
    const onFocusUnit = vi.fn();
    const result = baseResult({
      valid: false,
      issues: [{ severity: "error", code: "constraint.min", message: "Not enough", selectionId: "s1", entryId: "e1" }],
    });
    render(<LegalityPanel result={result} unitNameOf={() => "Captain"} onEditPoints={() => {}} onFocusUnit={onFocusUnit} />);
    fireEvent.click(screen.getByText(/Captain/));
    expect(onFocusUnit).toHaveBeenCalledWith("s1");
  });

  it("calls onEditPoints when Edit is clicked", () => {
    const onEditPoints = vi.fn();
    render(<LegalityPanel result={baseResult()} unitNameOf={() => undefined} onEditPoints={onEditPoints} onFocusUnit={() => {}} />);
    fireEvent.click(screen.getByTestId("edit-points"));
    expect(onEditPoints).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `pnpm --filter web test -- LegalityPanel`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement component**

Create `apps/web/src/components/LegalityPanel.tsx`. Requirements:
- Root `<section className="legality">`.
- Verdict: `<span data-testid="verdict" className={result.valid ? "verdict legal" : "verdict illegal"}>{result.valid ? "LEGAL" : "ILLEGAL"}</span>`.
- Points meter: a bar (`<div className="pts-bar">` with an inner fill width `min(100, total/limit*100)%`, class `over` when `total > limit`). A label element `data-testid="points"` whose text STARTS with `{total} / {limit}` then ` pts`, followed by remaining/over text (`{limit-total} left` or `over by {total-limit}`). An `<button data-testid="edit-points" onClick={onEditPoints}>Edit</button>`.
- Army checks: if `result.checks.length`, render `<ul data-testid="army-checks">`; each check `<li data-satisfied={String(c.satisfied)} className={c.satisfied ? "check ok" : "check bad"}>` with a status glyph (`✓`/`✗`), `c.label`, and `<span className="tabnum">{c.actual} / {c.limit}</span>`.
- Issues: split `result.issues` into army (`selectionId === undefined`) and unit (`selectionId !== undefined`). Army issues as plain `<li>` colored by severity. Unit issues as a clickable `<li><button onClick={() => onFocusUnit(i.selectionId!)}>{unitNameOf(i.selectionId!) ?? "Unit"}: {i.message}</button></li>`. Color by `i.severity` via className `issue error|warning`.
- Use `JSX.Element` return type; no `any`. Guard `selectionId!` only where already narrowed by the split.

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm --filter web test -- LegalityPanel`
Expected: PASS.

- [ ] **Step 5: Add CSS**

In `apps/web/src/index.css`, add `.legality`, `.verdict.legal/.illegal`, `.pts-bar`/fill/`.over`, `.check.ok/.bad`, `.tabnum { font-variant-numeric: tabular-nums }`, `.issue.error/.warning` using existing theme tokens (`--error`, `--warn`, accent). Keep compact.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/LegalityPanel.tsx apps/web/src/components/LegalityPanel.test.tsx apps/web/src/index.css
git commit -m "feat(web): LegalityPanel — verdict, points meter, army checks, grouped issues"
```

---

### Task 5: wire `LegalityPanel` into `App`

**Files:**
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`, `apps/web/src/builder.test.tsx` (must stay green; add one panel assertion to App.test)

**Interfaces:**
- Consumes: `LegalityPanel` (Task 4), existing `result`, `openWizardAt`, `setSelectedUnitId`, `roster`, `catalogue`.

- [ ] **Step 1: Add/adjust test**

Confirm the `data-testid="points"` contract still holds after wiring, and the panel renders. In `apps/web/src/App.test.tsx` add:

```tsx
it("renders the legality panel with a verdict", () => {
  render(<App />);
  expect(screen.getByTestId("verdict")).toBeTruthy();
  expect(screen.getByTestId("points")).toHaveTextContent(/0\s*\/\s*2000/);
});
```

- [ ] **Step 2: Run the web suite, observe current state**

Run: `pnpm --filter web test`
Expected: the new App assertion FAILS (no verdict yet); existing `points` tests still pass (span still present pre-wiring).

- [ ] **Step 3: Wire the panel**

In `apps/web/src/App.tsx`:
- Import `LegalityPanel`.
- Remove the inline `<span data-testid="points">…</span>` from the header (the panel now owns `data-testid="points"`). Keep the `load IR` control in the header.
- Remove the inline `{result.issues.length > 0 && (<ul>…</ul>)}` block.
- Under `<SetupBar …/>`, render:

```tsx
<LegalityPanel
  result={result}
  unitNameOf={(selectionId) => {
    const sel = roster.selections.find((s) => s.id === selectionId);
    return sel ? catalogue.entries.find((e) => e.id === sel.entryId)?.name : undefined;
  }}
  onEditPoints={() => openWizardAt(0)}
  onFocusUnit={setSelectedUnitId}
/>
```

> Implementer: verify the actual field names for a roster selection (`roster.selections[i].id`, `.entryId`) and catalogue entry name (`catalogue.entries[i].name`) against `@muster/roster` and `@muster/domain` types; adjust the `unitNameOf` lookup to the real shape if it differs. The lookup must resolve the top-level unit name for a given selection id.

- [ ] **Step 4: Run web suite, verify green**

Run: `pnpm --filter web test`
Expected: PASS — new verdict assertion passes; all existing `points`/builder/App tests pass (leading `{total} / {limit}` preserved by the panel).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/App.test.tsx
git commit -m "feat(web): mount LegalityPanel, retire inline points span and issue list"
```

---

### Task 6: full-suite gate + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `pnpm turbo run test`
Expected: all packages green (domain 100%, engine-eval 100% excl index, web, parser golden untouched).

- [ ] **Step 2: Browser smoke on mini40k**

Start the web dev server (via preview_start with the app's launch config; create `.claude/launch.json` if absent), add a unit, and confirm: verdict badge renders, points meter fills and shows remaining, army checks list shows ✓/✗ rows, clicking a unit-level issue focuses the unit. Capture a screenshot as proof.

- [ ] **Step 3: No commit** (verification only). If browser reveals a defect, fix at the relevant task's source and re-run its tests before re-verifying.

---

## Self-Review

- **Spec coverage:** Part A (checks schema → Task 1; describeConstraint → Task 2; evaluate builds checks → Task 3). Part B (LegalityPanel → Task 4; App wiring → Task 5). Verification → Task 6. All spec sections mapped.
- **Placeholder scan:** No TBD/TODO; all steps carry concrete code or exact lookups. The two "implementer: verify real shape" notes are grounding instructions, not placeholders — the code to write is fully specified, only field-name confirmation is delegated.
- **Type consistency:** `LegalityCheck` fields identical across Tasks 1/3/4. `describeConstraint` return shape identical in Tasks 2/3. `LegalityPanelProps` identical in Tasks 4/5. `data-testid="points"` leading-text contract stated in Global Constraints and enforced in Tasks 4/5.
