import { describe, it, expect } from "vitest";
import { IrEntry, VisibilityModifier } from "@muster/domain";

describe("VisibilityModifier + IrEntry visibility fields", () => {
  it("parses a VisibilityModifier with an instanceOf-derived condition", () => {
    const vm = VisibilityModifier.parse({
      set: true,
      conditions: [{ id: "c", comparator: "atLeast", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det" }],
    });
    expect(vm.set).toBe(true);
    expect(vm.conditions?.[0]?.comparator).toBe("atLeast");
  });

  it("defaults hidden=false and visibilityModifiers=[] on a bare entry", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.hidden).toBe(false);
    expect(e.visibilityModifiers).toEqual([]);
  });

  it("carries hidden + visibilityModifiers through IrEntry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E", hidden: true,
      visibilityModifiers: [{ set: true, conditionGroups: [{ type: "or", conditions: [
        { id: "c", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det" },
      ] }] }],
    });
    expect(e.hidden).toBe(true);
    expect(e.visibilityModifiers?.[0]?.conditionGroups?.[0]?.type).toBe("or");
  });
});
