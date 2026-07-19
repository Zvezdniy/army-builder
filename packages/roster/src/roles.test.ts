import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrEntry } from "@muster/domain";
import { battlefieldRole, roleRank, ROLE_ORDER, OTHER_ROLE } from "./roles";

const cat = {
  categoryNames: {
    c1: "Faction: Adeptus Astartes",
    c2: "Infantry",
    c3: "Character",
    c4: "Epic Hero",
    c5: "Battleline",
    c6: "Vehicle",
  },
} as unknown as IrCatalogue;

const entry = (categories: string[]) => ({ categories }) as unknown as IrEntry;

describe("battlefieldRole", () => {
  it("returns the highest-priority role, not the entry's first category", () => {
    // first category is the faction keyword; a named character resolves to Epic Hero
    expect(battlefieldRole(entry(["c1", "c2", "c3", "c4"]), cat)).toBe("Epic Hero");
  });

  it("prefers Battleline over Infantry", () => {
    expect(battlefieldRole(entry(["c1", "c5", "c2"]), cat)).toBe("Battleline");
  });

  it("maps category ids to names via categoryNames", () => {
    expect(battlefieldRole(entry(["c6"]), cat)).toBe("Vehicle");
  });

  it("falls back to Other when the unit carries no known role", () => {
    expect(battlefieldRole(entry(["c1"]), cat)).toBe(OTHER_ROLE);
    expect(battlefieldRole(entry([]), cat)).toBe(OTHER_ROLE);
  });

  it("matches on the raw id when categoryNames is absent", () => {
    const bare = {} as unknown as IrCatalogue;
    expect(battlefieldRole(entry(["Character"]), bare)).toBe("Character");
    expect(battlefieldRole(entry(["unknown-id"]), bare)).toBe(OTHER_ROLE);
  });
});

describe("roleRank", () => {
  it("orders by ROLE_ORDER, with Other and unknown roles last", () => {
    expect(roleRank("Epic Hero")).toBe(0);
    expect(roleRank("Character")).toBeLessThan(roleRank("Infantry"));
    expect(roleRank(OTHER_ROLE)).toBe(ROLE_ORDER.length);
    expect(roleRank("Nonsense")).toBe(ROLE_ORDER.length);
  });
});
