import { describe, it, expect } from "vitest";
import { IrCatalogue, IrConstraint, IrGroup, IrGroupConstraint, IrEntry } from "@muster/domain";

describe("IR schemas", () => {
  it("defaults includeChildSelections to false", () => {
    const c = IrConstraint.parse({
      id: "c1",
      type: "max",
      value: 3,
      field: "selections",
      scope: "force",
      targetType: "category",
      targetId: "cat.heavy",
    });
    expect(c.includeChildSelections).toBe(false);
  });

  it("parses a recursive catalogue with nested children", () => {
    const cat = IrCatalogue.parse({
      id: "cat.demo",
      name: "Demo",
      gameSystemId: "gs.40k",
      revision: 1,
      forceConstraints: [],
      entries: [
        {
          id: "e.unit",
          name: "Unit",
          costs: [{ name: "points", value: 100 }],
          categories: ["cat.troops"],
          constraints: [],
          children: [
            { id: "e.wargear", name: "Wargear", costs: [{ name: "points", value: 5 }] },
          ],
        },
      ],
    });
    expect(cat.entries[0]?.children[0]?.name).toBe("Wargear");
    // children/categories/constraints default to [] when omitted
    expect(cat.entries[0]?.children[0]?.children).toEqual([]);
  });
});

describe("IrGroup / IrGroupConstraint", () => {
  it("parses a group with min/max constraints and members", () => {
    const g = IrGroup.parse({
      id: "g.wargear", name: "Wargear",
      memberEntryIds: ["e.sword", "e.axe"],
      constraints: [{ id: "g.max", type: "max", value: 1 }],
    });
    expect(g.memberEntryIds).toEqual(["e.sword", "e.axe"]);
    expect(g.constraints[0]).toEqual({ id: "g.max", type: "max", value: 1 });
  });

  it("defaults memberEntryIds and constraints to empty arrays", () => {
    const g = IrGroup.parse({ id: "g", name: "G" });
    expect(g.memberEntryIds).toEqual([]);
    expect(g.constraints).toEqual([]);
  });

  it("defaults IrEntry.groups to empty array when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.groups).toEqual([]);
  });

  it("rejects a non-finite constraint value", () => {
    expect(IrGroupConstraint.safeParse({ id: "g", type: "max", value: Infinity }).success).toBe(false);
  });

  it("rejects an unknown constraint type", () => {
    expect(IrGroupConstraint.safeParse({ id: "g", type: "exactly", value: 1 }).success).toBe(false);
  });
});
