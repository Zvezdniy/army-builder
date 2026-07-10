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
