import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { hiddenEntryIds } from "@muster/engine-eval";

// Detachment category cat.det; an enhancement hidden unless the roster holds a
// detachment selection of that category (set hidden=true when 0 instances → notInstanceOf).
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.det", name: "Detachment", costs: [], categories: ["cat.det"], constraints: [], children: [] },
      {
        id: "e.enh", name: "Enhancement", costs: [], categories: [], constraints: [], children: [],
        visibilityModifiers: [{
          set: true,
          conditions: [{ id: "c1", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det" }],
        }],
      },
      { id: "e.plain", name: "Plain", costs: [], categories: [], constraints: [], children: [] },
      { id: "e.static", name: "Static", costs: [], categories: [], constraints: [], children: [], hidden: true },
    ],
  };
}
const roster = (members: string[]): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: members.map((m, i) => ({ id: `s${i}`, entryId: m, count: 1, selections: [] })),
});

describe("hiddenEntryIds", () => {
  it("hides the enhancement when no matching detachment is in the roster", () => {
    const hidden = hiddenEntryIds(roster([]), cat());
    expect(hidden.has("e.enh")).toBe(true);
  });
  it("reveals the enhancement when the detachment is present", () => {
    const hidden = hiddenEntryIds(roster(["e.det"]), cat());
    expect(hidden.has("e.enh")).toBe(false);
  });
  it("always hides a statically hidden entry", () => {
    expect(hiddenEntryIds(roster([]), cat()).has("e.static")).toBe(true);
  });
  it("never hides an entry with no visibility rules", () => {
    expect(hiddenEntryIds(roster(["e.det"]), cat()).has("e.plain")).toBe(false);
  });
});
