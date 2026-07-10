import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { buildSymbolTable } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "cat.demo",
  name: "Demo",
  gameSystemId: "gs.40k",
  revision: 1,
  forceConstraints: [],
  entries: [
    {
      id: "e.unit",
      name: "Unit",
      costs: [],
      categories: [],
      constraints: [],
      children: [
        { id: "e.wargear", name: "Wargear", costs: [], categories: [], constraints: [], children: [] },
      ],
    },
  ],
};

describe("buildSymbolTable", () => {
  it("indexes nested entries by id", () => {
    const table = buildSymbolTable(cat);
    expect(table.get("e.wargear")?.name).toBe("Wargear");
    expect(table.size).toBe(2);
  });

  it("throws on duplicate ids", () => {
    const dup: IrCatalogue = {
      ...cat,
      entries: [
        { id: "dup", name: "A", costs: [], categories: [], constraints: [], children: [] },
        { id: "dup", name: "B", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    expect(() => buildSymbolTable(dup)).toThrow(/duplicate/i);
  });
});
