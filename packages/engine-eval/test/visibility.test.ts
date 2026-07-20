import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { hiddenEntryIds, hiddenSelectionIds } from "@muster/engine-eval";

// Detachment category cat.det; an enhancement hidden unless the roster holds a
// detachment selection of that category (set hidden=true when 0 instances → notInstanceOf).
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      { id: "e.det", name: "Detachment", costs: [], categories: ["cat.det"], constraints: [], children: [] },
      {
        id: "e.enh", name: "Enhancement", costs: [], categories: [], constraints: [], children: [],
        visibilityModifiers: [{
          set: true,
          conditions: [{ id: "c1", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det", includeChildSelections: false }],
        }],
      },
      { id: "e.plain", name: "Plain", costs: [], categories: [], constraints: [], children: [] },
      { id: "e.static", name: "Static", costs: [], categories: [], constraints: [], children: [], hidden: true },
    ],
  };
}
const roster = (members: string[]): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: members.map((m, i) => ({ id: `s${i}`, entryId: m, count: 1, selections: [] })),
});

describe("hiddenEntryIds", () => {
  it("hides the enhancement when no matching detachment is in the roster", () => {
    const hidden = hiddenEntryIds(roster([]), cat());
    expect(hidden.has("e.enh")).toBe(true);
  });
  it("reveals the enhancement when the detachment is present", () => {
    const hidden = hiddenEntryIds(roster(["e.det"]), cat());
    expect(hidden.has("e.enh")).toBe(false);
  });
  it("always hides a statically hidden entry", () => {
    expect(hiddenEntryIds(roster([]), cat()).has("e.static")).toBe(true);
  });
  it("never hides an entry with no visibility rules", () => {
    expect(hiddenEntryIds(roster(["e.det"]), cat()).has("e.plain")).toBe(false);
  });
});

// Owner unit e.owner (category cat.owner) contains option e.opt whose gate hides
// it unless its parent (the owner) is instanceOf cat.other.
function ctxCat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      {
        id: "e.owner", name: "Owner", costs: [], categories: ["cat.owner"], constraints: [],
        children: [
          {
            id: "e.opt", name: "Opt", costs: [], categories: [], constraints: [], children: [],
            // hide the option unless parent is instanceOf cat.other (it isn't) -> hidden in owner ctx
            visibilityModifiers: [{
              set: true,
              conditions: [
                { id: "c1", comparator: "lessThan", value: 1, field: "selections", scope: "parent", targetType: "category", targetId: "cat.other", includeChildSelections: false },
              ],
            }],
          },
        ],
      },
    ],
  };
}
const rosterWithOwner = (): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [{ id: "own", entryId: "e.owner", count: 1, selections: [] }],
});

describe("hiddenEntryIds context scopes", () => {
  it("evaluates a parent-scoped gate against the owner node (hides in owner context)", () => {
    const hidden = hiddenEntryIds(rosterWithOwner(), ctxCat(), "own");
    expect(hidden.has("e.opt")).toBe(true); // parent (owner) is not cat.other -> lessThan 1 true -> hide
  });

  it("skips a context-scoped gate when no owner is given (stays visible)", () => {
    const hidden = hiddenEntryIds(rosterWithOwner(), ctxCat()); // no owner
    expect(hidden.has("e.opt")).toBe(false); // parent scope unresolvable -> modifier skipped
  });

  it("ignores an unknown ownerSelectionId (treated as no owner; context gate skipped)", () => {
    const hidden = hiddenEntryIds(rosterWithOwner(), ctxCat(), "does-not-exist");
    expect(hidden.has("e.opt")).toBe(false);
  });

  it("skips a conditionGroup gate that uses a context scope when no owner is given", () => {
    const catWithGroup: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        {
          id: "e.owner2", name: "Owner2", costs: [], categories: ["cat.owner2"], constraints: [],
          children: [
            {
              id: "e.opt2", name: "Opt2", costs: [], categories: [], constraints: [], children: [],
              visibilityModifiers: [{
                set: true,
                conditionGroups: [{
                  type: "and",
                  conditions: [
                    { id: "g1", comparator: "lessThan", value: 1, field: "selections", scope: "parent", targetType: "category", targetId: "cat.other", includeChildSelections: false },
                  ],
                }],
              }],
            },
          ],
        },
      ],
    };
    const rosterOwner2: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "own2", entryId: "e.owner2", count: 1, selections: [] }],
    };
    // Without an owner, the group's context-scoped condition means the whole modifier is skipped.
    const hiddenNoOwner = hiddenEntryIds(rosterOwner2, catWithGroup);
    expect(hiddenNoOwner.has("e.opt2")).toBe(false);
    // With the real owner, the group is evaluated against the ancestor chain and hides it.
    const hiddenWithOwner = hiddenEntryIds(rosterOwner2, catWithGroup, "own2");
    expect(hiddenWithOwner.has("e.opt2")).toBe(true);
  });

  it("skips a gate whose context scope is only reachable via a nested conditionGroup", () => {
    // The outer group's own `conditions` are non-context (roster-scoped), so
    // `groupUsesContext` must recurse into `conditionGroups` to find the parent-scoped
    // condition nested one level deeper.
    const catWithNestedGroup: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        {
          id: "e.owner3", name: "Owner3", costs: [], categories: ["cat.owner3"], constraints: [],
          children: [
            {
              id: "e.opt3", name: "Opt3", costs: [], categories: [], constraints: [], children: [],
              visibilityModifiers: [{
                set: true,
                conditionGroups: [{
                  type: "and",
                  conditions: [
                    { id: "g1", comparator: "lessThan", value: 100, field: "selections", scope: "roster", targetType: "category", targetId: "cat.nowhere", includeChildSelections: false },
                  ],
                  conditionGroups: [{
                    type: "and",
                    conditions: [
                      { id: "g2", comparator: "lessThan", value: 1, field: "selections", scope: "parent", targetType: "category", targetId: "cat.other", includeChildSelections: false },
                    ],
                  }],
                }],
              }],
            },
          ],
        },
      ],
    };
    const rosterOwner3: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "own3", entryId: "e.owner3", count: 1, selections: [] }],
    };
    const hiddenNoOwner = hiddenEntryIds(rosterOwner3, catWithNestedGroup);
    expect(hiddenNoOwner.has("e.opt3")).toBe(false); // no owner -> nested context condition -> whole modifier skipped
    const hiddenWithOwner = hiddenEntryIds(rosterOwner3, catWithNestedGroup, "own3");
    expect(hiddenWithOwner.has("e.opt3")).toBe(true); // with owner, both nested conditions pass -> hidden
  });

  it("treats a conditionGroup with neither conditions nor nested groups as context-free", () => {
    // Empty group: `conditions` and `conditionGroups` are both omitted, exercising the
    // `?? []` fallback on each side of groupUsesContext. usesContextScope must report
    // false for it, so the gate is evaluated normally even with no owner (an empty "and"
    // group is vacuously true, so the modifier applies unconditionally).
    const catEmptyGroup: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        {
          id: "e.opt4", name: "Opt4", costs: [], categories: [], constraints: [], children: [],
          visibilityModifiers: [{ set: true, conditionGroups: [{ type: "and" }] }],
        },
      ],
    };
    const hidden = hiddenEntryIds(roster([]), catEmptyGroup); // no owner
    expect(hidden.has("e.opt4")).toBe(true); // context-free gate is not skipped; empty "and" group is vacuously true
  });

  it("skips a type-scoped (upgrade) gate when no owner is given (stays visible)", () => {
    const catTypeScope: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        {
          id: "opt", name: "Opt", costs: [], categories: [], constraints: [], children: [],
          visibilityModifiers: [{
            set: true,
            conditions: [
              { id: "c", comparator: "lessThan", value: 1, field: "selections", scope: "upgrade", targetType: "category", targetId: "cat.x", includeChildSelections: false },
            ],
          }],
        },
      ],
    };
    const emptyRoster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [],
    };
    const hidden = hiddenEntryIds(emptyRoster, catTypeScope);
    expect(hidden.has("opt")).toBe(false);
  });

  it("skips a type-scoped gate nested inside a conditionGroup when no owner is given", () => {
    // The type scope lives inside a nested conditionGroup, so usesContextScope must
    // recurse through conditionGroups (not just top-level conditions) for the skip to fire.
    const catNestedTypeScope: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        {
          id: "opt", name: "Opt", costs: [], categories: [], constraints: [], children: [],
          visibilityModifiers: [{
            set: true,
            conditionGroups: [{
              type: "and",
              conditions: [
                { id: "c", comparator: "lessThan", value: 1, field: "selections", scope: "model", targetType: "category", targetId: "cat.x", includeChildSelections: false },
              ],
            }],
          }],
        },
      ],
    };
    const emptyRoster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [],
    };
    const hidden = hiddenEntryIds(emptyRoster, catNestedTypeScope);
    expect(hidden.has("opt")).toBe(false); // nested type scope, no owner -> whole modifier skipped -> visible
  });
});

// A foreign-id scoped hidden gate (scope = an ancestor unit's entry id) is ancestor-
// relative like parent/ancestor, so the ownerless path must skip it too (never over-hide).
describe("hiddenEntryIds with a foreign-id scoped gate", () => {
  const fcat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [{
      id: "e.owner", name: "Owner", costs: [], categories: [], constraints: [],
      children: [{
        id: "e.opt", name: "Opt", costs: [], categories: [], constraints: [], children: [],
        // hide unless the ancestor unit "e.owner" holds >=1 of cat.x (it doesn't) — foreign-id lessThan 1.
        visibilityModifiers: [{
          set: true,
          conditions: [{ id: "c", comparator: "lessThan", value: 1, field: "selections", scope: "e.owner", targetType: "category", targetId: "cat.x", includeChildSelections: true }],
        }],
      }],
    }],
  };
  const fRoster: Roster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{ id: "own", entryId: "e.owner", count: 1, selections: [] }],
  };
  it("skips a foreign-id scoped gate when no owner is given (never over-hides ownerless)", () => {
    expect(hiddenEntryIds(fRoster, fcat).has("e.opt")).toBe(false);
  });
  it("resolves the foreign-id scope against the ancestor chain with an owner", () => {
    expect(hiddenEntryIds(fRoster, fcat, "own").has("e.opt")).toBe(true); // owner lacks cat.x -> lessThan 1 -> hide
  });
});

describe("hiddenSelectionIds", () => {
  it("flags a selected node hidden under current roster state", () => {
    const ids = hiddenSelectionIds(roster(["e.enh"]), cat());
    expect(ids.has("s0")).toBe(true); // s0 is e.enh's selection id
  });
  it("does not flag the node once its gate no longer fires", () => {
    const ids = hiddenSelectionIds(roster(["e.det", "e.enh"]), cat());
    expect(ids.has("s1")).toBe(false); // s1 is e.enh's selection id here
  });
  it("does NOT flag a statically hidden selected node (structural, not 'unavailable')", () => {
    // e.static is definitionally hidden:true — a permanent/structural part, not
    // something that became unavailable. It must not raise the "unavailable" signal.
    const ids = hiddenSelectionIds(roster(["e.static"]), cat());
    expect(ids.has("s0")).toBe(false);
  });
  it("returns an empty set when nothing is hidden", () => {
    const ids = hiddenSelectionIds(roster(["e.plain"]), cat());
    expect(ids.size).toBe(0);
  });
});

// The real-catalogue enhancement gate shape: a group hidden gate pushed onto the
// member, `and(forces <CrusadeForce> < 1, selections <detachment> < 1)`. Because our
// forceless roster counts `forces` as 0, the Crusade term is always true and the gate
// reduces to "hidden unless the detachment is in the roster".
function forcesGateCat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      { id: "e.det", name: "Detachment", costs: [], categories: [], constraints: [], children: [] },
      {
        id: "e.enh", name: "Enhancement", costs: [], categories: [], constraints: [], children: [],
        visibilityModifiers: [{
          set: true,
          conditionGroups: [{
            type: "and",
            conditions: [
              { id: "f", comparator: "lessThan", value: 1, field: "forces", scope: "roster", targetType: "entry", targetId: "force.crusade", includeChildSelections: false },
              { id: "d", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "entry", targetId: "e.det", includeChildSelections: false },
            ],
          }],
        }],
      },
    ],
  };
}

describe("visibility with a forces-bundled detachment gate (real shape)", () => {
  it("hides the enhancement when the detachment is absent (forces term is vacuously true)", () => {
    expect(hiddenEntryIds(roster([]), forcesGateCat()).has("e.enh")).toBe(true);
  });
  it("reveals the enhancement once the detachment is in the roster", () => {
    expect(hiddenEntryIds(roster(["e.det"]), forcesGateCat()).has("e.enh")).toBe(false);
  });
});

describe("visibility with conditional categories", () => {
  // A unit that conditionally GAINS a category when a detachment is present.
  // An option (child of unit) whose visibility gate checks for that category on parent.
  // This tests that resolveCategories is called before gate evaluation.
  function catWithConditionalCategory(): IrCatalogue {
    return {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        { id: "e.det", name: "Detachment", costs: [], categories: ["cat.det"], constraints: [], children: [] },
        {
          id: "e.unit", name: "Unit", costs: [], categories: ["cat.unit"], constraints: [],
          children: [
            {
              id: "e.opt", name: "Option", costs: [], categories: [], constraints: [], children: [],
              // Hidden unless parent (e.unit) is instanceOf cat.conditional
              visibilityModifiers: [{
                set: true,
                conditions: [{
                  id: "c2", comparator: "lessThan", value: 1, field: "selections", scope: "parent",
                  targetType: "category", targetId: "cat.conditional", includeChildSelections: false,
                }],
              }],
            },
          ],
          // Conditionally adds cat.conditional when detachment is present
          categoryModifiers: [{
            type: "add",
            categoryId: "cat.conditional",
            conditions: [{
              id: "c1", comparator: "atLeast", value: 1, field: "selections", scope: "roster",
              targetType: "category", targetId: "cat.det", includeChildSelections: false,
            }],
          }],
        },
      ],
    };
  }

  it("hiddenEntryIds respects conditionally-added categories: hidden when no detachment", () => {
    // Without detachment, e.unit does NOT have cat.conditional, so e.opt's gate fires (hidden)
    // Pass ownerSelectionId to provide context for the parent-scoped gate.
    const cat = catWithConditionalCategory();
    // s0 is e.unit (no detachment, so cat.conditional not added)
    const hidden = hiddenEntryIds(roster(["e.unit"]), cat, "s0");
    expect(hidden.has("e.opt")).toBe(true);
  });

  it("hiddenEntryIds respects conditionally-added categories: visible when detachment present", () => {
    // With detachment, e.unit GAINS cat.conditional, so e.opt's gate does NOT fire (visible)
    const cat = catWithConditionalCategory();
    // s0 is e.det, s1 is e.unit (with detachment, cat.conditional is added)
    const hidden = hiddenEntryIds(roster(["e.det", "e.unit"]), cat, "s1");
    expect(hidden.has("e.opt")).toBe(false);
  });

  it("hiddenSelectionIds respects conditionally-added categories: flags when no detachment", () => {
    // Without detachment, e.unit does not have cat.conditional, so e.opt is hidden by state
    const cat = catWithConditionalCategory();
    const rosterNodet: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "s0", entryId: "e.unit", count: 1, selections: [{ id: "s1", entryId: "e.opt", count: 1, selections: [] }] }],
    };
    const ids = hiddenSelectionIds(rosterNodet, cat);
    // s0 is e.unit, s1 is its child e.opt; e.opt's gate fires and is hidden
    expect(ids.has("s1")).toBe(true);
  });

  it("hiddenSelectionIds respects conditionally-added categories: not flagged when detachment present", () => {
    // With detachment, e.unit gains cat.conditional, so e.opt is no longer hidden
    const cat = catWithConditionalCategory();
    const rosterWithdet: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "s0", entryId: "e.det", count: 1, selections: [] },
        { id: "s1", entryId: "e.unit", count: 1, selections: [{ id: "s2", entryId: "e.opt", count: 1, selections: [] }] },
      ],
    };
    const ids = hiddenSelectionIds(rosterWithdet, cat);
    // s0 is e.det, s1 is e.unit, s2 is its child e.opt; with detachment, e.opt's gate does not fire
    expect(ids.has("s2")).toBe(false);
  });
});
