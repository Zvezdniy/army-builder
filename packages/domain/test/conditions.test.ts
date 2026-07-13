import { describe, it, expect } from "vitest";
import { IrCondition, IrConditionGroup } from "@muster/domain";

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

  it("accepts field=\"forces\" (force/detachment counting)", () => {
    const c = IrCondition.parse({
      id: "c", comparator: "lessThan", value: 1, field: "forces",
      scope: "roster", targetType: "entry", targetId: "force.crusade",
    });
    expect(c.field).toBe("forces");
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

describe("IrConditionGroup", () => {
  it("parses a nested and/or group; list fields are optional", () => {
    const g = IrConditionGroup.parse({
      type: "or",
      conditions: [
        { id: "a", comparator: "atLeast", value: 1, field: "selections", scope: "force", targetType: "category", targetId: "cat.hq" },
      ],
      conditionGroups: [
        { type: "and" }, // no lists provided — allowed
      ],
    });
    expect(g.type).toBe("or");
    expect(g.conditionGroups?.[0]?.type).toBe("and");
  });

  it("allows a bare group with no lists", () => {
    const g = IrConditionGroup.parse({ type: "and" });
    expect(g.conditions).toBeUndefined();
  });

  it("accepts root-entry and ancestor scopes", () => {
    for (const scope of ["root-entry", "ancestor"] as const) {
      const c = IrCondition.parse({ id: "c", comparator: "atLeast", value: 1, field: "selections", scope, targetType: "category", targetId: "cat.x" });
      expect(c.scope).toBe(scope);
    }
  });

  it("accepts type-based scopes unit/upgrade/model/model-or-unit", () => {
    for (const scope of ["unit", "upgrade", "model", "model-or-unit"] as const) {
      const c = IrCondition.parse({ id: "c", comparator: "atLeast", value: 1, field: "selections", scope, targetType: "entry", targetId: "e.x" });
      expect(c.scope).toBe(scope);
    }
  });
});
