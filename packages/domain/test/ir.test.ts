import { describe, it, expect } from "vitest";
import { IrCatalogue, IrConstraint, IrGroup, IrGroupConstraint, IrEntry } from "@muster/domain";

describe("IR schemas", () => {
  it("parses a catalogue with category names, defaulting to empty", () => {
    const withNames = IrCatalogue.parse({
      id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [],
      categoryNames: { "cat.hq": "HQ", "cat.troops": "Battleline" },
    });
    expect(withNames.categoryNames["cat.hq"]).toBe("HQ");
    const bare = IrCatalogue.parse({ id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [] });
    expect(bare.categoryNames).toEqual({});
  });

  it("carries optional weapon keywords and a catalogue rule glossary", () => {
    const cat = IrCatalogue.parse({
      id: "c", name: "C", gameSystemId: "gs", revision: 1,
      ruleTexts: { "Assault": "Can be fired even after Advancing." },
      entries: [{
        id: "e.w", name: "W",
        profiles: [{ name: "Bolt rifle", typeName: "Ranged Weapons", keywords: ["Assault", "Heavy"] }],
      }],
    });
    expect(cat.ruleTexts?.["Assault"]).toContain("Advancing");
    expect(cat.entries[0]?.profiles?.[0]?.keywords).toEqual(["Assault", "Heavy"]);
    const bare = IrCatalogue.parse({ id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [] });
    expect(bare.ruleTexts).toBeUndefined();
  });

  it("defaults includeChildSelections to false", () => {
    const c = IrConstraint.parse({
      id: "c1",
      type: "max",
      value: 3,
      field: "selections",
      scope: "force",
      targetType: "category",
      targetId: "cat.heavy",
    });
    expect(c.includeChildSelections).toBe(false);
  });

  it("parses a recursive catalogue with nested children", () => {
    const cat = IrCatalogue.parse({
      id: "cat.demo",
      name: "Demo",
      gameSystemId: "gs.40k",
      revision: 1,
      forceConstraints: [],
      entries: [
        {
          id: "e.unit",
          name: "Unit",
          costs: [{ name: "points", value: 100 }],
          categories: ["cat.troops"],
          constraints: [],
          children: [
            { id: "e.wargear", name: "Wargear", costs: [{ name: "points", value: 5 }] },
          ],
        },
      ],
    });
    expect(cat.entries[0]?.children[0]?.name).toBe("Wargear");
    // children/categories/constraints default to [] when omitted
    expect(cat.entries[0]?.children[0]?.children).toEqual([]);
  });
});

describe("IrEntry.type", () => {
  it("round-trips each known type value", () => {
    for (const t of ["unit", "upgrade", "model"] as const) {
      const e = IrEntry.parse({ id: "e", name: "E", type: t });
      expect(e.type).toBe(t);
    }
  });
  it("defaults to undefined when type is absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.type).toBeUndefined();
  });
});

describe("IrProfile / IrCharacteristic", () => {
  it("parses an entry carrying profiles", () => {
    const entry = IrEntry.parse({
      id: "e.hero", name: "Hero",
      profiles: [{
        name: "Hero", typeName: "Unit",
        characteristics: [{ name: "M", value: '6"' }, { name: "T", value: "4" }],
      }],
    });
    expect(entry.profiles?.[0]?.typeName).toBe("Unit");
    expect(entry.profiles?.[0]?.characteristics[1]?.value).toBe("4");
  });

  it("defaults profiles to an empty array when absent", () => {
    const entry = IrEntry.parse({ id: "e.bare", name: "Bare" });
    expect(entry.profiles).toEqual([]);
  });
});

describe("IrGroup / IrGroupConstraint", () => {
  it("parses a group with min/max constraints and members", () => {
    const g = IrGroup.parse({
      id: "g.wargear", name: "Wargear",
      memberEntryIds: ["e.sword", "e.axe"],
      constraints: [{ id: "g.max", type: "max", value: 1 }],
    });
    expect(g.memberEntryIds).toEqual(["e.sword", "e.axe"]);
    expect(g.constraints[0]).toEqual({ id: "g.max", type: "max", value: 1, scope: "self" });
  });

  it("defaults memberEntryIds and constraints to empty arrays", () => {
    const g = IrGroup.parse({ id: "g", name: "G" });
    expect(g.memberEntryIds).toEqual([]);
    expect(g.constraints).toEqual([]);
  });

  it("IrGroup accepts an optional defaultMemberEntryId", () => {
    const g = IrGroup.parse({ id: "g", name: "G", memberEntryIds: ["a"], constraints: [], defaultMemberEntryId: "a" });
    expect(g.defaultMemberEntryId).toBe("a");
  });

  it("IrGroup defaultMemberEntryId is optional", () => {
    const g = IrGroup.parse({ id: "g", name: "G", memberEntryIds: [], constraints: [] });
    expect(g.defaultMemberEntryId).toBeUndefined();
  });

  it("defaults IrEntry.groups to empty array when absent", () => {
    const e = IrEntry.parse({ id: "e", name: "E" });
    expect(e.groups).toEqual([]);
  });

  it("rejects a non-finite constraint value", () => {
    expect(IrGroupConstraint.safeParse({ id: "g", type: "max", value: Infinity }).success).toBe(false);
  });

  it("rejects an unknown constraint type", () => {
    expect(IrGroupConstraint.safeParse({ id: "g", type: "exactly", value: 1 }).success).toBe(false);
  });
});

describe("IrConstraint.scope", () => {
  it("accepts context/type scopes", () => {
    for (const scope of ["unit", "upgrade", "model", "model-or-unit", "root-entry", "ancestor"] as const) {
      const parsed = IrConstraint.parse({ id: "k", type: "max", value: 1, field: "selections", scope, targetType: "entry", targetId: "e.x" });
      expect(parsed.scope).toBe(scope);
    }
  });
});

describe("IrGroupConstraint.scope", () => {
  it("accepts roster scope and defaults to self", () => {
    expect(IrGroupConstraint.parse({ id: "g", type: "max", value: 1, scope: "roster" }).scope).toBe("roster");
    expect(IrGroupConstraint.parse({ id: "g", type: "max", value: 1 }).scope).toBe("self");
  });
});
