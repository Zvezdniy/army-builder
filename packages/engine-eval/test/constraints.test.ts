import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrConstraint, Roster } from "@muster/domain";
import { buildState, checkConstraint, describeConstraint, effectiveConstraintValue, targetNamer } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e.heavy", name: "Heavy", costs: [], categories: ["cat.heavy"], constraints: [], children: [] }],
};
const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "h1", entryId: "e.heavy", count: 1, selections: [] },
    { id: "h2", entryId: "e.heavy", count: 1, selections: [] },
    { id: "h3", entryId: "e.heavy", count: 1, selections: [] },
    { id: "h4", entryId: "e.heavy", count: 1, selections: [] },
  ],
};
const c = (over: Partial<IrConstraint>): IrConstraint => ({
  id: "c1", type: "max", value: 3, field: "selections", scope: "force",
  targetType: "category", targetId: "cat.heavy", includeChildSelections: false, ...over,
});

describe("checkConstraint", () => {
  it("returns an error Issue when a max is exceeded", () => {
    const state = buildState(roster, cat);
    const issue = checkConstraint(c({}), null, state);
    expect(issue?.severity).toBe("error");
    expect(issue?.code).toBe("constraint.max");
    expect(issue?.constraintId).toBe("c1");
    expect(issue?.message).toMatch(/4 .*max 3/);
  });

  it("returns null when satisfied", () => {
    const state = buildState(roster, cat);
    expect(checkConstraint(c({ value: 4 }), null, state)).toBeNull();
  });

  it("flags a min violation", () => {
    const state = buildState(roster, cat);
    const issue = checkConstraint(c({ type: "min", value: 6 }), null, state);
    expect(issue?.code).toBe("constraint.min");
  });

  it("uses the resolved category name in the message when a namer is supplied", () => {
    const named: IrCatalogue = { ...cat, categoryNames: { "cat.heavy": "Heavy Support" } };
    const state = buildState(roster, named);
    const issue = checkConstraint(c({}), null, state, undefined, targetNamer(named));
    expect(issue?.message).toContain('category "Heavy Support"');
    expect(issue?.message).not.toContain("cat.heavy");
  });

  it("uses the resolved entry name for an entry-typed target", () => {
    const named: IrCatalogue = { ...cat, categoryNames: {} };
    const state = buildState(roster, named);
    const issue = checkConstraint(
      c({ targetType: "entry", targetId: "e.heavy", type: "min", value: 9 }),
      null, state, undefined, targetNamer(named),
    );
    expect(issue?.message).toContain('entry "Heavy"');
    expect(issue?.message).not.toContain("e.heavy");
  });
});

describe("describeConstraint", () => {
  it("reports a satisfied max (actual <= limit)", () => {
    const state = buildState(roster, cat);
    expect(describeConstraint(c({ value: 4 }), null, state)).toEqual({ actual: 4, limit: 4, satisfied: true });
  });

  it("reports a violated max (actual > limit)", () => {
    const state = buildState(roster, cat);
    expect(describeConstraint(c({}), null, state)).toEqual({ actual: 4, limit: 3, satisfied: false });
  });

  it("reports a satisfied min (actual >= limit)", () => {
    const state = buildState(roster, cat);
    expect(describeConstraint(c({ type: "min", value: 4 }), null, state)).toEqual({ actual: 4, limit: 4, satisfied: true });
  });

  it("reports a violated min (actual < limit)", () => {
    const state = buildState(roster, cat);
    expect(describeConstraint(c({ type: "min", value: 6 }), null, state)?.satisfied).toBe(false);
  });

  it("returns null for a force-level node-relative scope", () => {
    const state = buildState(roster, cat);
    expect(describeConstraint(c({ scope: "unit" }), null, state)).toBeNull();
  });

  it("describes a roster-scope rule at force level (node null)", () => {
    const state = buildState(roster, cat);
    const d = describeConstraint(c({ scope: "roster", type: "min", value: 1, targetId: "cat.absent" }), null, state);
    expect(d).toEqual({ actual: 0, limit: 1, satisfied: false });
  });

  it("describes a node-anchored (self-scope) rule when a node is supplied", () => {
    const state = buildState(roster, cat);
    const node = state.all.find((n) => n.selectionId === "h1")!;
    const d = describeConstraint(c({ scope: "self", type: "min", value: 1 }), node, state);
    expect(d).not.toBeNull();
    expect(d?.satisfied).toBe(true);
  });

  it("returns null when a supplied node cannot anchor the scope (unanchored)", () => {
    const state = buildState(roster, cat);
    const node = state.all.find((n) => n.selectionId === "h1")!; // e.heavy has no unit ancestor
    expect(describeConstraint(c({ scope: "unit", type: "min", value: 1 }), node, state)).toBeNull();
  });
});

describe("checkConstraint with a modified bound", () => {
  // Heavy max is 1, but +1 when there are at least 2 heavies present (unlocks a second slot).
  const catMod: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [{ id: "e.heavy", name: "Heavy", costs: [], categories: ["cat.heavy"], constraints: [], children: [] }],
    forceConstraints: [{
      id: "fc.heavy", type: "max", value: 1, field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy",
      includeChildSelections: false,
      modifiers: [{ id: "unlock", type: "increment", value: 1, conditions: [
        { id: "c", comparator: "atLeast", value: 2, field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy", includeChildSelections: false },
      ] }],
    }],
  };
  const rosterN = (n: number) => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: Array.from({ length: n }, (_, i) => ({ id: `h${i}`, entryId: "e.heavy", count: 1, selections: [] })),
  });

  it("effectiveConstraintValue reflects an applicable increment", () => {
    const state = buildState(rosterN(2), catMod);
    const c = catMod.forceConstraints[0]!;
    expect(effectiveConstraintValue(c, null, state)).toBe(2); // base 1 + 1 (>=2 heavies)
  });

  it("2 heavies is legal because the bound became 2", () => {
    const state = buildState(rosterN(2), catMod);
    const c = catMod.forceConstraints[0]!;
    expect(checkConstraint(c, null, state)).toBeNull();
  });

  it("3 heavies still violates the raised bound of 2", () => {
    const state = buildState(rosterN(3), catMod);
    const c = catMod.forceConstraints[0]!;
    const issue = checkConstraint(c, null, state);
    expect(issue?.code).toBe("constraint.max");
    expect(issue?.message).toMatch(/3 .*max 2/);
  });
});

describe("checkConstraint context/type scopes", () => {
  const uCat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.sqd", name: "Squad", type: "unit", costs: [], categories: [], constraints: [], children: [] },
      { id: "e.wpn", name: "Weapon", costs: [], categories: ["cat.wpn"], constraints: [], children: [] },
    ],
  } as unknown as IrCatalogue;
  const uRoster: Roster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [
      { id: "sq", entryId: "e.sqd", count: 1, selections: [
        { id: "w1", entryId: "e.wpn", count: 1, selections: [] },
        { id: "w2", entryId: "e.wpn", count: 1, selections: [] },
      ] },
      { id: "loose", entryId: "e.wpn", count: 1, selections: [] },
    ],
  } as unknown as Roster;
  const unitMax1: IrConstraint = { id: "k", type: "max", value: 1, field: "selections", scope: "unit", targetType: "category", targetId: "cat.wpn", includeChildSelections: true };

  it("enforces a unit-scoped max within the enclosing unit", () => {
    const state = buildState(uRoster, uCat);
    const sq = state.all.find((n) => n.selectionId === "sq")!;
    expect(checkConstraint(unitMax1, sq, state)?.code).toBe("constraint.max");
  });

  it("skips a unit-scoped constraint on a node with no unit ancestor (no false violation)", () => {
    const state = buildState(uRoster, uCat);
    const loose = state.all.find((n) => n.selectionId === "loose")!;
    const unitMin1: IrConstraint = { ...unitMax1, type: "min", value: 1 };
    expect(checkConstraint(unitMin1, loose, state)).toBeNull();
  });

  it("still flags a min on a legitimate but unsatisfied non-type scope (roster)", () => {
    const state = buildState(uRoster, uCat);
    const rosterMin: IrConstraint = { id: "k2", type: "min", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.absent", includeChildSelections: false };
    expect(checkConstraint(rosterMin, null, state)?.code).toBe("constraint.min");
  });

  it("skips a node-relative scope at force level (node null) instead of throwing", () => {
    // A force-level constraint (node === null) carrying a scope that needs an owning
    // node would make scopeNodes throw and abort evaluate(). Each such scope must be
    // skipped (return null), never crash.
    const state = buildState(uRoster, uCat);
    for (const scope of ["self", "parent", "root-entry", "ancestor", "unit", "model", "upgrade", "model-or-unit"] as const) {
      const fc: IrConstraint = { id: `fc.${scope}`, type: "max", value: 1, field: "selections", scope, targetType: "category", targetId: "cat.wpn", includeChildSelections: false };
      expect(() => checkConstraint(fc, null, state)).not.toThrow();
      expect(checkConstraint(fc, null, state)).toBeNull();
    }
  });

  it("does not throw when a force constraint's modifier gate uses a node-relative condition scope", () => {
    // The constraint scope is force (node-independent, passes the guard), but its
    // modifier's condition gate is node-relative. At force level (node null) that
    // condition's aggregate must resolve to 0, not throw and abort evaluate().
    const state = buildState(uRoster, uCat);
    const fc: IrConstraint = {
      id: "fc.mod", type: "max", value: 5, field: "selections", scope: "roster",
      targetType: "category", targetId: "cat.wpn", includeChildSelections: false,
      modifiers: [{
        id: "m", type: "increment", field: "fc.mod", value: 1,
        conditions: [{ id: "cond", comparator: "atLeast", value: 1, field: "selections", scope: "self", targetType: "category", targetId: "cat.wpn", includeChildSelections: false }],
      }],
    } as unknown as IrConstraint;
    expect(() => checkConstraint(fc, null, state)).not.toThrow();
  });
});
