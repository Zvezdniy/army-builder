import { describe, it, expect } from "vitest";
import {
  IrCost,
  IrConstraint,
  IrCondition,
  IrModifier,
  IrCatalogue,
  Roster,
  RosterSelection,
  MAX_SELECTION_COUNT,
} from "@muster/domain";

// The Zod schemas are the trust boundary: everything the engine consumes is
// assumed to have passed through them. These tests pin the adversarial-input
// contract so a future parser (untrusted .cat/.rosz files) cannot smuggle
// values that break the engine's arithmetic or crash the host.

describe("numeric fields reject non-finite values", () => {
  const base = {
    cost: { name: "points", value: 5 },
    constraint: { id: "k", type: "max", value: 1, field: "selections", scope: "self", targetType: "category", targetId: "x" },
    condition: { id: "c", comparator: "atLeast", value: 1, field: "selections", scope: "self", targetType: "category", targetId: "x" },
    modifier: { id: "m", type: "increment", value: 1 },
  };

  const cases: Array<[string, () => unknown]> = [
    ["IrCost.value", () => IrCost.parse({ ...base.cost, value: Infinity })],
    ["IrConstraint.value", () => IrConstraint.parse({ ...base.constraint, value: -Infinity })],
    ["IrCondition.value", () => IrCondition.parse({ ...base.condition, value: Infinity })],
    ["IrModifier.value", () => IrModifier.parse({ ...base.modifier, value: -Infinity })],
  ];

  for (const [label, run] of cases) {
    it(`rejects Infinity in ${label}`, () => {
      expect(run).toThrow();
    });
  }

  it("rejects NaN (z.number() default)", () => {
    expect(() => IrCost.parse({ name: "points", value: NaN })).toThrow();
  });

  it("accepts ordinary finite values (including negative and zero)", () => {
    expect(IrCost.parse({ name: "points", value: 0 }).value).toBe(0);
    expect(IrModifier.parse({ id: "m", type: "decrement", value: -3 }).value).toBe(-3);
  });
});

describe("RosterSelection.count is a bounded positive integer", () => {
  const sel = (count: unknown) => () => RosterSelection.parse({ id: "s", entryId: "e", count });

  it("rejects zero, negatives, and fractions", () => {
    expect(sel(0)).toThrow();
    expect(sel(-1)).toThrow();
    expect(sel(1.5)).toThrow();
  });

  it("rejects NaN and Infinity", () => {
    expect(sel(NaN)).toThrow();
    expect(sel(Infinity)).toThrow();
  });

  it(`rejects counts above MAX_SELECTION_COUNT (${MAX_SELECTION_COUNT})`, () => {
    expect(sel(MAX_SELECTION_COUNT + 1)).toThrow();
  });

  it("accepts the boundary value and defaults selections to []", () => {
    const parsed = RosterSelection.parse({ id: "s", entryId: "e", count: MAX_SELECTION_COUNT });
    expect(parsed.count).toBe(MAX_SELECTION_COUNT);
    expect(parsed.selections).toEqual([]);
  });
});

describe("Roster / catalogue scalar guards", () => {
  const roster = (over: Record<string, unknown>) => () =>
    Roster.parse({
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c",
      catalogueRevision: 1, pointsLimit: 1000, selections: [], ...over,
    });

  it("rejects a non-finite pointsLimit", () => {
    expect(roster({ pointsLimit: Infinity })).toThrow();
  });

  it("rejects a non-finite catalogueRevision", () => {
    expect(roster({ catalogueRevision: NaN })).toThrow();
  });

  it("rejects a non-finite catalogue revision", () => {
    expect(() =>
      IrCatalogue.parse({ id: "c", name: "C", gameSystemId: "gs", revision: Infinity, entries: [] }),
    ).toThrow();
  });
});

describe("prototype pollution is not propagated through parsing", () => {
  it("strips a __proto__ own-property instead of copying it onto the result", () => {
    // JSON.parse produces a real own "__proto__" property (unlike an object literal,
    // which sets the prototype). Zod strips unknown keys, so it must not leak through.
    const hostile = JSON.parse('{"name":"points","value":5,"__proto__":{"polluted":true}}');
    const parsed = IrCost.parse(hostile);
    expect(parsed.value).toBe(5);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((parsed as Record<string, unknown>).polluted).toBeUndefined();
  });
});
