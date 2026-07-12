import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrEntry } from "@muster/domain";
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

  it("first-wins on an id collision between differing entries (per-placement clones are legitimate)", () => {
    const dup: IrCatalogue = {
      ...cat,
      entries: [
        ...cat.entries,
        { id: "dup", name: "A", costs: [], categories: [], constraints: [], children: [] },
        { id: "dup", name: "B", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    const table = buildSymbolTable(dup);
    expect(table.get("dup")?.name).toBe("A"); // first wins, no throw
    expect(table.size).toBe(3); // e.unit + e.wargear (from cat) + dup
  });

  it("dedups an identical inlined entry (first wins, subtree walked once)", () => {
    const shared: IrEntry = {
      id: "e.shared",
      name: "Shared",
      costs: [],
      categories: [],
      constraints: [],
      children: [
        { id: "e.shared.child", name: "Child", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    const inlined: IrCatalogue = {
      ...cat,
      entries: [structuredClone(shared), structuredClone(shared)],
    };
    const table = buildSymbolTable(inlined);
    // e.shared + e.shared.child, each registered exactly once — no throw.
    expect(table.size).toBe(2);
    expect(table.get("e.shared")?.name).toBe("Shared");
    expect(table.get("e.shared.child")?.name).toBe("Child");
  });

  it("dedups the same shared entry inlined under two different parents", () => {
    const shared: IrEntry = {
      id: "e.bolter",
      name: "Bolter",
      costs: [],
      categories: [],
      constraints: [],
      children: [],
    };
    const nested: IrCatalogue = {
      ...cat,
      entries: [
        { id: "e.a", name: "A", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
        { id: "e.b", name: "B", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
      ],
    };
    const table = buildSymbolTable(nested);
    expect(table.size).toBe(3); // e.a, e.b, e.bolter (once)
    expect(table.get("e.bolter")?.name).toBe("Bolter");
  });
});
