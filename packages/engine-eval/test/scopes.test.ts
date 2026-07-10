import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrConstraint, Roster } from "@muster/domain";
import { buildSymbolTable, buildState, aggregate } from "@muster/engine-eval";
import type { EvalNode } from "@muster/engine-eval";

// Catalogue: two HQ, three Heavy units; a squad with 2 special-weapon options.
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.hq", name: "HQ", costs: [{ name: "points", value: 80 }], categories: ["cat.hq"], constraints: [], children: [] },
    { id: "e.heavy", name: "Heavy", costs: [{ name: "points", value: 150 }], categories: ["cat.heavy"], constraints: [], children: [] },
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: ["cat.troops"], constraints: [],
      children: [{ id: "e.special", name: "Special", costs: [{ name: "points", value: 10 }], categories: ["cat.special"], constraints: [], children: [] }] },
  ],
};

const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "s.hq1", entryId: "e.hq", count: 1, selections: [] },
    { id: "s.heavy1", entryId: "e.heavy", count: 1, selections: [] },
    { id: "s.heavy2", entryId: "e.heavy", count: 1, selections: [] },
    { id: "s.heavy3", entryId: "e.heavy", count: 1, selections: [] },
    { id: "s.squad", entryId: "e.squad", count: 1,
      selections: [{ id: "s.sp", entryId: "e.special", count: 2, selections: [] }] },
  ],
};

function setup() {
  const state = buildState(roster, buildSymbolTable(cat));
  const byId = (id: string): EvalNode => state.all.find((n) => n.selectionId === id)!;
  return { state, byId };
}

const base = { id: "c1", value: 0, includeChildSelections: false } as const;

describe("aggregate", () => {
  it("force/roster scope counts selections by category across the whole roster", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "force", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(null, c, state)).toBe(3);
  });

  it("roster scope sums points by category", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "points", scope: "roster", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(null, c, state)).toBe(450); // 3 * 150
  });

  it("counts selections by entry id", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "min", field: "selections", scope: "force", targetType: "entry", targetId: "e.hq" };
    expect(aggregate(null, c, state)).toBe(1);
  });

  it("self scope without includeChildSelections sees only the node", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad");
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(aggregate(squad, c, state)).toBe(0); // special is a child, excluded
  });

  it("self scope with includeChildSelections sees descendants (effectiveCount)", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(aggregate(squad, c, state)).toBe(2); // 2 special weapons
  });

  it("parent scope counts within the parent subtree", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "selections", scope: "parent", targetType: "category", targetId: "cat.special" };
    expect(aggregate(special, c, state)).toBe(2);
  });

  it("throws if self/parent scope is given a null node", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(() => aggregate(null, c, state)).toThrow(/requires an owning node/i);
  });
});
