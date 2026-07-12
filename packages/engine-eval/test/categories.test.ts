import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// A unit that gains category "cat.elite" when a detachment entry e.det is in the
// roster. A force max of 0 on cat.elite means: taking the unit alongside the
// detachment newly violates the cap.
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    forceConstraints: [
      { id: "fc.elite.max", type: "max", value: 0, field: "selections", scope: "force",
        targetType: "category", targetId: "cat.elite", includeChildSelections: true },
    ],
    entries: [
      {
        id: "e.u", name: "Unit", costs: [], categories: [], constraints: [], children: [],
        categoryModifiers: [{
          type: "add", categoryId: "cat.elite",
          conditions: [{
            id: "cond.atLeast.e.det", comparator: "atLeast", value: 1,
            field: "selections", scope: "roster", targetType: "entry",
            targetId: "e.det", includeChildSelections: true,
          }],
        }],
      },
      { id: "e.det", name: "Detachment", costs: [], categories: [], constraints: [], children: [] },
    ],
  } as unknown as IrCatalogue;
}

function roster(withDetachment: boolean): Roster {
  const sels = [{ id: "u", entryId: "e.u", count: 1, selections: [] as unknown[] }];
  if (withDetachment) sels.push({ id: "d", entryId: "e.det", count: 1, selections: [] });
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: sels,
  } as unknown as Roster;
}

describe("conditional category membership (field=category)", () => {
  it("gate passes → unit gains the category → force max on it is violated", () => {
    const r = evaluate(roster(true), cat());
    expect(r.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("gate fails → membership static → no violation", () => {
    const r = evaluate(roster(false), cat());
    expect(r.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(false);
    expect(r.valid).toBe(true);
  });
});

// A unit that is statically in "cat.elite" but LOSES that category when a
// detachment entry e.det is in the roster (type: "remove"). Exercises the
// removal branch of effectiveCategories, mirroring the "add" case above.
function catRemove(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    forceConstraints: [
      { id: "fc.elite.max", type: "max", value: 0, field: "selections", scope: "force",
        targetType: "category", targetId: "cat.elite", includeChildSelections: true },
    ],
    entries: [
      {
        id: "e.u", name: "Unit", costs: [], categories: ["cat.elite"], constraints: [], children: [],
        categoryModifiers: [{
          type: "remove", categoryId: "cat.elite",
          conditions: [{
            id: "cond.atLeast.e.det", comparator: "atLeast", value: 1,
            field: "selections", scope: "roster", targetType: "entry",
            targetId: "e.det", includeChildSelections: true,
          }],
        }],
      },
      { id: "e.det", name: "Detachment", costs: [], categories: [], constraints: [], children: [] },
    ],
  } as unknown as IrCatalogue;
}

describe("conditional category membership (remove)", () => {
  it("gate fails → unit keeps the static category → force max on it is violated", () => {
    const r = evaluate(roster(false), catRemove());
    expect(r.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(true);
    expect(r.valid).toBe(false);
  });

  it("gate passes → unit loses the category → no violation", () => {
    const r = evaluate(roster(true), catRemove());
    expect(r.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(false);
    expect(r.valid).toBe(true);
  });
});
