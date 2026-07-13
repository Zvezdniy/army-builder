import { describe, it, expect } from "vitest";
import { Issue, LegalityCheck, ValidationResult } from "@muster/domain";

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

  it("parses a points LegalityCheck", () => {
    const c = LegalityCheck.parse({
      id: "points", kind: "points", label: "Points", actual: 90, limit: 2000, satisfied: true,
    });
    expect(c.satisfied).toBe(true);
    expect(c.constraintType).toBeUndefined();
  });

  it("parses a force LegalityCheck with constraintType", () => {
    const c = LegalityCheck.parse({
      id: "f1", kind: "force", label: 'At least 1 category "Battleline"',
      actual: 0, limit: 1, satisfied: false, constraintType: "min",
    });
    expect(c.constraintType).toBe("min");
  });

  it("ValidationResult defaults checks to [] when omitted", () => {
    const r = ValidationResult.parse({ valid: true, totalPoints: 0, pointsLimit: 2000, issues: [] });
    expect(r.checks).toEqual([]);
  });

  it("ValidationResult keeps supplied checks", () => {
    const r = ValidationResult.parse({
      valid: true, totalPoints: 0, pointsLimit: 2000, issues: [],
      checks: [{ id: "points", kind: "points", label: "Points", actual: 0, limit: 2000, satisfied: true }],
    });
    expect(r.checks).toHaveLength(1);
  });
});
