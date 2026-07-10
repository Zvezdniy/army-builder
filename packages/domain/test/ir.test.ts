import { describe, it, expect } from "vitest";
import { IrCatalogue, IrConstraint } from "@muster/domain";

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
