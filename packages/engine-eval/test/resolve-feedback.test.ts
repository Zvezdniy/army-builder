import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildState, resolveCosts, totalCost, evaluate, MAX_ITERATIONS } from "@muster/engine-eval";

// ---- Test A: a genuine points-field feedback loop that CONVERGES over 3 passes ----
// A costs 20 with a -10 discount gated on roster points <= 35 (a POINTS-field condition,
// so its gate reads costOf). B costs 20 with an unconditional -10. A's discount only
// triggers once B's discount has pulled the roster total under 35 — which requires the
// resolver to iterate: pass 1 sees raw total 40 (A undiscounted), pass 2 sees 30 (A
// discounted), pass 3 stabilises. A single-pass / raw-only resolver would report 30, not 20.
const catConverge: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.a", name: "A", categories: ["cat.a", "cat.all"], constraints: [], children: [],
      costs: [{
        name: "points", value: 20,
        modifiers: [{
          id: "m.a", type: "decrement", value: 10,
          conditions: [{ id: "c.a", comparator: "atMost", value: 35, field: "points", scope: "roster", targetType: "category", targetId: "cat.all", includeChildSelections: false }],
        }],
      }],
    },
    {
      id: "e.b", name: "B", categories: ["cat.b", "cat.all"], constraints: [], children: [],
      costs: [{ name: "points", value: 20, modifiers: [{ id: "m.b", type: "decrement", value: 10 }] }],
    },
  ],
};
const rosterConverge: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "a", entryId: "e.a", count: 1, selections: [] },
    { id: "b", entryId: "e.b", count: 1, selections: [] },
  ],
};

// ---- Test B: a points-field feedback loop that OSCILLATES → never converges ----
// O costs 10 with a -6 discount gated on roster points >= 10. Discounting to 4 removes
// the condition (4 < 10), which restores 10, which re-triggers it: 4 <-> 10 forever.
const catOscillate: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "e.o", name: "O", categories: ["cat.all"], constraints: [], children: [],
    costs: [{
      name: "points", value: 10,
      modifiers: [{
        id: "m.o", type: "decrement", value: 6,
        conditions: [{ id: "c.o", comparator: "atLeast", value: 10, field: "points", scope: "roster", targetType: "category", targetId: "cat.all", includeChildSelections: false }],
      }],
    }],
  }],
};
const rosterOscillate: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "o", entryId: "e.o", count: 1, selections: [] }],
};

describe("fixed-point cost feedback (points-field conditions)", () => {
  it("iterates to convergence when a discount depends on other nodes' costs", () => {
    const state = buildState(rosterConverge, catConverge);
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(res.iterations).toBe(3); // 2 would mean the cost-feedback pass was skipped
    // A discounted to 10 (because B's discount pulled the roster total to 30 <= 35) + B 10 = 20.
    // A non-iterating resolver would leave A at 20 (raw total 40 > 35) → 30. So 20 proves iteration.
    expect(totalCost(state, res.costOf)).toBe(20);
  });

  it("stops at MAX_ITERATIONS and reports non-convergence for an oscillating discount", () => {
    const state = buildState(rosterOscillate, catOscillate);
    const res = resolveCosts(state);
    expect(res.converged).toBe(false);
    expect(res.iterations).toBe(MAX_ITERATIONS);
  });

  it("evaluate surfaces a non-blocking nonconvergent warning (never throws)", () => {
    const result = evaluate(rosterOscillate, catOscillate);
    const warn = result.issues.find((i) => i.code === "modifiers.nonconvergent");
    expect(warn?.severity).toBe("warning");
    expect(result.valid).toBe(true); // warning is non-blocking; no hard error
  });
});
