import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildSymbolTable, buildState } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.squad", name: "Squad", costs: [], categories: ["cat.troops"], constraints: [],
      children: [{ id: "e.model", name: "Model", costs: [], categories: [], constraints: [], children: [] }] },
  ],
};

const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "s.squad", entryId: "e.squad", count: 2,
      selections: [{ id: "s.model", entryId: "e.model", count: 5, selections: [] }] },
  ],
};

describe("buildState", () => {
  it("computes multiplier and effectiveCount down the tree", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    const squad = state.roots[0]!;
    expect(squad.multiplier).toBe(1);
    expect(squad.effectiveCount).toBe(2);
    const model = squad.children[0]!;
    expect(model.multiplier).toBe(2); // ancestor squad count
    expect(model.effectiveCount).toBe(10); // 5 models * 2 squads
    expect(model.parent).toBe(squad);
    expect(state.all).toHaveLength(2);
  });

  it("throws on an unknown entryId", () => {
    const bad: Roster = { ...roster, selections: [{ id: "x", entryId: "nope", count: 1, selections: [] }] };
    expect(() => buildState(bad, buildSymbolTable(cat))).toThrow(/unknown entryid/i);
  });
});
