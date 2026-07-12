import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrCondition } from "@muster/domain";
import { buildState, evaluateCondition } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e.troop", name: "Troop", costs: [{ name: "points", value: 10 }], categories: ["cat.troops"], constraints: [], children: [] }],
};
const roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "t1", entryId: "e.troop", count: 1, selections: [] },
    { id: "t2", entryId: "e.troop", count: 1, selections: [] },
    { id: "t3", entryId: "e.troop", count: 1, selections: [] },
  ],
};
const cond = (over: Partial<IrCondition>): IrCondition => ({
  id: "cond", comparator: "atLeast", value: 3, field: "selections", scope: "force",
  targetType: "category", targetId: "cat.troops", includeChildSelections: false, ...over,
});

describe("evaluateCondition", () => {
  it("atLeast true at the boundary", () => {
    const state = buildState(roster, cat);
    expect(evaluateCondition(cond({ comparator: "atLeast", value: 3 }), null, state)).toBe(true);
    expect(evaluateCondition(cond({ comparator: "atLeast", value: 4 }), null, state)).toBe(false);
  });

  it("covers every comparator (actual = 3 troops)", () => {
    const state = buildState(roster, cat);
    expect(evaluateCondition(cond({ comparator: "atMost", value: 3 }), null, state)).toBe(true);
    expect(evaluateCondition(cond({ comparator: "equalTo", value: 3 }), null, state)).toBe(true);
    expect(evaluateCondition(cond({ comparator: "notEqualTo", value: 3 }), null, state)).toBe(false);
    expect(evaluateCondition(cond({ comparator: "greaterThan", value: 3 }), null, state)).toBe(false);
    expect(evaluateCondition(cond({ comparator: "lessThan", value: 4 }), null, state)).toBe(true);
  });
});

import type { IrConditionGroup, IrModifier } from "@muster/domain";
import { evaluateConditionGroup, gatePasses } from "@muster/engine-eval";

describe("evaluateConditionGroup", () => {
  const state = () => buildState(roster, cat); // 3 troops
  const cTrue = cond({ comparator: "equalTo", value: 3 });   // true
  const cFalse = cond({ comparator: "equalTo", value: 99 }); // false

  it("and requires all; or requires any", () => {
    const andG: IrConditionGroup = { type: "and", conditions: [cTrue, cFalse] };
    const orG: IrConditionGroup = { type: "or", conditions: [cTrue, cFalse] };
    expect(evaluateConditionGroup(andG, null, state())).toBe(false);
    expect(evaluateConditionGroup(orG, null, state())).toBe(true);
  });

  it("empty and is true; empty or is false", () => {
    expect(evaluateConditionGroup({ type: "and" }, null, state())).toBe(true);
    expect(evaluateConditionGroup({ type: "or" }, null, state())).toBe(false);
  });

  it("nests groups", () => {
    const g: IrConditionGroup = { type: "and", conditions: [cTrue], conditionGroups: [{ type: "or", conditions: [cFalse, cTrue] }] };
    expect(evaluateConditionGroup(g, null, state())).toBe(true);
  });
});

describe("gatePasses", () => {
  const state = () => buildState(roster, cat);
  const cTrue = cond({ comparator: "equalTo", value: 3 });
  const cFalse = cond({ comparator: "equalTo", value: 99 });

  it("empty gate always passes", () => {
    const m: IrModifier = { id: "m", type: "set", value: 0 };
    expect(gatePasses(m, null, state())).toBe(true);
  });

  it("all conditions must pass", () => {
    expect(gatePasses({ id: "m", type: "set", value: 0, conditions: [cTrue] }, null, state())).toBe(true);
    expect(gatePasses({ id: "m", type: "set", value: 0, conditions: [cTrue, cFalse] }, null, state())).toBe(false);
  });

  it("conditions AND groups both required", () => {
    const m: IrModifier = { id: "m", type: "set", value: 0, conditions: [cTrue], conditionGroups: [{ type: "or", conditions: [cFalse] }] };
    expect(gatePasses(m, null, state())).toBe(false); // group is false
  });
});
