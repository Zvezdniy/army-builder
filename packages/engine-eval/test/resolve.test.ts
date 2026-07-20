import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { buildState, resolveCosts, totalCost, effectiveCostOfType } from "@muster/engine-eval";

// A troop costs 10, but gets a -3 discount when the army fields at least 3 troops.
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
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
    const state = buildState(rosterOf(3), cat);
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(totalCost(state, res.costOf)).toBe(21); // 3 troops * (10 - 3)
  });

  it("no discount below the threshold", () => {
    const state = buildState(rosterOf(2), cat);
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(totalCost(state, res.costOf)).toBe(20); // 2 * 10
  });

  it("prices a unit by its own model count via a self-referential foreign-id scope", () => {
    // Squad "u" costs 80 pts, set to 160 when it holds >= 6 "m" models. The cost
    // modifier's condition scopes by the squad's OWN entry id ("u") — a foreign-id scope.
    const squad: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [{
        id: "u", name: "Squad", categories: [], constraints: [],
        children: [{ id: "m", name: "Model", categories: [], constraints: [], children: [], costs: [] }],
        costs: [{
          name: "pts", value: 80,
          modifiers: [{
            id: "bulk", type: "set", value: 160,
            conditions: [{ id: "c", comparator: "atLeast", value: 6, field: "selections", scope: "u", targetType: "entry", targetId: "m", includeChildSelections: true }],
          }],
        }],
      }],
    };
    const roster = (models: number) => ({
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "su", entryId: "u", count: 1, selections: [{ id: "sm", entryId: "m", count: models, selections: [] }] }],
    });
    const s5 = buildState(roster(5), squad);
    expect(totalCost(s5, resolveCosts(s5).costOf)).toBe(80); // 5 models -> base
    const s6 = buildState(roster(6), squad);
    expect(totalCost(s6, resolveCosts(s6).costOf)).toBe(160); // 6 models -> breakpoint
  });

  it("terminates and reports converged for a plain catalogue", () => {
    const plain: IrCatalogue = { ...cat, entries: [{ id: "e.troop", name: "T", categories: [], constraints: [], children: [], costs: [{ name: "points", value: 10 }] }] };
    const state = buildState(rosterOf(5), plain);
    const res = resolveCosts(state);
    expect(res.converged).toBe(true);
    expect(res.iterations).toBeLessThanOrEqual(2);
    expect(totalCost(state, res.costOf)).toBe(50);
  });
});

// A detachment costs 2 Detachment Points, but a `set 3` modifier fires once at
// least 3 detachment-shaped selections are in the army — the same gate shape as
// the "bulk discount" fixture above, mirroring the real Bastion Task Force case
// (base 2, `set 3`). Named cost types previously read the RAW value here (see the
// whole-branch finding); effectiveCostOfType must apply the modifier exactly like
// effectiveNodePoints already does for the points cost.
const dpCat: IrCatalogue = {
  id: "c2", name: "C2", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "e.det", name: "Detachment", categories: ["cat.det"], constraints: [], children: [],
    costs: [{
      name: "Detachment Points", value: 2,
      modifiers: [{
        id: "bump", type: "set", value: 3,
        conditions: [{ id: "c", comparator: "atLeast", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.det", includeChildSelections: false }],
      }],
    }],
  }],
};

function dpRosterOf(n: number) {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c2", catalogueRevision: 1, pointsLimit: 2000,
    selections: Array.from({ length: n }, (_, i) => ({ id: `d${i}`, entryId: "e.det", count: 1, selections: [] })),
  };
}

describe("effectiveCostOfType", () => {
  it("aggregates the MODIFIED value when the modifier's condition passes", () => {
    const state = buildState(dpRosterOf(3), dpCat);
    const { costOf } = resolveCosts(state);
    const node = state.all[0]!;
    expect(effectiveCostOfType(node, "Detachment Points", state, costOf)).toBe(3);
  });

  it("aggregates the BASE value when the modifier's condition does not pass", () => {
    const state = buildState(dpRosterOf(1), dpCat);
    const { costOf } = resolveCosts(state);
    const node = state.all[0]!;
    expect(effectiveCostOfType(node, "Detachment Points", state, costOf)).toBe(2);
  });

  it("returns 0 for a cost type the entry doesn't carry", () => {
    const state = buildState(dpRosterOf(1), dpCat);
    const { costOf } = resolveCosts(state);
    const node = state.all[0]!;
    expect(effectiveCostOfType(node, "Enhancements", state, costOf)).toBe(0);
  });

  it("scales by effectiveCount, same as effectiveNodePoints does for points", () => {
    // count 2: the "selections" aggregate the modifier's own gate reads sums
    // effectiveCount (not selection occurrences), so this single node's effectiveCount
    // of 2 stays below the >=3 threshold — the base value (2) applies, scaled by
    // effectiveCount (2) => 4.
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c2", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "d0", entryId: "e.det", count: 2, selections: [] }],
    };
    const state = buildState(roster, dpCat);
    const { costOf } = resolveCosts(state);
    const node = state.all[0]!;
    expect(effectiveCostOfType(node, "Detachment Points", state, costOf)).toBe(4);
  });
});
