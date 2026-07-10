import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrConstraint, Roster } from "@muster/domain";
import { buildSymbolTable, buildState, checkConstraint } from "@muster/engine-eval";

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
    const state = buildState(roster, buildSymbolTable(cat));
    const issue = checkConstraint(c({}), null, state);
    expect(issue?.severity).toBe("error");
    expect(issue?.code).toBe("constraint.max");
    expect(issue?.constraintId).toBe("c1");
    expect(issue?.message).toMatch(/4 .*max 3/);
  });

  it("returns null when satisfied", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    expect(checkConstraint(c({ value: 4 }), null, state)).toBeNull();
  });

  it("flags a min violation", () => {
    const state = buildState(roster, buildSymbolTable(cat));
    const issue = checkConstraint(c({ type: "min", value: 6 }), null, state);
    expect(issue?.code).toBe("constraint.min");
  });
});
