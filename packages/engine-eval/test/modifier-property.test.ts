import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { IrCatalogue } from "@muster/domain";
import { evaluate, buildState, resolveCosts, MAX_ITERATIONS } from "@muster/engine-eval";

// Catalogue whose troop cost steps down by 2 at >=3 and by another 2 at >=6 troops.
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
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
        const state = buildState(roster, cat);
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
