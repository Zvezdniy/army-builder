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
