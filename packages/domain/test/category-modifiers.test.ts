import { describe, it, expect } from "vitest";
import { IrCategoryModifier, IrEntry } from "@muster/domain";

describe("IrCategoryModifier", () => {
  it("parses an add with a gating condition", () => {
    const parsed = IrCategoryModifier.parse({
      type: "add", categoryId: "cat.keyword",
      conditions: [{
        id: "cond.atLeast.det", comparator: "atLeast", value: 1,
        field: "selections", scope: "roster", targetType: "entry",
        targetId: "e.det", includeChildSelections: true,
      }],
    });
    expect(parsed.type).toBe("add");
    expect(parsed.categoryId).toBe("cat.keyword");
    expect(parsed.conditions?.[0]?.comparator).toBe("atLeast");
  });

  it("defaults IrEntry.categoryModifiers to [] when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.categoryModifiers).toEqual([]);
  });

  it("carries categoryModifiers on an entry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E",
      categoryModifiers: [{ type: "remove", categoryId: "cat.x" }],
    });
    expect(e.categoryModifiers?.[0]?.type).toBe("remove");
  });
});
