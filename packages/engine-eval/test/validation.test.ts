import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// A weapon carrying a rule: invalid ("Max 1 Weapon per 5 models") when >=2 of it
// are taken in the unit (gate: atLeast 2 of e.w in self/subtree).
function cat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [{
      id: "e.unit", name: "Squad", type: "unit", costs: [], categories: [], constraints: [], children: [
        {
          id: "e.w", name: "Weapon", costs: [], categories: [], constraints: [], children: [], groups: [],
          validationRules: [{
            message: "Max 1 {this} per 5 models",
            conditions: [{
              id: "cond.atLeast.e.w", comparator: "atLeast", value: 2,
              field: "selections", scope: "unit", targetType: "entry",
              targetId: "e.w", includeChildSelections: true,
            }],
          }],
        },
      ],
    }],
  } as unknown as IrCatalogue;
}

function roster(weaponCount: number): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: "e.unit", count: 1,
      selections: Array.from({ length: weaponCount }, (_, i) => ({ id: `w${i}`, entryId: "e.w", count: 1, selections: [] })),
    }],
  } as unknown as Roster;
}

describe("conditional validation rules (field=error)", () => {
  it("gate passes → error issue with {this} substituted, roster invalid", () => {
    const r = evaluate(roster(2), cat());
    const issue = r.issues.find((i) => i.code === "selection.invalid");
    expect(issue?.severity).toBe("error");
    expect(issue?.message).toBe("Max 1 Weapon per 5 models");
    expect(issue?.entryId).toBe("e.w");
    expect(r.valid).toBe(false);
  });

  it("gate fails → no issue", () => {
    const r = evaluate(roster(1), cat());
    expect(r.issues.some((i) => i.code === "selection.invalid")).toBe(false);
  });

  it("entry name with $& replaces literally, not as regex replacement pattern", () => {
    const catWithSpecialName: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
      entries: [{
        id: "e.unit", name: "Squad", type: "unit", costs: [], categories: [], constraints: [], children: [
          {
            id: "e.w", name: "Weapon $& Name", costs: [], categories: [], constraints: [], children: [], groups: [],
            validationRules: [{
              message: "Cannot use {this}",
              conditions: [{
                id: "cond.atLeast.e.w", comparator: "atLeast", value: 1,
                field: "selections", scope: "unit", targetType: "entry",
                targetId: "e.w", includeChildSelections: true,
              }],
            }],
          },
        ],
      }],
    } as unknown as IrCatalogue;

    const r = evaluate(roster(1), catWithSpecialName);
    const issue = r.issues.find((i) => i.code === "selection.invalid");
    expect(issue?.message).toBe("Cannot use Weapon $& Name");
  });
});
