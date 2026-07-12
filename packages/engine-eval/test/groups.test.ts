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
          constraints: [{ id: "g.wargear.limit", type: gcType, value, scope: "self" }],
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

describe("nested group emitted as a flat IrGroup enforces independently", () => {
  // Simulates the parser output for a unit with an outer group (choose ≤2 of its
  // direct members) plus a nested inner group (choose ≤1 of its own members) —
  // both flat in entry.groups, members all flattened into the entry's children.
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.u", name: "Unit", costs: [{ name: "points", value: 10 }],
        categories: [], constraints: [], children: [
          { id: "e.a", name: "A", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.b", name: "B", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.i1", name: "I1", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.i2", name: "I2", costs: [], categories: [], constraints: [], children: [], groups: [] },
        ],
        groups: [
          { id: "g.outer", name: "Outer", memberEntryIds: ["e.a", "e.b"], constraints: [{ id: "g.outer.max", type: "max", value: 2, scope: "self" }] },
          { id: "g.inner", name: "Inner", memberEntryIds: ["e.i1", "e.i2"], constraints: [{ id: "g.inner.max", type: "max", value: 1, scope: "self" }] },
        ],
      },
    ],
  };
  const roster = (members: string[]): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{ id: "u", entryId: "e.u", count: 1, selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })) }],
  });

  it("flags the nested group's max independently of the outer group", () => {
    const r = evaluate(roster(["e.i1", "e.i2"]), cat); // 2 in inner, max 1
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.constraintId === "g.inner.max")).toBe(true);
  });

  it("passes when each group is within its own limit", () => {
    const r = evaluate(roster(["e.a", "e.b", "e.i1"]), cat); // outer 2/2, inner 1/1
    expect(r.valid).toBe(true);
  });
});

function rosterCat(gcType: "max" | "min", value: number): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [{ id: "e.relic", name: "Relic", costs: [], categories: [], constraints: [], children: [], groups: [] }],
        groups: [{ id: "g.relics", name: "Relics", memberEntryIds: ["e.relic"], constraints: [{ id: "g.relics.lim", type: gcType, value, scope: "roster" }] }],
      },
    ],
  } as unknown as IrCatalogue;
}
const rosterTwoHeroes = (relicsEach: number): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [0, 1].map((h) => ({
    id: `h${h}`, entryId: "e.hero", count: 1,
    selections: Array.from({ length: relicsEach }, (_, i) => ({ id: `h${h}r${i}`, entryId: "e.relic", count: 1, selections: [] })),
  })),
});

describe("roster-scope group constraints", () => {
  it("counts group members across the whole roster (max 1, two selected) -> one army-level error", () => {
    const r = evaluate(rosterTwoHeroes(1), rosterCat("max", 1));
    const groupIssues = r.issues.filter((i) => i.constraintId === "g.relics.lim");
    expect(groupIssues.length).toBe(1);
    expect(groupIssues[0]!.code).toBe("group.max");
    expect(groupIssues[0]!.selectionId).toBeUndefined();
  });
  it("roster-scope min flags when the whole roster is short", () => {
    const r = evaluate(rosterTwoHeroes(0), rosterCat("min", 1));
    expect(r.issues.some((i) => i.constraintId === "g.relics.lim" && i.code === "group.min")).toBe(true);
  });
  it("roster-scope max satisfied (1 total) -> no issue", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "h0", entryId: "e.hero", count: 1, selections: [{ id: "h0r0", entryId: "e.relic", count: 1, selections: [] }] },
        { id: "h1", entryId: "e.hero", count: 1, selections: [] },
      ],
    } as unknown as Roster;
    const r = evaluate(roster, rosterCat("max", 1));
    expect(r.issues.some((i) => i.constraintId === "g.relics.lim")).toBe(false);
  });
});
