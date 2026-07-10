import { describe, it, expect } from "vitest";
import { IrCondition } from "@muster/domain";

describe("IrCondition", () => {
  it("parses a condition and defaults includeChildSelections", () => {
    const c = IrCondition.parse({
      id: "cond1",
      comparator: "atLeast",
      value: 3,
      field: "selections",
      scope: "force",
      targetType: "category",
      targetId: "cat.troops",
    });
    expect(c.comparator).toBe("atLeast");
    expect(c.includeChildSelections).toBe(false);
  });

  it("rejects an unknown comparator", () => {
    expect(() =>
      IrCondition.parse({
        id: "c",
        comparator: "roughly",
        value: 1,
        field: "selections",
        scope: "self",
        targetType: "entry",
        targetId: "e.x",
      }),
    ).toThrow();
  });
});
