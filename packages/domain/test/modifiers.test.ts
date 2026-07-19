import { describe, it, expect } from "vitest";
import { IrModifier, IrConstraint, IrCost } from "@muster/domain";

describe("IrModifier", () => {
  it("parses a gated modifier", () => {
    const m = IrModifier.parse({
      id: "m1",
      type: "set",
      value: 0,
      conditions: [
        { id: "c", comparator: "lessThan", value: 10, field: "selections", scope: "self", targetType: "category", targetId: "cat.model", includeChildSelections: true },
      ],
    });
    expect(m.type).toBe("set");
    expect(m.conditions?.[0]?.comparator).toBe("lessThan");
  });

  it("rejects an unknown modifier type", () => {
    expect(() => IrModifier.parse({ id: "m", type: "bogus-type", value: 2 })).toThrow();
  });

  it.each(["divide", "multiply"] as const)("accepts modifier type %s", (type) => {
    const m = IrModifier.parse({ id: "m", type, value: 2 });
    expect(m.type).toBe(type);
  });
});

describe("modifiers attach to constraints and costs", () => {
  it("IrConstraint accepts an optional modifiers array", () => {
    const c = IrConstraint.parse({
      id: "k1", type: "max", value: 1, field: "selections", scope: "force",
      targetType: "category", targetId: "cat.hq",
      modifiers: [{ id: "m", type: "increment", value: 1 }],
    });
    expect(c.modifiers?.[0]?.type).toBe("increment");
  });

  it("IrConstraint still parses with no modifiers (backward compat)", () => {
    const c = IrConstraint.parse({
      id: "k2", type: "min", value: 1, field: "selections", scope: "force",
      targetType: "category", targetId: "cat.troops",
    });
    expect(c.modifiers).toBeUndefined();
  });

  it("IrCost accepts an optional modifiers array", () => {
    const cost = IrCost.parse({
      name: "points", value: 100,
      modifiers: [{ id: "m", type: "decrement", value: 10 }],
    });
    expect(cost.modifiers?.[0]?.value).toBe(10);
  });
});
