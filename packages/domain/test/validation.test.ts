import { describe, it, expect } from "vitest";
import { Issue, ValidationResult } from "@muster/domain";

describe("validation schemas", () => {
  it("accepts a well-formed Issue", () => {
    const parsed = Issue.parse({
      severity: "error",
      code: "points.over",
      message: "Over points limit",
    });
    expect(parsed.severity).toBe("error");
  });

  it("rejects an unknown severity", () => {
    expect(() => Issue.parse({ severity: "info", code: "x", message: "y" })).toThrow();
  });

  it("accepts a well-formed ValidationResult", () => {
    const result = ValidationResult.parse({
      valid: true,
      totalPoints: 0,
      pointsLimit: 2000,
      issues: [],
    });
    expect(result.valid).toBe(true);
  });

  it("ValidationResult defaults dismissed and hasHouseRules", () => {
    const r = ValidationResult.parse({ valid: true, totalPoints: 0, pointsLimit: 2000, issues: [] });
    expect(r.dismissed).toEqual([]);
    expect(r.hasHouseRules).toBe(false);
  });
});
