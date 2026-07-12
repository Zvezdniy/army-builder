import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrModifier } from "@muster/domain";
import { buildState, applyModifiers } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e.x", name: "X", costs: [], categories: ["cat.x"], constraints: [], children: [] }],
};
const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "x1", entryId: "e.x", count: 1, selections: [] }],
};
const state = () => buildState(roster, cat);

describe("applyModifiers", () => {
  it("returns base when modifiers is undefined", () => {
    expect(applyModifiers(100, undefined, null, state())).toBe(100);
  });

  it("applies set, increment, decrement in order", () => {
    const mods: IrModifier[] = [
      { id: "a", type: "increment", value: 10 }, // 110
      { id: "b", type: "set", value: 50 },       // 50 (set overrides running value)
      { id: "c", type: "decrement", value: 5 },  // 45
    ];
    expect(applyModifiers(100, mods, null, state())).toBe(45);
  });

  it("skips a modifier whose gate fails", () => {
    const mods: IrModifier[] = [
      { id: "gated", type: "set", value: 0, conditions: [
        { id: "c", comparator: "atLeast", value: 999, field: "selections", scope: "force", targetType: "category", targetId: "cat.x", includeChildSelections: false },
      ] },
    ];
    expect(applyModifiers(100, mods, null, state())).toBe(100); // gate false → unchanged
  });
});
