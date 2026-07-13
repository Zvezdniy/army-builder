import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrCondition, IrConstraint, Roster } from "@muster/domain";
import { buildState, aggregate } from "@muster/engine-eval";
import type { EvalNode, EvalState } from "@muster/engine-eval";

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
  const state = buildState(roster, cat);
  const byId = (id: string): EvalNode => state.all.find((n) => n.selectionId === id)!;
  return { state, byId };
}

const base = { id: "c1", value: 0, includeChildSelections: false } as const;

describe("aggregate", () => {
  it("returns 0 for field=\"forces\" (no explicit force nodes in our roster model)", () => {
    const { state, byId } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "forces", scope: "roster", targetType: "entry", targetId: "force.crusade" };
    expect(aggregate(byId("s.hq1"), c, state)).toBe(0);
    expect(aggregate(null, c, state)).toBe(0);
  });

  it("foreign-id scope resolves to the ancestor-or-self entry's subtree", () => {
    const { state, byId } = setup();
    // scope = the squad's own entry id → count e.special within the squad (self-ref).
    const c: IrCondition = { ...base, includeChildSelections: true, type: "atLeast", field: "selections", scope: "e.squad", targetType: "entry", targetId: "e.special" };
    expect(aggregate(byId("s.squad"), c, state)).toBe(2); // squad holds 2 specials
    // evaluated at the special node, the squad is an ancestor → same subtree resolves
    expect(aggregate(byId("s.sp"), c, state)).toBe(2);
  });

  it("an unresolvable foreign-id scope aggregates to 0 (never inflates)", () => {
    const { state, byId } = setup();
    const c: IrCondition = { ...base, type: "atLeast", field: "selections", scope: "no-such-id", targetType: "entry", targetId: "e.special" };
    expect(aggregate(byId("s.squad"), c, state)).toBe(0);
    expect(aggregate(null, c, state)).toBe(0);
  });

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

  it("resolves a self scope to 0 when given a null node (force level), never throws", () => {
    const { state } = setup();
    const c: IrConstraint = { ...base, type: "max", field: "selections", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(aggregate(null, c, state)).toBe(0);
  });

  it("self scope with points field and includeChildSelections sums descendant points", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "points", scope: "self", targetType: "category", targetId: "cat.special" };
    expect(aggregate(squad, c, state)).toBe(20); // 10pts * 2 special
  });

  it("self scope with points field and no includeChildSelections sees only the node", () => {
    const { state, byId } = setup();
    const heavy1 = byId("s.heavy1");
    const c: IrConstraint = { ...base, type: "max", field: "points", scope: "self", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(heavy1, c, state)).toBe(150);
  });

  it("parent scope with points field sums the parent subtree", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "points", scope: "parent", targetType: "category", targetId: "cat.troops" };
    expect(aggregate(special, c, state)).toBe(100); // the squad itself
  });

  // Root nodes have no parent, so scope=parent falls back to the node itself (node.parent ?? node).
  it("parent scope on a root node falls back to the node itself", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad"); // root: no parent
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "selections", scope: "parent", targetType: "category", targetId: "cat.special" };
    expect(aggregate(squad, c, state)).toBe(2);
  });

  it("parent scope without includeChildSelections sees only the parent node", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const troops: IrConstraint = { ...base, type: "max", field: "selections", scope: "parent", targetType: "category", targetId: "cat.troops" };
    expect(aggregate(special, troops, state)).toBe(1); // just the squad

    const specials: IrConstraint = { ...base, type: "max", field: "selections", scope: "parent", targetType: "category", targetId: "cat.special" };
    expect(aggregate(special, specials, state)).toBe(0); // the squad alone is not special
  });

  it("self scope resolves entry targets through descendants", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad");
    const c: IrConstraint = { ...base, includeChildSelections: true, type: "max", field: "selections", scope: "self", targetType: "entry", targetId: "e.special" };
    expect(aggregate(squad, c, state)).toBe(2);
  });

  it("root-entry scope counts from the topmost ancestor's subtree", () => {
    const { state, byId } = setup();
    const special = byId("s.sp"); // deep node: s.squad -> s.sp
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: true, comparator: "atLeast", field: "selections", scope: "root-entry", targetType: "category", targetId: "cat.special" };
    expect(aggregate(special, c, state)).toBe(2); // root (squad) subtree contains both specials
  });

  it("root-entry scope with no match at the root returns 0", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: true, comparator: "atLeast", field: "selections", scope: "root-entry", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(special, c, state)).toBe(0); // heavy units are siblings, not in the squad's root-entry subtree
  });

  it("ancestor scope counts a matching ancestor node", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: false, comparator: "atLeast", field: "selections", scope: "ancestor", targetType: "category", targetId: "cat.troops" };
    expect(aggregate(special, c, state)).toBe(1); // s.squad (the parent/ancestor) is cat.troops
  });

  it("ancestor scope with no matching ancestor returns 0", () => {
    const { state, byId } = setup();
    const special = byId("s.sp");
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: false, comparator: "atLeast", field: "selections", scope: "ancestor", targetType: "category", targetId: "cat.heavy" };
    expect(aggregate(special, c, state)).toBe(0); // no ancestor of s.sp is cat.heavy
  });

  it("ancestor scope on a root node (no ancestors) returns 0", () => {
    const { state, byId } = setup();
    const squad = byId("s.squad"); // root: no parent
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: false, comparator: "atLeast", field: "selections", scope: "ancestor", targetType: "category", targetId: "cat.troops" };
    expect(aggregate(squad, c, state)).toBe(0);
  });

  it("resolves a root-entry scope to 0 when given a null node, never throws", () => {
    const { state } = setup();
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: false, comparator: "atLeast", field: "selections", scope: "root-entry", targetType: "category", targetId: "cat.special" };
    expect(aggregate(null, c, state)).toBe(0);
  });

  it("resolves an ancestor scope to 0 when given a null node, never throws", () => {
    const { state } = setup();
    const c: IrCondition = { id: "c1", value: 0, includeChildSelections: false, comparator: "atLeast", field: "selections", scope: "ancestor", targetType: "category", targetId: "cat.special" };
    expect(aggregate(null, c, state)).toBe(0);
  });
});

function node(id: string, type: string | undefined, children: EvalNode[] = []): EvalNode {
  const n: EvalNode = {
    selectionId: `sel:${id}`,
    entry: { id, name: id, costs: [], categories: [], constraints: [], children: [], type } as any,
    count: 1, multiplier: 1, effectiveCount: 1, categories: [id], parent: null, children,
  };
  for (const c of children) c.parent = n;
  return n;
}

describe("aggregate type scopes (unit/upgrade/model/model-or-unit)", () => {
  it("unit scope aggregates the nearest unit ancestor's subtree", () => {
    const leaf = node("cat.x", "model");
    const mid = node("mid", "upgrade", [leaf]);
    const unit = node("u", "unit", [mid]);
    void unit;
    const state = { all: [unit, mid, leaf] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "unit", targetType: "entry", targetId: "cat.x", includeChildSelections: true,
    };
    expect(aggregate(leaf, spec, state)).toBe(1);
  });

  it("unit scope self-match without includeChildSelections", () => {
    const unit = node("u", "unit");
    const state = { all: [unit] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "unit", targetType: "entry", targetId: "u", includeChildSelections: false,
    };
    expect(aggregate(unit, spec, state)).toBe(1);
  });

  it("upgrade scope self-match without includeChildSelections", () => {
    const upgrade = node("up", "upgrade");
    const state = { all: [upgrade] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "upgrade", targetType: "entry", targetId: "up", includeChildSelections: false,
    };
    expect(aggregate(upgrade, spec, state)).toBe(1);
  });

  it("model-or-unit scope matches a model ancestor", () => {
    const leaf = node("leaf", "upgrade");
    const model = node("m", "model", [leaf]);
    const state = { all: [model, leaf] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "model-or-unit", targetType: "entry", targetId: "m", includeChildSelections: false,
    };
    expect(aggregate(leaf, spec, state)).toBe(1);
  });

  it("model-or-unit scope matches a unit ancestor", () => {
    const leaf = node("leaf", "upgrade");
    const unit = node("u", "unit", [leaf]);
    const state = { all: [unit, leaf] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "model-or-unit", targetType: "entry", targetId: "u", includeChildSelections: false,
    };
    expect(aggregate(leaf, spec, state)).toBe(1);
  });

  it("returns 0 when no ancestor of the required type exists", () => {
    const leaf = node("leaf", "upgrade");
    const state = { all: [leaf] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "unit", targetType: "entry", targetId: "leaf", includeChildSelections: false,
    };
    expect(aggregate(leaf, spec, state)).toBe(0);
  });

  it("returns empty array (0) when the owning node is null", () => {
    const state = { all: [] } as unknown as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 0, comparator: "atLeast", field: "selections",
      scope: "model", targetType: "entry", targetId: "x", includeChildSelections: false,
    };
    expect(aggregate(null, spec, state)).toBe(0);
  });

  it("model scope aggregates the nearest model ancestor's subtree", () => {
    // model > wargear(upgrade) > cat.x(upgrade); the plain `model` predicate must
    // resolve the model anchor and count the target in its subtree.
    const target = node("cat.x", "upgrade");
    const model = node("m", "model", [node("wargear", "upgrade", [target])]);
    const leaf = model.children[0]!.children[0]!;
    const state = { all: [model] } as EvalState;
    const spec: IrCondition = {
      id: "c1", value: 1, comparator: "atLeast", field: "selections",
      scope: "model", targetType: "entry", targetId: "cat.x", includeChildSelections: true,
    };
    expect(aggregate(leaf, spec, state)).toBe(1);
  });
});
