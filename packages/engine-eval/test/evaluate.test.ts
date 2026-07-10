import { describe, it, expect } from "vitest";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, legalRoster, rosterWith, sel } from "./fixtures/mini40k";

describe("evaluate", () => {
  it("passes a legal roster", () => {
    const result = evaluate(legalRoster, mini40kCatalogue);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.totalPoints).toBe(430);
  });

  it("flags going over the points cap", () => {
    const result = evaluate(rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy")], 200), mini40kCatalogue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "points.over")).toBe(true);
  });

  it("flags too many Heavy Support (force max)", () => {
    const result = evaluate(
      rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy"), sel("e.heavy"), sel("e.heavy")]),
      mini40kCatalogue,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.heavy.max")).toBe(true);
  });

  it("flags a missing HQ (force min)", () => {
    const result = evaluate(rosterWith([sel("e.troops")]), mini40kCatalogue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.min")).toBe(true);
  });

  it("is deterministic / idempotent", () => {
    const a = evaluate(legalRoster, mini40kCatalogue);
    const b = evaluate(legalRoster, mini40kCatalogue);
    expect(a).toEqual(b);
  });
});
