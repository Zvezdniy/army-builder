# roster-scope group limits — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce `selectionEntryGroup` constraints with `scope="roster"` ("0-1 per army"-style limits) once at army level, deduping across inlined copies.

**Architecture:** Add `scope` to `IrGroupConstraint` (domain + parser, default "self" → backward-compatible, skip-serialized). `map_group_constraint` maps `roster` (was dropped). `checkGroupConstraint` counts roster-wide for `scope==="roster"` (over `state.all`) vs owner-local for `"self"`. `evaluate` dedups roster-scope group issues by `group.id:gc.id` so a group inlined N times raises one issue, not N.

**Tech Stack:** Rust (quick-xml/serde) parser; TypeScript strict (`noUncheckedIndexedAccess`), Zod, Vitest. `@muster/engine-eval` requires 100% coverage (excl. `src/index.ts`).

## Global Constraints

- **Never miscompile**: local (self) group limits keep identical semantics; golden `mini40k.ir.json` byte-identical (scope skip-serialized when "self").
- `IrGroupConstraint.scope` default is `"self"`; parser emits it only when `!= "self"`.
- Roster-scope counting is over actually-selected roster nodes (`state.all`), never invented. A roster-scope `min` is legitimately violable on an empty/short roster — NO never-over-enforce guard needed (the whole roster is a valid scope).
- A roster-scope group issue is army-level: `selectionId`/`entryId` are `undefined`; `constraintId = gc.id`.
- Dedup key for roster-scope group constraints: `` `${group.id}:${gc.id}` `` — evaluate once.
- Scope broadening is groups-only here; do not touch entry `checkConstraint` or `IrConstraint`.
- clippy clean; TS no non-null on index access.

---

### Task 1: domain — `IrGroupConstraint.scope`

**Files:**
- Modify: `packages/domain/src/ir.ts` (IrGroupConstraint)
- Test: `packages/domain/test/ir.test.ts`

**Interfaces:**
- Produces: `IrGroupConstraint.scope?: "self" | "roster"` (defaults to `"self"`).

- [ ] **Step 1: Write the failing test**

Append to `packages/domain/test/ir.test.ts` (`IrGroupConstraint` is already imported at the top — do not re-import):

```typescript
describe("IrGroupConstraint.scope", () => {
  it("accepts roster scope and defaults to self", () => {
    expect(IrGroupConstraint.parse({ id: "g", type: "max", value: 1, scope: "roster" }).scope).toBe("roster");
    expect(IrGroupConstraint.parse({ id: "g", type: "max", value: 1 }).scope).toBe("self");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/domain test`
Expected: FAIL — `scope` unknown / undefined.

- [ ] **Step 3: Implement**

In `packages/domain/src/ir.ts`, change the `IrGroupConstraint` object to add `scope` (after `value`):

```typescript
export const IrGroupConstraint = z.object({
  id: z.string(),
  type: z.enum(["min", "max"]),
  value: z.number().finite(),
  scope: z.enum(["self", "roster"]).default("self"),
});
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @muster/domain test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ir.ts packages/domain/test/ir.test.ts
git commit -m "feat(domain): IrGroupConstraint.scope (self default, roster)"
```

---

### Task 2: parser — map `roster` group-constraint scope

**Files:**
- Modify: `packages/engine-parser/src/ir/model.rs` (IrGroupConstraint struct + `is_self` helper)
- Modify: `packages/engine-parser/src/ir/map.rs:211-238` (map_group_constraint)
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Produces: IR group constraints carry `scope` (omitted when "self"); roster-scope maps instead of dropping.

- [ ] **Step 1: Write the failing tests**

Append to `packages/engine-parser/tests/map.rs`:

```rust
#[test]
fn group_constraint_roster_scope_maps() {
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.relic" name="Relics">
          <constraints><constraint id="k" type="max" value="1" field="selections" scope="roster"/></constraints>
          <selectionEntries>
            <selectionEntry id="e.r1" name="R1" type="upgrade"/>
          </selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = e.groups.iter().find(|g| g.id == "g.relic").unwrap();
    assert_eq!(g.constraints.len(), 1);
    assert_eq!(g.constraints[0].scope, "roster");
    assert!(!diags.iter().any(|d| d.code == "group.constraint_dropped"));
}

#[test]
fn group_constraint_self_scope_omits_scope_field() {
    // A self/parent/own-id scoped group limit keeps the local default; the JSON
    // must omit "scope" so the golden stays stable.
    let xml = br#"<?xml version="1.0" encoding="utf-8"?>
<catalogue id="c" name="C" revision="1" gameSystemId="gs"
           xmlns="http://www.battlescribe.net/schema/catalogueSchema">
  <selectionEntries>
    <selectionEntry id="e.u" name="U" type="unit">
      <selectionEntryGroups>
        <selectionEntryGroup id="g.w" name="W">
          <constraints><constraint id="k" type="max" value="1" field="selections" scope="parent"/></constraints>
          <selectionEntries><selectionEntry id="e.w1" name="W1" type="upgrade"/></selectionEntries>
        </selectionEntryGroup>
      </selectionEntryGroups>
    </selectionEntry>
  </selectionEntries>
</catalogue>"#;
    let (ir, _diags) = to_ir(&resolve(parse_raw(xml).unwrap()).unwrap());
    let e = ir.entries.iter().find(|e| e.id == "e.u").unwrap();
    let g = e.groups.iter().find(|g| g.id == "g.w").unwrap();
    assert_eq!(g.constraints[0].scope, "self");
    let json = serde_json::to_string(&g.constraints[0]).unwrap();
    assert!(!json.contains("scope"), "self scope must be skip-serialized: {}", json);
}
```

(If `serde_json` is not already a dev-dependency in scope for this test file, use the crate's existing golden-comparison import; `serde_json` is used by the golden test so it is available.)

- [ ] **Step 2: Run to verify failure**

Run: `cargo test -p engine-parser --test map`
Expected: FAIL — `scope` field doesn't exist on `IrGroupConstraint`; roster currently dropped.

- [ ] **Step 3: Add the struct field + helper**

In `packages/engine-parser/src/ir/model.rs`, add the `scope` field to `IrGroupConstraint`:

```rust
pub struct IrGroupConstraint {
    pub id: String,
    #[serde(rename = "type")]
    pub type_: String,
    pub value: f64,
    #[serde(skip_serializing_if = "is_self")]
    pub scope: String,
}
```

Add this helper near the existing `is_false` helper (top of the file):

```rust
fn is_self(s: &str) -> bool {
    s == "self"
}
```

- [ ] **Step 4: Map roster scope in `map_group_constraint`**

In `packages/engine-parser/src/ir/map.rs`, replace the scope-drop block (lines ~224-232) and the final `Some(...)` so it maps roster and records scope:

```rust
    // Group-local scopes (self/parent/own-id) count the owner's direct members;
    // roster scope is an army-wide limit the engine dedups. Anything else still
    // aggregates over a set the engine does not model — drop loudly.
    let scope = if c.scope == "self" || c.scope == "parent" || c.scope == g.id {
        "self".to_string()
    } else if c.scope == "roster" {
        "roster".to_string()
    } else {
        diags.push(drop(format!("has non-group-local scope {}", c.scope)));
        return None;
    };
    if g.modifiers.iter().any(|m| m.field == c.id) {
        diags.push(drop("has a modifier on its limit".to_string()));
        return None;
    }
    Some(IrGroupConstraint { id: c.id.clone(), type_: c.kind.clone(), value: c.value, scope })
```

- [ ] **Step 5: Run tests + golden + clippy**

Run: `cargo test -p engine-parser && cargo clippy -p engine-parser --all-targets -- -D warnings`
Expected: new tests pass; golden byte-identical (mini40k group constraints are self → scope omitted); clippy clean. If golden fails, STOP and report.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-parser/src/ir/model.rs packages/engine-parser/src/ir/map.rs packages/engine-parser/tests/map.rs
git commit -m "feat(parser): map roster-scope group constraints (scope field, self skip-serialized)"
```

---

### Task 3: engine-eval — roster-wide count + dedup

**Files:**
- Modify: `packages/engine-eval/src/groups.ts` (checkGroupConstraint signature + roster branch)
- Modify: `packages/engine-eval/src/evaluate.ts` (pass state + dedup)
- Test: `packages/engine-eval/test/groups.test.ts`

**Interfaces:**
- Consumes: `IrGroupConstraint.scope` (Task 1), `EvalState` (`state.ts`).
- Produces: `checkGroupConstraint(gc, node, group, state): Issue | null`; roster-scope issues are army-level and deduped.

- [ ] **Step 1: Write the failing tests**

In `packages/engine-eval/test/groups.test.ts`, add a roster-scope fixture and tests. Add a catalogue builder with the group constraint scoped roster and the group present on a unit; for the dedup test, put the SAME group (same id) on two units and select members in both. Example additions (adapt to the file's `cat`/`roster` helpers):

```typescript
function rosterCat(gcType: "max" | "min", value: number): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [{ id: "e.relic", name: "Relic", costs: [], categories: [], constraints: [], children: [], groups: [] }],
        groups: [{ id: "g.relics", name: "Relics", memberEntryIds: ["e.relic"], constraints: [{ id: "g.relics.lim", type: gcType, value, scope: "roster" }] }],
      },
    ],
  } as unknown as IrCatalogue;
}
const rosterTwoHeroes = (relicsEach: number): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [0, 1].map((h) => ({
    id: `h${h}`, entryId: "e.hero", count: 1,
    selections: Array.from({ length: relicsEach }, (_, i) => ({ id: `h${h}r${i}`, entryId: "e.relic", count: 1, selections: [] })),
  })),
});

describe("roster-scope group constraints", () => {
  it("counts group members across the whole roster (max 1, two selected) → one army-level error", () => {
    const r = evaluate(rosterTwoHeroes(1), rosterCat("max", 1)); // 2 relics total across 2 heroes
    const groupIssues = r.issues.filter((i) => i.constraintId === "g.relics.lim");
    expect(groupIssues.length).toBe(1); // deduped, not one per placement
    expect(groupIssues[0]!.code).toBe("group.max");
    expect(groupIssues[0]!.selectionId).toBeUndefined(); // army-level
  });

  it("roster-scope min flags when the whole roster is short", () => {
    const r = evaluate(rosterTwoHeroes(0), rosterCat("min", 1)); // 0 relics total
    expect(r.issues.some((i) => i.constraintId === "g.relics.lim" && i.code === "group.min")).toBe(true);
  });

  it("roster-scope max satisfied (1 total) → no issue", () => {
    // one hero with a relic, one without
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "h0", entryId: "e.hero", count: 1, selections: [{ id: "h0r0", entryId: "e.relic", count: 1, selections: [] }] },
        { id: "h1", entryId: "e.hero", count: 1, selections: [] },
      ],
    } as unknown as Roster;
    const r = evaluate(roster, rosterCat("max", 1));
    expect(r.issues.some((i) => i.constraintId === "g.relics.lim")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @muster/engine-eval test groups`
Expected: FAIL — roster scope currently counts owner-local (each hero has ≤1 → no error, or duplicate issues), and `checkGroupConstraint` has no `state` param.

- [ ] **Step 3: Implement `checkGroupConstraint` roster branch**

Replace `packages/engine-eval/src/groups.ts` body of `checkGroupConstraint`:

```typescript
import type { IrGroup, IrGroupConstraint, Issue } from "@muster/domain";
import type { EvalNode, EvalState } from "./state";

// A group choose-N aggregates the owner's direct member children (self scope) or,
// for a roster-scope limit, every selected member across the whole roster. Counts
// selections only.
export function checkGroupConstraint(
  gc: IrGroupConstraint,
  node: EvalNode,
  group: IrGroup,
  state: EvalState,
): Issue | null {
  const isRoster = gc.scope === "roster";
  const actual = isRoster
    ? state.all.reduce((sum, n) => (group.memberEntryIds.includes(n.entry.id) ? sum + n.effectiveCount : sum), 0)
    : node.children.reduce((sum, c) => (group.memberEntryIds.includes(c.entry.id) ? sum + c.effectiveCount : sum), 0);

  const violated = gc.type === "max" ? actual > gc.value : actual < gc.value;
  if (!violated) return null;

  const message =
    gc.type === "max"
      ? `Too many in "${group.name}": ${actual} exceeds max ${gc.value}`
      : `Not enough in "${group.name}": ${actual} below min ${gc.value}`;

  return {
    severity: "error",
    code: gc.type === "max" ? "group.max" : "group.min",
    message,
    selectionId: isRoster ? undefined : node.selectionId,
    entryId: isRoster ? undefined : node.entry.id,
    constraintId: gc.id,
  };
}
```

- [ ] **Step 4: Pass state + dedup in `evaluate.ts`**

In `packages/engine-eval/src/evaluate.ts`, update the group loop. Before the `for (const node of state.all)` loop add a dedup set, and change the group inner loop:

```typescript
  const seenRosterGroup = new Set<string>();
```

```typescript
    for (const group of node.entry.groups ?? []) {
      for (const gc of group.constraints) {
        if (gc.scope === "roster") {
          const key = `${group.id}:${gc.id}`;
          if (seenRosterGroup.has(key)) continue;
          seenRosterGroup.add(key);
        }
        const issue = checkGroupConstraint(gc, node, group, state);
        if (issue) raw.push(issue);
      }
    }
```

(Place `const seenRosterGroup = new Set<string>();` next to the existing `raw`/loop setup, before the `for (const node of state.all)` loop.)

- [ ] **Step 5: Run tests + full coverage**

Run: `pnpm --filter @muster/engine-eval test`
Expected: all green AND 100% coverage (excl. src/index.ts). The roster max/min/satisfied + self-scope existing tests cover both branches of `isRoster` and the dedup `continue`. If the `seenRosterGroup.has` true branch is uncovered, the two-heroes dedup test (group inlined on two placements) exercises it.

- [ ] **Step 6: Commit**

```bash
git add packages/engine-eval/src/groups.ts packages/engine-eval/src/evaluate.ts packages/engine-eval/test/groups.test.ts
git commit -m "feat(engine-eval): enforce roster-scope group limits once at army level"
```

---

### Task 4: full-suite verification

**Files:** none.

- [ ] **Step 1: Whole workspace**

Run: `pnpm turbo run test` (4/4 green, engine-eval 100%) and `cd packages/engine-parser && cargo test` (all green).

- [ ] **Step 2: (evidence) real-catalogue check**

If a scratchpad real catalogue is available, parse it and confirm `group.constraint_dropped` fell from ~1232 to ~283 (the remaining modifier-on-limit bucket), and that `scope="roster"` group constraints now appear in the IR. Evidence for the final report.

---

## Self-Review

**Spec coverage:**
- Domain `IrGroupConstraint.scope` default self → Task 1. ✓
- Parser struct field (skip-serialized) + `map_group_constraint` roster + golden byte-identical → Task 2. ✓
- Engine roster-wide count + army-level issue + dedup + state param → Task 3. ✓
- Never-miscompile (self unchanged, golden stable, roster counts real selections, dedup) → Global Constraints + Task 3. ✓
- roster min legitimately violable, no guard → Task 3 min test. ✓
- Real evidence → Task 4. ✓

**Placeholder scan:** No TBD/TODO; all code steps concrete. ✓

**Type consistency:** `IrGroupConstraint.scope` (domain "self"|"roster") ↔ parser `scope: String` emitting "self"/"roster" ↔ engine reads `gc.scope === "roster"`. `checkGroupConstraint(gc, node, group, state)` — 4-arg signature updated at its one call site in evaluate.ts. Dedup key `${group.id}:${gc.id}`. ✓
