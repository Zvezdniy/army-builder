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

describe("parser IR contract — validation rule", () => {
  // Mirrors the parser's serialized shape for a field="error" modifier turned
  // validation rule. Validated by Zod, then evaluated — proving parser output →
  // domain → engine enforcement.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [{
      id: "e.unit", name: "Squad", type: "unit",
      costs: [], categories: [], constraints: [],
      children: [{
        id: "e.w", name: "Weapon", type: "upgrade",
        costs: [], categories: [], constraints: [], children: [], groups: [],
        validationRules: [{
          message: "Max 1 {this} per 5 models",
          conditions: [{
            comparator: "atLeast", value: 2, field: "selections", scope: "unit",
            targetType: "entry", targetId: "e.w", includeChildSelections: true,
            id: "cond.atLeast.e.w",
          }],
        }],
      }],
    }],
  };

  const roster = (weaponCount: number): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: "e.unit", count: 1,
      selections: Array.from({ length: weaponCount }, (_, i) => ({ id: `w${i}`, entryId: "e.w", count: 1, selections: [] })),
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("emits the authored error only when the gate passes", () => {
    const cat = IrCatalogue.parse(shaped);
    const bad = evaluate(roster(2), cat);
    const issue = bad.issues.find((i) => i.code === "selection.invalid");
    expect(issue?.message).toBe("Max 1 Weapon per 5 models");
    expect(bad.valid).toBe(false);

    const ok = evaluate(roster(1), cat);
    expect(ok.issues.some((i) => i.code === "selection.invalid")).toBe(false);
  });
});

describe("parser IR contract — conditional category membership", () => {
  // Mirrors the parser's serialized shape for a field="category" add modifier.
  // Validated by Zod, then evaluated — proving parser output → domain → engine.
  const shaped = {
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
            comparator: "atLeast", value: 1, field: "selections", scope: "roster",
            targetType: "entry", targetId: "e.det", includeChildSelections: true,
            id: "cond.atLeast.e.det",
          }],
        }],
      },
      { id: "e.det", name: "Detachment", costs: [], categories: [], constraints: [], children: [] },
    ],
  };

  const roster = (withDetachment: boolean): Roster => {
    const selections = [{ id: "u", entryId: "e.u", count: 1, selections: [] as unknown[] }];
    if (withDetachment) selections.push({ id: "d", entryId: "e.det", count: 1, selections: [] });
    return {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections,
    } as unknown as Roster;
  };

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("the conditional category flips a force-limit outcome", () => {
    const cat = IrCatalogue.parse(shaped);
    const withDet = evaluate(roster(true), cat);
    expect(withDet.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(true);
    expect(withDet.valid).toBe(false);

    const without = evaluate(roster(false), cat);
    expect(without.issues.some((i) => i.constraintId === "fc.elite.max")).toBe(false);
    expect(without.valid).toBe(true);
  });
});

describe("parser IR contract — cost modifier shape from an inlined link", () => {
  // Two structurally-distinct entries — same name ("Wargear"), different ids —
  // one carrying a costs[].modifiers decrement, one without. This is the exact
  // wire shape the parser emits when it routes an entryLink's cost modifier
  // onto an inlined instance (Task 1). It proves that shape validates via
  // IrCatalogue.parse and is applied end-to-end by evaluate()'s cost
  // resolution — it does NOT prove per-placement isolation of a single shared
  // entry inlined at two sites under different modifiers. That case (same id,
  // divergent placements) was previously unreachable due to buildSymbolTable
  // throwing "Duplicate entry id" for same-id entries that aren't byte-identical;
  // it is now supported via tree-based resolution (see the keystone test below).
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [
      {
        id: "e.a", name: "A", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.a.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5, modifiers: [{ id: "m0", type: "decrement", value: 2 }] }],
        }],
      },
      {
        id: "e.b", name: "B", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.b.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5 }],
        }],
      },
    ],
  };

  const roster = (host: "e.a" | "e.b"): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: host, count: 1,
      selections: [{ id: "w", entryId: host === "e.a" ? "e.a.wargear" : "e.b.wargear", count: 1, selections: [] }],
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("prices the discounted placement at 3 and the plain placement at 5", () => {
    const cat = IrCatalogue.parse(shaped);
    expect(evaluate(roster("e.a"), cat).totalPoints).toBe(3);
    expect(evaluate(roster("e.b"), cat).totalPoints).toBe(5);
  });
});

describe("parser IR contract — same-id per-placement now evaluates (keystone)", () => {
  // The SAME shared id `e.wargear` inlined under two units, one placement
  // discounted via costs[].modifiers. Before the keystone this threw in
  // buildSymbolTable ("Duplicate entry id"); now tree resolution gives each
  // placement its own instance and evaluate() prices them independently.
  const shaped = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1,
    entries: [
      {
        id: "e.a", name: "A", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5, modifiers: [{ id: "m0", type: "decrement", value: 2 }] }],
        }],
      },
      {
        id: "e.b", name: "B", type: "unit", costs: [], categories: [], constraints: [],
        children: [{
          id: "e.wargear", name: "Wargear", type: "upgrade", categories: [], constraints: [], children: [], groups: [],
          costs: [{ name: "points", value: 5 }],
        }],
      },
    ],
  };

  const roster = (host: "e.a" | "e.b"): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{
      id: "u", entryId: host, count: 1,
      selections: [{ id: "w", entryId: "e.wargear", count: 1, selections: [] }],
    }],
  });

  it("validates against the domain schema", () => {
    const parsed = IrCatalogue.safeParse(shaped);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("evaluates without throwing and prices each placement independently", () => {
    const cat = IrCatalogue.parse(shaped);
    expect(() => evaluate(roster("e.a"), cat)).not.toThrow();
    expect(evaluate(roster("e.a"), cat).totalPoints).toBe(3); // discounted placement
    expect(evaluate(roster("e.b"), cat).totalPoints).toBe(5); // plain placement
  });
});
