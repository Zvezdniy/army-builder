# Foreign-id scope resolution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development
> or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Resolve foreign-id (entry-id) scopes on conditions so model-count cost
modifiers gate correctly (Intercessor 5 models = 80 pts, 6+ = 160).

**Architecture:** domain loosens `IrCondition.scope` to string; parser emits unknown
condition scopes verbatim (no longer dropped); engine resolves a non-keyword scope to
the nearest ancestor-or-self node with that `entry.id` and aggregates over its subtree.

**Tech Stack:** TS (strict, ESM, Vitest), Rust (quick-xml/serde, clippy -D warnings,
byte-identical golden).

## Global Constraints

- Conditions only; `map_constraint` (constraint scopes) unchanged.
- Never inflate cost on an unresolvable scope: unknown scope aggregates to 0 → an
  `atLeast` gate stays false → `set` doesn't fire → base cost.
- Parser golden byte-identical; regenerate only if output changes.
- 100% coverage on domain + engine-eval (excl. src/index.ts).
- Backward compatible: keyword scopes keep their existing switch branches.

---

### Task 1: domain + engine — widen condition scope to string

**Files:**
- Modify: `packages/domain/src/conditions.ts`
- Modify: `packages/engine-eval/src/scopes.ts` (`AggregateSpec.scope` type only)
- Test: `packages/domain/test/conditions.test.ts`

**Interfaces:**
- Produces: `IrCondition.scope: string`; `AggregateSpec.scope: string`.

- [ ] **Step 1: Failing domain test** — `IrCondition.parse` accepts `scope: "8da0-…"` (an entry id).
- [ ] **Step 2:** In conditions.ts change `scope: z.enum([...])` → `scope: z.string()`,
  with a comment listing the keyword values and noting entry-id scopes are also valid.
- [ ] **Step 3:** In scopes.ts widen `AggregateSpec.scope` from the keyword union to `string`.
- [ ] **Step 4: Run** `pnpm --filter @muster/domain --filter @muster/engine-eval test` — green.
  (engine-eval `scopeNodes` switch still compiles; the entry-id default lands in Task 3.)
- [ ] **Step 5: Commit** `feat(domain,engine-eval): allow entry-id scopes on conditions`.

---

### Task 2: parser — emit unknown condition scopes verbatim

**Files:**
- Modify: `packages/engine-parser/src/ir/map.rs` (`map_condition_scope`)
- Test: `packages/engine-parser/tests/map.rs`

**Interfaces:**
- Consumes: `map_condition_scope`.
- Produces: a condition whose raw scope is a non-keyword id maps (scope passes through);
  no `condition.scope_unmapped` diagnostic for it.

- [ ] **Step 1: Failing test** — a condition with `scope="8da0-4570-c3c-819f"` on a cost
  `set` modifier survives into IR with `scope == "8da0-4570-c3c-819f"` (modifier keeps its
  condition), no `condition.scope_unmapped` diagnostic.
- [ ] **Step 2:** In `map_condition_scope`, change the catch-all arm: instead of pushing
  `condition.scope_unmapped` + returning `None`, return `Some(scope.to_string())`. Keep the
  explicit keyword arms and the `primary-catalogue` → `roster` alias. (`map_constraint`'s
  own scope check is untouched.)
- [ ] **Step 3: Run** `cargo test -p engine-parser` — expect pass; if golden differs,
  regenerate and verify the diff is only newly-surviving foreign-scope conditions.
- [ ] **Step 4:** `cargo clippy -p engine-parser --all-targets -- -D warnings` clean.
- [ ] **Step 5: Commit** `feat(parser): emit foreign-id condition scopes instead of dropping`.

---

### Task 3: engine — resolve foreign-id scope in scopeNodes

**Files:**
- Modify: `packages/engine-eval/src/scopes.ts`
- Test: `packages/engine-eval/test/scopes.test.ts`, `packages/engine-eval/test/resolve.test.ts` (or cost test)

**Interfaces:**
- Consumes: `scopeNodes`, `subtree`, `nearestByType` (pattern to mirror), `aggregate`.
- Produces: `scopeNodes` resolves a non-keyword scope to the nearest ancestor-or-self node
  whose `entry.id === spec.scope`, returning its subtree; `[]` if none.

- [ ] **Step 1: Failing test (aggregate)** — build a unit node (entry id "u") with 6 model
  children (entry "m"); a spec `{field:"selections", scope:"u", targetType:"entry",
  targetId:"m", includeChildSelections:true}` aggregates to 6 via the unit node; a spec with
  `scope:"nope"` aggregates to 0.
- [ ] **Step 2: Add `nearestByEntryId`** helper (mirror `nearestByType`): walk `node`→parents,
  return first with `n.entry.id === id`, else null.
- [ ] **Step 3: Add the `default` branch** to `scopeNodes`'s switch: `if (!node) return [];
  const anchor = nearestByEntryId(node, spec.scope); return anchor ? subtree(anchor,
  spec.includeChildSelections) : [];`. (Also covers stray `primary-catalogue` safely as 0
  if it ever reaches the engine.)
- [ ] **Step 4: Failing test (pricing e2e)** — catalogue: unit "u" base cost `{name:"pts",
  value:80}` with a cost modifier `{type:"set", value:160, conditions:[{comparator:"atLeast",
  value:6, field:"selections", scope:"u", targetType:"entry", targetId:"m",
  includeChildSelections:true}]}`; child model "m". Roster with 5 × m → effectiveNodePoints 80;
  6 × m → 160. Assert via `resolveCosts`/`effectiveNodePoints`.
- [ ] **Step 5: Implement** — Steps 2-3 already make it pass; run and confirm.
- [ ] **Step 6: Run** `pnpm --filter @muster/engine-eval test` — green, 100% coverage.
- [ ] **Step 7: Commit** `feat(engine-eval): resolve foreign-id scopes to the ancestor subtree`.

---

## Verification (after all tasks)

- [ ] `pnpm turbo run test` green; `cargo test` + clippy clean.
- [ ] Throwaway spec on the real Space Marines packed IR: Intercessor Squad at 5 models
  totals 80 pts, at 6/10 totals 160; confirm ≥1 other breakpoint unit. Then in-browser:
  add the unit, raise the model count past the breakpoint, watch the points jump. Screenshot.
  Remove the throwaway spec before finishing.

## Self-Review notes

- Spec coverage: domain string scope (T1), parser passthrough (T2), engine resolution +
  pricing e2e (T3). Constraints scope untouched (out of scope). Unresolvable-scope→0 safety
  covered by a test.
- Type consistency: `IrCondition.scope` and `AggregateSpec.scope` both become `string` in T1
  so the engine compiles before T3 adds the runtime branch.
