import { describe, it, expect } from "vitest";
import { IrValidationRule, IrEntry } from "@muster/domain";

describe("IrValidationRule", () => {
  it("parses a message with a gating condition", () => {
    const parsed = IrValidationRule.parse({
      message: "Max 1 {this} per 5 models",
      conditions: [{
        id: "cond.lessThan.e.x", comparator: "lessThan", value: 10,
        field: "selections", scope: "unit", targetType: "entry",
        targetId: "e.x", includeChildSelections: false,
      }],
    });
    expect(parsed.message).toBe("Max 1 {this} per 5 models");
    expect(parsed.conditions?.[0]?.comparator).toBe("lessThan");
  });

  it("defaults IrEntry.validationRules to [] when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.validationRules).toEqual([]);
  });

  it("carries validationRules on an entry", () => {
    const e = IrEntry.parse({
      id: "e", name: "E",
      validationRules: [{ message: "Nope", conditions: [] }],
    });
    expect(e.validationRules?.[0]?.message).toBe("Nope");
  });
});
