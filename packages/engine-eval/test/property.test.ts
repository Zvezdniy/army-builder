import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, rosterWith, sel } from "./fixtures/mini40k";

const entryIds = ["e.captain", "e.troops", "e.heavy"] as const;

const arbSelections = fc.array(
  fc.record({
    entry: fc.constantFrom(...entryIds),
    count: fc.integer({ min: 1, max: 10 }),
  }),
  { maxLength: 30 },
);

describe("evaluate invariants", () => {
  it("never throws and totals are non-negative and idempotent", () => {
    fc.assert(
      fc.property(arbSelections, fc.integer({ min: 0, max: 3000 }), (specs, limit) => {
        const roster = rosterWith(specs.map((s) => sel(s.entry, s.count)), limit);
        const a = evaluate(roster, mini40kCatalogue);
        const b = evaluate(roster, mini40kCatalogue);
        expect(a.totalPoints).toBeGreaterThanOrEqual(0);
        expect(a).toEqual(b);
      }),
    );
  });
});
