import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

// Captain with a Wargear group: choose at most 1 of {sword, axe}.
function cat(gcType: "max" | "min", value: number): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
        categories: ["cat.hq"], constraints: [], children: [
          { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
        ],
        groups: [{
          id: "g.wargear", name: "Wargear",
          memberEntryIds: ["e.sword", "e.axe"],
          constraints: [{ id: "g.wargear.limit", type: gcType, value }],
        }],
      },
    ],
  };
}

function roster(members: string[], overrides?: Roster["overrides"]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "cap", entryId: "e.captain", count: 1,
      selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })),
    }],
    overrides,
  };
}

describe("group choose-N constraints", () => {
  it("choose-max satisfied (1 selected, max 1) → valid", () => {
    const r = evaluate(roster(["e.sword"]), cat("max", 1));
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.constraintId === "g.wargear.limit")).toBe(false);
  });

  it("choose-max violated (2 selected, max 1) → group.max error naming the group", () => {
    const r = evaluate(roster(["e.sword", "e.axe"]), cat("max", 1));
    expect(r.valid).toBe(false);
    const issue = r.issues.find((i) => i.constraintId === "g.wargear.limit");
    expect(issue?.code).toBe("group.max");
    expect(issue?.message).toContain("Wargear");
    expect(issue?.entryId).toBe("e.captain");
    expect(issue?.selectionId).toBe("cap");
  });

  it("choose-min violated (0 selected, min 1) → group.min error", () => {
    const r = evaluate(roster([]), cat("min", 1));
    expect(r.issues.find((i) => i.constraintId === "g.wargear.limit")?.code).toBe("group.min");
  });

  it("choose-min satisfied (1 selected, min 1) → valid", () => {
    const r = evaluate(roster(["e.sword"]), cat("min", 1));
    expect(r.valid).toBe(true);
  });

  it("a matching override dismisses a group violation", () => {
    const r = evaluate(
      roster(["e.sword", "e.axe"], [{ constraintId: "g.wargear.limit", selectionId: "cap", source: "user" }]),
      cat("max", 1),
    );
    expect(r.valid).toBe(true);
    expect(r.dismissed.some((i) => i.constraintId === "g.wargear.limit")).toBe(true);
  });

  it("non-member direct children are excluded from the group count", () => {
    const c = cat("max", 1);
    c.entries[0]!.children.push({
      id: "e.relic", name: "Relic", costs: [], categories: [], constraints: [], children: [], groups: [],
    });
    const r = evaluate(
      {
        id: "r", name: "R", gameSystemId: "gs", catalogueId: "c",
        catalogueRevision: 1, pointsLimit: 2000,
        selections: [{
          id: "cap", entryId: "e.captain", count: 1,
          selections: [
            { id: "m0", entryId: "e.sword", count: 1, selections: [] },
            { id: "m1", entryId: "e.relic", count: 1, selections: [] },
          ],
        }],
      },
      c,
    );
    // Only the sword counts toward Wargear (1 <= max 1); the relic is not a member.
    expect(r.valid).toBe(true);
    expect(r.issues.some((i) => i.constraintId === "g.wargear.limit")).toBe(false);
  });
});
