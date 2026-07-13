import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { buildState, resolveCosts, totalCost } from "@muster/engine-eval";

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
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
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
