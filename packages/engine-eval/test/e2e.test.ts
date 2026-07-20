import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// End-to-end scenarios: each drives the whole pipeline (symbol table -> state ->
// cost fixed-point -> constraint + override resolution) via the public evaluate()
// entry point, with every number hand-traced in the comments.

// A realistic strike-force catalogue combining nesting, per-model costs, a
// conditional bulk discount, a per-squad minimum-models rule, and force limits.
const strikeforce: IrCatalogue = {
  id: "cat.sf", name: "Strike Force", gameSystemId: "gs.40k", revision: 1, categoryNames: {},
  forceConstraints: [
    { id: "fc.hq.min", type: "min", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.hq", includeChildSelections: false },
    { id: "fc.hq.max", type: "max", value: 2, field: "selections", scope: "roster", targetType: "category", targetId: "cat.hq", includeChildSelections: false },
    { id: "fc.troops.min", type: "min", value: 2, field: "selections", scope: "roster", targetType: "category", targetId: "cat.troops", includeChildSelections: false },
  ],
  entries: [
    { id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }], categories: ["cat.hq"], constraints: [], children: [] },
    {
      id: "e.squad", name: "Battle Squad", categories: ["cat.troops"],
      // Bulk discount: -10 per squad once the roster fields at least 3 troop selections.
      costs: [{ name: "points", value: 100, modifiers: [
        { id: "m.bulk", type: "decrement", value: 10, conditions: [
          { id: "cd.bulk", comparator: "atLeast", value: 3, field: "selections", scope: "roster", targetType: "category", targetId: "cat.troops", includeChildSelections: false },
        ] },
      ] }],
      // A squad must contain at least 5 models (counts models in its own subtree).
      constraints: [
        { id: "sq.models.min", type: "min", value: 5, field: "selections", scope: "self", targetType: "category", targetId: "cat.model", includeChildSelections: true },
      ],
      children: [{ id: "e.model", name: "Model", costs: [{ name: "points", value: 20 }], categories: ["cat.model"], constraints: [], children: [] }],
    },
  ],
};

const meta = { id: "r", name: "R", gameSystemId: "gs.40k", catalogueId: "cat.sf", catalogueRevision: 1 };
const squad = (id: string, models: number) => ({
  id, entryId: "e.squad", count: 1,
  selections: [{ id: `${id}.m`, entryId: "e.model", count: models, selections: [] }],
});

describe("E2E: legal strike force with bulk discount", () => {
  // 1 captain + 3 full squads (5 models each). troops selections = 3 => discount on.
  // captain 90 | squads 3 x 90 = 270 | models 3 x (5 x 20) = 300 => 660.
  const roster: Roster = {
    ...meta, pointsLimit: 700,
    selections: [
      { id: "hq", entryId: "e.captain", count: 1, selections: [] },
      squad("sq1", 5), squad("sq2", 5), squad("sq3", 5),
    ],
  };

  it("passes with the discounted total", () => {
    const r = evaluate(roster, strikeforce);
    expect(r.totalPoints).toBe(660);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.dismissed).toEqual([]);
    expect(r.hasHouseRules).toBe(false);
  });
});

describe("E2E: multiplier propagates through nesting", () => {
  // squad count=2 => model effectiveCount = 3 x 2 = 6. Troops selections aggregate by
  // effectiveCount: sqA(2) + sqB(1) = 3 >= 3, so the bulk discount is active (squads 90).
  // sqA: node 90 x 2 = 180 | models 20 x 6 = 120 => 300.
  // sqB: node 90 x 1 = 90  | models 20 x 5 = 100 => 190. captain 90. total = 580.
  const roster: Roster = {
    ...meta, pointsLimit: 700,
    selections: [
      { id: "hq", entryId: "e.captain", count: 1, selections: [] },
      { id: "sqA", entryId: "e.squad", count: 2, selections: [{ id: "sqA.m", entryId: "e.model", count: 3, selections: [] }] },
      squad("sqB", 5),
    ],
  };

  it("scales child costs by the ancestor multiplier product", () => {
    const r = evaluate(roster, strikeforce);
    expect(r.totalPoints).toBe(580);
    expect(r.valid).toBe(true);
  });
});

describe("E2E: understrength squad dismissed by a system override", () => {
  // squad1 has only 3 models (< min 5) => violates sq.models.min on that node.
  // A system understrength override dismisses exactly that squad's violation.
  const roster: Roster = {
    ...meta, pointsLimit: 700,
    selections: [
      { id: "hq", entryId: "e.captain", count: 1, selections: [] },
      squad("sq1", 3), // understrength
      squad("sq2", 5),
    ],
    overrides: [{ constraintId: "sq.models.min", selectionId: "sq1", source: "system", reason: "understrength" }],
  };

  it("moves the violation to dismissed and keeps the roster valid without a house-rule flag", () => {
    const r = evaluate(roster, strikeforce);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.dismissed).toHaveLength(1);
    expect(r.dismissed[0]).toMatchObject({ constraintId: "sq.models.min", selectionId: "sq1" });
    expect(r.hasHouseRules).toBe(false); // system, not a user house rule
  });

  it("without the override, the same understrength squad is a hard error", () => {
    const r = evaluate({ ...roster, overrides: [] }, strikeforce);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.constraintId === "sq.models.min" && i.selectionId === "sq1")).toBe(true);
  });
});

describe("E2E: over-cap force limit dismissed by a user house rule", () => {
  // 3 HQ selections => fc.hq.max (max 2) violated. A user override dismisses it.
  const roster: Roster = {
    ...meta, pointsLimit: 900,
    selections: [
      { id: "hq1", entryId: "e.captain", count: 1, selections: [] },
      { id: "hq2", entryId: "e.captain", count: 1, selections: [] },
      { id: "hq3", entryId: "e.captain", count: 1, selections: [] },
      squad("sq1", 5), squad("sq2", 5),
    ],
    overrides: [{ constraintId: "fc.hq.max", source: "user", reason: "friendly game" }],
  };

  it("flags a house rule and stays valid", () => {
    const r = evaluate(roster, strikeforce);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.dismissed.some((i) => i.constraintId === "fc.hq.max")).toBe(true);
    expect(r.hasHouseRules).toBe(true);
  });
});

describe("E2E: nested condition groups gate a modifier (AND/OR)", () => {
  // hero base 100, -30 when (>=2 cat.a) OR (>=5 cat.b). Fillers are free (0 pts).
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      { id: "e.hero", name: "Hero", categories: ["cat.hero"], constraints: [], children: [],
        costs: [{ name: "points", value: 100, modifiers: [
          { id: "m.hero", type: "decrement", value: 30, conditionGroups: [
            { type: "or", conditions: [
              { id: "c1", comparator: "atLeast", value: 2, field: "selections", scope: "roster", targetType: "category", targetId: "cat.a", includeChildSelections: false },
              { id: "c2", comparator: "atLeast", value: 5, field: "selections", scope: "roster", targetType: "category", targetId: "cat.b", includeChildSelections: false },
            ] },
          ] },
        ] }] },
      { id: "e.filler", name: "Filler", costs: [{ name: "points", value: 0 }], categories: ["cat.a"], constraints: [], children: [] },
    ],
  };
  const rosterWithFillers = (n: number): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 1000,
    selections: [
      { id: "h", entryId: "e.hero", count: 1, selections: [] },
      ...Array.from({ length: n }, (_, i) => ({ id: `f${i}`, entryId: "e.filler", count: 1, selections: [] })),
    ],
  });

  it("applies the discount when the OR group is satisfied (2 cat.a)", () => {
    expect(evaluate(rosterWithFillers(2), cat).totalPoints).toBe(70);
  });

  it("withholds the discount when neither branch is satisfied (1 cat.a)", () => {
    expect(evaluate(rosterWithFillers(1), cat).totalPoints).toBe(100);
  });
});
