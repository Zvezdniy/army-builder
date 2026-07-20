import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrConstraint, Roster } from "@muster/domain";
import { buildState, checkConstraint, correctedConstraintValue, effectiveConstraintValue } from "@muster/engine-eval";

const dpConstraint = (over: Partial<IrConstraint> = {}): IrConstraint => ({
  id: "fc.dp", type: "max", value: 2, field: "Detachment Points", scope: "force",
  targetType: "force", targetId: "force.root", includeChildSelections: false, ...over,
});

describe("correctedConstraintValue", () => {
  it("floors a Detachment Points cap of 2 to 3", () => {
    expect(correctedConstraintValue(dpConstraint({ value: 2 }))).toBe(3);
  });

  it("leaves a Detachment Points cap already at/above 3 unchanged (never lowers)", () => {
    expect(correctedConstraintValue(dpConstraint({ value: 4 }))).toBe(4);
  });

  it("leaves other force constraints untouched (e.g. Enhancements)", () => {
    const enh = dpConstraint({ id: "fc.enh", field: "Enhancements", value: 2 });
    expect(correctedConstraintValue(enh)).toBe(2);
  });

  it("leaves a non-force-target Detachment Points constraint untouched (the cap is force-wide only)", () => {
    const notForce = dpConstraint({ targetType: "category", targetId: "cat.x", value: 2 });
    expect(correctedConstraintValue(notForce)).toBe(2);
  });

  it("leaves a min-type Detachment Points constraint untouched (the correction only ever raises a cap)", () => {
    const min = dpConstraint({ type: "min", value: 2 });
    expect(correctedConstraintValue(min)).toBe(2);
  });
});

describe("effectiveConstraintValue applies the Detachment Points correction (the single read point)", () => {
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [], categoryNames: {},
  };

  it("reads the corrected value (2 -> 3) with no node/state dependency beyond the constraint itself", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [],
    };
    const state = buildState(roster, cat);
    expect(effectiveConstraintValue(dpConstraint({ value: 2 }), null, state)).toBe(3);
  });
});

describe("end-to-end: the corrected Detachment Points cap through checkConstraint", () => {
  // Three entries shaped after the real 11e Space Marines detachments (Gladius 3,
  // Anvil Siege 2, Unforgiven 1 DP), capped at the upstream-published 2 but
  // corrected to 3.
  const gladius = { id: "e.gladius", name: "Gladius", costs: [{ name: "Detachment Points", value: 3 }, { name: "pts", value: 0 }], categories: [], constraints: [], children: [] };
  const anvil = { id: "e.anvil", name: "Anvil", costs: [{ name: "Detachment Points", value: 2 }, { name: "pts", value: 0 }], categories: [], constraints: [], children: [] };
  const unforgiven = { id: "e.unforgiven", name: "Unforgiven", costs: [{ name: "Detachment Points", value: 1 }, { name: "pts", value: 0 }], categories: [], constraints: [], children: [] };
  const multiCat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [gladius, anvil, unforgiven], categoryNames: {},
  };
  const dpCap = dpConstraint({ value: 2 }); // upstream-published (wrong) cap

  it("3 DP (Gladius) alone is legal against the corrected cap of 3", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "g", entryId: "e.gladius", count: 1, selections: [] }],
    };
    const state = buildState(roster, multiCat);
    expect(checkConstraint(dpCap, null, state)).toBeNull();
  });

  it("3 DP + 2 DP (5 total) is illegal at the corrected cap", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "g", entryId: "e.gladius", count: 1, selections: [] },
        { id: "a", entryId: "e.anvil", count: 1, selections: [] },
      ],
    };
    const state = buildState(roster, multiCat);
    const issue = checkConstraint(dpCap, null, state);
    expect(issue?.code).toBe("constraint.max");
    expect(issue?.message).toBe("Too many Detachment Points: 5 exceeds max 3");
  });

  it("2 DP + 1 DP (3 total) is legal at the corrected cap", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "a", entryId: "e.anvil", count: 1, selections: [] },
        { id: "u", entryId: "e.unforgiven", count: 1, selections: [] },
      ],
    };
    const state = buildState(roster, multiCat);
    expect(checkConstraint(dpCap, null, state)).toBeNull();
  });

});
