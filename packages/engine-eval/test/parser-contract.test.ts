// parser-golden.ir.json is a byte-for-byte copy of
// packages/engine-parser/tests/fixtures/golden/mini40k.ir.json — keep them identical.
// (A future pipeline step can automate this copy.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IrCatalogue, type Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/parser-golden.ir.json", import.meta.url)), "utf8"),
);

describe("parser IR contract", () => {
  it("golden parser output validates against the domain Zod schema", () => {
    const parsed = IrCatalogue.safeParse(golden);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("engine-eval evaluates a legal roster on the parsed catalogue", () => {
    const cat = IrCatalogue.parse(golden);
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [{ id: "s", entryId: "e.captain", count: 1, selections: [] }],
    };
    const result = evaluate(roster, cat);
    expect(result.totalPoints).toBe(90);
    expect(result.valid).toBe(true); // 1 HQ satisfies fc.hq.min/max; no violations
  });

  it("engine-eval surfaces a parsed forceConstraint when violated", () => {
    const cat = IrCatalogue.parse(golden);
    // 3 HQ selections violate fc.hq.max (max 2) — proves the parsed forceConstraints are live.
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [
        { id: "h1", entryId: "e.captain", count: 1, selections: [] },
        { id: "h2", entryId: "e.captain", count: 1, selections: [] },
        { id: "h3", entryId: "e.captain", count: 1, selections: [] },
      ],
    };
    const result = evaluate(roster, cat);
    expect(result.totalPoints).toBe(270);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.max")).toBe(true);
  });

  it("engine-eval enforces a parsed group choose-N limit", () => {
    const cat = IrCatalogue.parse(golden);
    // Captain takes BOTH wargear options → violates g.wargear.max (max 1).
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [{
        id: "cap", entryId: "e.captain", count: 1,
        selections: [
          { id: "w1", entryId: "e.captain.sword", count: 1, selections: [] },
          { id: "w2", entryId: "e.captain.axe", count: 1, selections: [] },
        ],
      }],
    };
    const result = evaluate(roster, cat);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.constraintId === "g.wargear.max");
    expect(issue?.code).toBe("group.max");
  });
});

describe("parser IR contract — conditional group limit", () => {
  // Mirrors the parser's serialized shape for a group max=1 whose limit carries
  // an increment-by-1 modifier gated by "unit has >=1 e.sgt". Validated by Zod,
  // then evaluated — proving parser output → domain → engine enforcement.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [{
      id: "e.captain", name: "Captain", type: "unit",
      costs: [{ name: "points", value: 90 }], categories: [], constraints: [],
      children: [
        { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [], groups: [] },
        { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [], groups: [] },
        { id: "e.sgt", name: "Sergeant", costs: [], categories: [], constraints: [], children: [], groups: [] },
      ],
      groups: [{
        id: "g.wargear", name: "Wargear", memberEntryIds: ["e.sword", "e.axe"],
        constraints: [{
          id: "g.wargear.max", type: "max", value: 1, scope: "self",
          modifiers: [{
            id: "mod.g.wargear.0", type: "increment", value: 1,
            conditions: [{
              comparator: "atLeast", value: 1, field: "selections", scope: "self",
              targetType: "entry", targetId: "e.sgt", includeChildSelections: true,
              id: "cond.atLeast.e.sgt",
            }],
          }],
        }],
      }],
    }],
  };

  const roster = (members: string[]): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "cap", entryId: "e.captain", count: 1,
      selections: members.map((m, i) => ({ id: `m${i}`, entryId: m, count: 1, selections: [] })),
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("enforces base max when the gate is absent, relaxes it when present", () => {
    const cat = IrCatalogue.parse(shaped);
    const withoutSgt = evaluate(roster(["e.sword", "e.axe"]), cat);
    expect(withoutSgt.issues.some((i) => i.constraintId === "g.wargear.max")).toBe(true);

    const withSgt = evaluate(roster(["e.sword", "e.axe", "e.sgt"]), cat);
    expect(withSgt.issues.some((i) => i.constraintId === "g.wargear.max")).toBe(false);
    expect(withSgt.valid).toBe(true);
  });
});
