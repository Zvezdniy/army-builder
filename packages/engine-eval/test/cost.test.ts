import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildSymbolTable, buildState, totalCost } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: [], constraints: [],
      children: [{ id: "e.gun", name: "Gun", costs: [{ name: "points", value: 5 }], categories: [], constraints: [], children: [] }] },
  ],
};

describe("totalCost", () => {
  it("multiplies costs by effectiveCount through the tree", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "s.squad", entryId: "e.squad", count: 2,
          selections: [{ id: "s.gun", entryId: "e.gun", count: 3, selections: [] }] },
      ],
    };
    // squad: 100 * 2 = 200; gun: 5 * (3 * 2) = 30 => 230
    const state = buildState(roster, buildSymbolTable(cat));
    expect(totalCost(state)).toBe(230);
  });

  it("is 0 for an empty roster", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000, selections: [],
    };
    expect(totalCost(buildState(roster, buildSymbolTable(cat)))).toBe(0);
  });
});
