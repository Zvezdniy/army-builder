import { describe, it, expect } from "vitest";
import type { IrCatalogue, RosterSelection } from "@muster/domain";
import { datasheet } from "../src";

const unit = (over: Partial<IrCatalogue["entries"][number]>) => ({
  id: "x", name: "X", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [], ...over,
});

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, entries: [
    unit({
      id: "e.hero", name: "Hero",
      profiles: [
        { name: "Hero", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] },
        { name: "Aura", typeName: "Abilities", characteristics: [{ name: "Description", value: "buff" }] },
      ],
      children: [
        unit({ id: "e.sword", name: "Sword",
          profiles: [{ name: "Sword", typeName: "Melee Weapons", characteristics: [{ name: "A", value: "5" }] }] }),
      ],
    }),
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count: 1, selections: children,
});

describe("datasheet", () => {
  it("returns empty for a selection whose entry has no profiles and no chosen children", () => {
    const bare = { ...cat, entries: [unit({ id: "e.bare", name: "Bare" })] } as unknown as IrCatalogue;
    expect(datasheet(bare, sel("e.bare"))).toEqual([]);
  });

  it("tolerates an entry whose profiles field is absent entirely", () => {
    const noField = { ...cat, entries: [
      { id: "e.nf", name: "NF", costs: [], categories: [], constraints: [], children: [], groups: [] },
    ] } as unknown as IrCatalogue;
    expect(datasheet(noField, sel("e.nf"))).toEqual([]);
  });

  it("groups the unit's own profiles by typeName in first-seen order", () => {
    const out = datasheet(cat, sel("e.hero"));
    expect(out.map((s) => s.typeName)).toEqual(["Unit", "Abilities"]);
    expect(out[0]?.profiles[0]?.characteristics[0]?.value).toBe('6"');
  });

  it("aggregates weapon profiles from selected children into their own section", () => {
    const out = datasheet(cat, sel("e.hero", [sel("e.sword")]));
    const melee = out.find((s) => s.typeName === "Melee Weapons");
    expect(melee?.profiles.map((p) => p.name)).toEqual(["Sword"]);
  });

  it("does not include a child's weapon when that child is not selected", () => {
    const out = datasheet(cat, sel("e.hero"));
    expect(out.some((s) => s.typeName === "Melee Weapons")).toBe(false);
  });

  it("de-duplicates an identical profile shared by two selected models", () => {
    const out = datasheet(cat, sel("e.hero", [sel("e.sword"), sel("e.sword")]));
    const melee = out.find((s) => s.typeName === "Melee Weapons");
    expect(melee?.profiles).toHaveLength(1);
  });
});
