import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// A unit requires min 5 models (a "min" constraint on its own children count).
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    {
      id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: ["cat.troops"], children: [],
      constraints: [{
        id: "k.minmodels", type: "min", value: 5, field: "selections", scope: "self",
        targetType: "entry", targetId: "e.model", includeChildSelections: true,
      }],
    },
    { id: "e.model", name: "Model", costs: [], categories: ["cat.model"], constraints: [], children: [] },
  ],
};

// Understrength: squad with only 3 models (min is 5).
function rosterWith(overrides?: Roster["overrides"]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "sq", entryId: "e.squad", count: 1,
      selections: [{ id: "m", entryId: "e.model", count: 3, selections: [] }],
    }],
    overrides,
  };
}

describe("override / house-rules layer", () => {
  it("without overrides, the min-models violation is active and invalid", () => {
    const r = evaluate(rosterWith(), cat);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.constraintId === "k.minmodels")).toBe(true);
    expect(r.dismissed).toEqual([]);
    expect(r.hasHouseRules).toBe(false);
  });

  it("a system (understrength) override dismisses it → valid, not flagged as house-rules", () => {
    const r = evaluate(rosterWith([{ constraintId: "k.minmodels", selectionId: "sq", source: "system", reason: "understrength" }]), cat);
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.constraintId === "k.minmodels")).toBe(false);
    expect(r.dismissed.some((i) => i.constraintId === "k.minmodels")).toBe(true);
    expect(r.hasHouseRules).toBe(false); // system, not user
  });

  it("a user override dismisses it → valid AND flagged as house-rules", () => {
    const r = evaluate(rosterWith([{ constraintId: "k.minmodels", source: "user", reason: "casual game" }]), cat);
    expect(r.valid).toBe(true);
    expect(r.hasHouseRules).toBe(true);
  });

  it("selectionId-scoped override only dismisses the matching selection", () => {
    const r = evaluate(rosterWith([{ constraintId: "k.minmodels", selectionId: "other", source: "user" }]), cat);
    expect(r.valid).toBe(false); // selectionId doesn't match "sq" → not dismissed
    expect(r.hasHouseRules).toBe(false);
  });
});
