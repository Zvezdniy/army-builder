import { describe, it, expect } from "vitest";
import type { IrCatalogue, RosterSelection, Roster } from "@muster/domain";
import { unitsByRole, modelCount } from "../src";

const entry = (over: Partial<IrCatalogue["entries"][number]>) => ({
  id: "x", name: "X", costs: [], categories: [], constraints: [], children: [], groups: [], profiles: [], ...over,
});
const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1,
  categoryNames: { "cat.hq": "HQ", "cat.troops": "Battleline" },
  entries: [
    entry({ id: "e.cap", name: "Captain", categories: ["cat.hq"],
      profiles: [{ name: "Captain", typeName: "Unit", characteristics: [{ name: "M", value: '6"' }] }] }),
    entry({ id: "e.sq", name: "Squad", categories: ["cat.troops"],
      children: [ entry({ id: "e.trooper", name: "Trooper",
        profiles: [{ name: "Trooper", typeName: "Unit", characteristics: [{ name: "W", value: "2" }] }] }) ] }),
    entry({ id: "e.nocat", name: "Nomad" }),
  ],
} as unknown as IrCatalogue;

const sel = (entryId: string, count = 1, children: RosterSelection[] = []): RosterSelection => ({
  id: crypto.randomUUID(), entryId, count, selections: children,
});
const roster = (sels: RosterSelection[]): Roster => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000, selections: sels,
} as unknown as Roster);

describe("unitsByRole", () => {
  it("groups root units by first-category name in first-seen order", () => {
    const out = unitsByRole(roster([sel("e.cap"), sel("e.sq"), sel("e.cap")]), cat);
    expect(out.map((g) => g.role)).toEqual(["HQ", "Battleline"]);
    expect(out[0]?.units).toHaveLength(2);
  });
  it("falls back to the id when the name is unknown, and to 'Other' when there is no category", () => {
    const c2 = { ...cat, categoryNames: {} } as unknown as IrCatalogue;
    const out = unitsByRole(roster([sel("e.cap"), sel("e.nocat")]), c2);
    expect(out.map((g) => g.role)).toEqual(["cat.hq", "Other"]);
  });
});

describe("modelCount", () => {
  it("counts a single-model unit as 1", () => {
    expect(modelCount(cat, sel("e.cap"))).toBe(1);
  });
  it("sums counts of Unit-profile nodes across the subtree", () => {
    expect(modelCount(cat, sel("e.sq", 1, [sel("e.trooper", 5)]))).toBe(5);
  });
  it("is 0 for a node with no Unit profile and no model children", () => {
    expect(modelCount(cat, sel("e.nocat"))).toBe(0);
  });
  it("tolerates an entry whose profiles field is absent entirely", () => {
    const noField = { ...cat, entries: [
      { id: "e.nf", name: "NF", costs: [], categories: [], constraints: [], children: [], groups: [] },
    ] } as unknown as IrCatalogue;
    expect(modelCount(noField, sel("e.nf"))).toBe(0);
  });
});
