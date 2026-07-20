import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
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
