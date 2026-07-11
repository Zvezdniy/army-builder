import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import {
  createRoster, availableUnits, addUnit, addOption, setCount, remove, optionsFor,
} from "./index";

const catalogue: IrCatalogue = {
  id: "cat", name: "Cat", gameSystemId: "gs", revision: 1,
  forceConstraints: [],
  entries: [
    {
      id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
      categories: ["cat.hq"], constraints: [],
      children: [{ id: "e.bolter", name: "Bolter", costs: [], categories: [], constraints: [], children: [] }],
      groups: [{ id: "g.wpn", name: "Weapon", memberEntryIds: ["e.bolter"], constraints: [{ id: "gc", type: "max", value: 1 }] }],
    },
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: [], constraints: [], children: [], groups: [] },
  ],
};

describe("roster builder", () => {
  it("createRoster seeds catalogue linkage and empty selections", () => {
    const r = createRoster(catalogue, 2000, "My List");
    expect(r.catalogueId).toBe("cat");
    expect(r.gameSystemId).toBe("gs");
    expect(r.catalogueRevision).toBe(1);
    expect(r.pointsLimit).toBe(2000);
    expect(r.name).toBe("My List");
    expect(r.selections).toEqual([]);
  });

  it("createRoster uses a default name when omitted", () => {
    expect(createRoster(catalogue, 1000).name).toBe("New Roster");
  });

  it("availableUnits returns catalogue roots", () => {
    expect(availableUnits(catalogue).map((e) => e.id)).toEqual(["e.captain", "e.squad"]);
  });

  it("addUnit appends a root selection immutably", () => {
    const r0 = createRoster(catalogue, 2000);
    const r1 = addUnit(r0, "e.captain");
    expect(r0.selections).toEqual([]); // original untouched
    expect(r1.selections).toHaveLength(1);
    expect(r1.selections[0]!.entryId).toBe("e.captain");
    expect(r1.selections[0]!.count).toBe(1);
  });

  it("addOption nests a child under the target selection", () => {
    const r0 = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r0.selections[0]!.id;
    const r1 = addOption(r0, capId, "e.bolter");
    expect(r0.selections[0]!.selections).toEqual([]); // original untouched
    expect(r1.selections[0]!.selections[0]!.entryId).toBe("e.bolter");
  });

  it("addOption on a nested selection recurses past the first level (mapTree)", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    const boltId = r.selections[0]!.selections[0]!.id;
    r = addOption(r, boltId, "e.scope");
    expect(r.selections[0]!.selections[0]!.selections[0]!.entryId).toBe("e.scope");
  });

  it("setCount updates a nested selection's count", () => {
    const r0 = addUnit(createRoster(catalogue, 2000), "e.squad");
    const id = r0.selections[0]!.id;
    const r1 = setCount(r0, id, 10);
    expect(r0.selections[0]!.count).toBe(1); // original untouched
    expect(r1.selections[0]!.count).toBe(10);
  });

  it("remove drops a selection and its subtree", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    const r0 = r;
    const r1 = remove(r0, capId);
    expect(r0.selections).toHaveLength(1); // original untouched
    expect(r1.selections).toEqual([]);
  });

  it("remove of a nested option keeps the parent", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    const optId = r.selections[0]!.selections[0]!.id;
    r = remove(r, optId);
    expect(r.selections).toHaveLength(1);
    expect(r.selections[0]!.selections).toEqual([]);
  });

  it("optionsFor returns the entry's children and groups", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const id = r.selections[0]!.id;
    const { options, groups } = optionsFor(r, id, catalogue);
    expect(options.map((o) => o.id)).toEqual(["e.bolter"]);
    expect(groups.map((g) => g.id)).toEqual(["g.wpn"]);
  });

  it("optionsFor is empty for an unknown selection id", () => {
    const r = createRoster(catalogue, 2000);
    expect(optionsFor(r, "nope", catalogue)).toEqual({ options: [], groups: [] });
  });

  it("optionsFor is empty when the entry is missing from the catalogue", () => {
    // selection references an entryId not present in the catalogue
    const r: ReturnType<typeof createRoster> = {
      ...createRoster(catalogue, 2000),
      selections: [{ id: "s1", entryId: "ghost", count: 1, selections: [] }],
    };
    expect(optionsFor(r, "s1", catalogue)).toEqual({ options: [], groups: [] });
  });

  it("optionsFor yields empty groups when entry has no groups", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.squad");
    const id = r.selections[0]!.id;
    expect(optionsFor(r, id, catalogue).groups).toEqual([]);
  });

  it("optionsFor on a nested selection recurses (findTree) and falls back to [] when the entry omits groups", () => {
    let r = addUnit(createRoster(catalogue, 2000), "e.captain");
    const capId = r.selections[0]!.id;
    r = addOption(r, capId, "e.bolter");
    const boltId = r.selections[0]!.selections[0]!.id;
    // e.bolter has no `children` beyond [] and no `groups` field at all, so
    // this exercises both findTree's recursive descent past the first level
    // and the `entry.groups ?? []` fallback (undefined, not an explicit []).
    const { options, groups } = optionsFor(r, boltId, catalogue);
    expect(options).toEqual([]);
    expect(groups).toEqual([]);
  });
});
