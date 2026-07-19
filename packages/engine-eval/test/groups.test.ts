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

  it("applies an army-wide modifier to a roster-scope limit, evaluated once", () => {
    // The relic cap is base max 1, raised to 3 by an army-wide gate (roster has >=1
    // hero). This mirrors what the parser now emits for roster-scope group limits
    // carrying an army-wide modifier. Two heroes with 2 relics each = 4 > 3 → a
    // single army-level error citing the MODIFIED limit (3, not the base 1),
    // proving the modifier fires at roster scope and the rule is evaluated once.
    const cat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
      entries: [{
        id: "e.hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [{ id: "e.relic", name: "Relic", costs: [], categories: [], constraints: [], children: [], groups: [] }],
        groups: [{
          id: "g.relics", name: "Relics", memberEntryIds: ["e.relic"],
          constraints: [{
            id: "g.relics.lim", type: "max", value: 1, scope: "roster",
            modifiers: [{
              id: "mod.g.relics.0", type: "set", value: 3,
              conditions: [{
                id: "cond.atLeast.e.hero", comparator: "atLeast", value: 1,
                field: "selections", scope: "roster", targetType: "entry",
                targetId: "e.hero", includeChildSelections: true,
              }],
            }],
          }],
        }],
      }],
    } as unknown as IrCatalogue;
    const r = evaluate(rosterTwoHeroes(2), cat);
    const groupIssues = r.issues.filter((i) => i.constraintId === "g.relics.lim");
    expect(groupIssues.length).toBe(1);
    expect(groupIssues[0]!.code).toBe("group.max");
    expect(groupIssues[0]!.message).toContain("max 3"); // modified limit, not base 1
    expect(groupIssues[0]!.selectionId).toBeUndefined();
  });

  it("an army-wide modifier that does not fire leaves the base roster-scope limit", () => {
    // Same modifier gated on forces>=1 (Crusade). A flat matched-play roster has no
    // forces → the gate is false → the base limit (max 1) holds. Two relics → error
    // citing max 1, confirming the modifier is inert when its army-wide gate is unmet.
    const cat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
      entries: [{
        id: "e.hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [{ id: "e.relic", name: "Relic", costs: [], categories: [], constraints: [], children: [], groups: [] }],
        groups: [{
          id: "g.relics", name: "Relics", memberEntryIds: ["e.relic"],
          constraints: [{
            id: "g.relics.lim", type: "max", value: 1, scope: "roster",
            modifiers: [{
              id: "mod.g.relics.0", type: "set", value: 3,
              conditions: [{
                id: "cond.atLeast.crusade", comparator: "atLeast", value: 1,
                field: "forces", scope: "roster", targetType: "entry",
                targetId: "e.crusade", includeChildSelections: true,
              }],
            }],
          }],
        }],
      }],
    } as unknown as IrCatalogue;
    const r = evaluate(rosterTwoHeroes(1), cat);
    const groupIssues = r.issues.filter((i) => i.constraintId === "g.relics.lim");
    expect(groupIssues.length).toBe(1);
    expect(groupIssues[0]!.message).toContain("max 1"); // base limit; forces gate never fires
  });

  it("a modifier lifting the cap to -1 makes the roster-scope limit unbounded", () => {
    // BattleScribe's "unlimited" convention: a fired gate sets the cap to -1. Here the
    // army-wide gate (roster has >=1 hero) fires, so the relic cap becomes -1 = no
    // limit; four relics must NOT flag, rather than "exceeds max -1".
    const cat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
      entries: [{
        id: "e.hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [{ id: "e.relic", name: "Relic", costs: [], categories: [], constraints: [], children: [], groups: [] }],
        groups: [{
          id: "g.relics", name: "Relics", memberEntryIds: ["e.relic"],
          constraints: [{
            id: "g.relics.lim", type: "max", value: 1, scope: "roster",
            modifiers: [{
              id: "mod.g.relics.0", type: "set", value: -1,
              conditions: [{
                id: "cond.atLeast.e.hero", comparator: "atLeast", value: 1,
                field: "selections", scope: "roster", targetType: "entry",
                targetId: "e.hero", includeChildSelections: true,
              }],
            }],
          }],
        }],
      }],
    } as unknown as IrCatalogue;
    const r = evaluate(rosterTwoHeroes(2), cat);
    expect(r.issues.some((i) => i.constraintId === "g.relics.lim")).toBe(false);
  });
});

function modCat(): IrCatalogue {
  return {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      {
        id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
        categories: ["cat.hq"], constraints: [], children: [
          { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
          { id: "e.sgt", name: "Sergeant", costs: [], categories: [], constraints: [], children: [], groups: [] },
        ],
        groups: [{
          id: "g.wargear", name: "Wargear",
          memberEntryIds: ["e.sword", "e.axe"],
          constraints: [{
            id: "g.wargear.max", type: "max", value: 1, scope: "self",
            modifiers: [{
              id: "mod.g.0", type: "increment", value: 1,
              conditions: [{
                id: "cond.atLeast.e.sgt", comparator: "atLeast", value: 1,
                field: "selections", scope: "self", targetType: "entry",
                targetId: "e.sgt", includeChildSelections: true,
              }],
            }],
          }],
        }],
      },
    ],
  } as unknown as IrCatalogue;
}

function capWith(members: string[]): Roster {
  return {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "cap", entryId: "e.captain", count: 1,
      selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })),
    }],
  } as unknown as Roster;
}

describe("conditional group limits (modifier on the limit)", () => {
  it("gate fails: base max=1 enforced (2 wargear → group.max exceeds max 1)", () => {
    const r = evaluate(capWith(["e.sword", "e.axe"]), modCat());
    const issue = r.issues.find((i) => i.constraintId === "g.wargear.max");
    expect(issue?.code).toBe("group.max");
    expect(issue?.message).toContain("exceeds max 1");
    expect(r.valid).toBe(false);
  });

  it("gate passes: sergeant raises max to 2, so 2 wargear is legal", () => {
    const r = evaluate(capWith(["e.sword", "e.axe", "e.sgt"]), modCat());
    expect(r.issues.some((i) => i.constraintId === "g.wargear.max")).toBe(false);
    expect(r.valid).toBe(true);
  });

  it("gate passes but limit still binds: 3 wargear exceeds the raised max 2", () => {
    const r = evaluate(capWith(["e.sword", "e.axe", "e.axe", "e.sgt"]), modCat());
    const issue = r.issues.find((i) => i.constraintId === "g.wargear.max");
    expect(issue?.code).toBe("group.max");
    expect(issue?.message).toContain("exceeds max 2");
  });
});
