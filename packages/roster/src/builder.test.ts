import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrGroup } from "@muster/domain";
import {
  createRoster, availableUnits, addUnit, addOption, setCount, remove, optionsFor,
  selectedGroupMembers, toggleGroupMember,
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

// A unit with a choose-1 weapon group and a choose-2 trinket group.
const swapCat: IrCatalogue = {
  id: "cat", name: "Cat", gameSystemId: "gs", revision: 1,
  forceConstraints: [],
  entries: [
    {
      id: "e.hero", name: "Hero", costs: [{ name: "points", value: 50 }],
      categories: [], constraints: [],
      children: [
        { id: "e.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.shield", name: "Shield", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.cloak", name: "Cloak", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.ring", name: "Ring", costs: [], categories: [], constraints: [], children: [] },
      ],
      groups: [
        { id: "g.weapon", name: "Weapon", memberEntryIds: ["e.sword", "e.axe"], constraints: [{ id: "w.max", type: "max", value: 1 }] },
        { id: "g.trinket", name: "Trinket", memberEntryIds: ["e.shield", "e.cloak", "e.ring"], constraints: [{ id: "t.max", type: "max", value: 2 }] },
      ],
    },
  ],
};
const weaponGroup = swapCat.entries[0]!.groups![0]!;
const trinketGroup = swapCat.entries[0]!.groups![1]!;
const groupWithoutMax: IrGroup = { id: "g.free", name: "Free", memberEntryIds: ["e.sword", "e.axe"], constraints: [] };

function addHero() {
  const r = addUnit(createRoster(swapCat, 2000), "e.hero");
  return { r, heroId: r.selections[0]!.id };
}

describe("group single/limited choice", () => {
  it("selectedGroupMembers lists the group members currently chosen under a unit", () => {
    let { r, heroId } = addHero();
    expect(selectedGroupMembers(r, heroId, weaponGroup)).toEqual([]);
    r = toggleGroupMember(r, heroId, weaponGroup, "e.sword");
    expect(selectedGroupMembers(r, heroId, weaponGroup)).toEqual(["e.sword"]);
  });

  it("selectedGroupMembers is empty for an unknown selection id", () => {
    const { r } = addHero();
    expect(selectedGroupMembers(r, "nope", weaponGroup)).toEqual([]);
  });

  it("toggleGroupMember adds a member when the group has room", () => {
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, weaponGroup, "e.sword");
    expect(selectedGroupMembers(r1, heroId, weaponGroup)).toEqual(["e.sword"]);
  });

  it("toggleGroupMember on an already-selected member deselects it", () => {
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, weaponGroup, "e.sword");
    const r2 = toggleGroupMember(r1, heroId, weaponGroup, "e.sword");
    expect(selectedGroupMembers(r2, heroId, weaponGroup)).toEqual([]);
  });

  it("toggleGroupMember swaps one for another in a max-1 group", () => {
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, weaponGroup, "e.sword");
    const r2 = toggleGroupMember(r1, heroId, weaponGroup, "e.axe");
    // exactly one weapon remains, and it is the newly chosen one
    expect(selectedGroupMembers(r2, heroId, weaponGroup)).toEqual(["e.axe"]);
    expect(r2.selections[0]!.selections).toHaveLength(1);
  });

  it("toggleGroupMember fills up to max then blocks further additions", () => {
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, trinketGroup, "e.shield");
    const r2 = toggleGroupMember(r1, heroId, trinketGroup, "e.cloak");
    // group is now full (max 2); a third is a no-op
    const r3 = toggleGroupMember(r2, heroId, trinketGroup, "e.ring");
    expect(r3).toBe(r2);
    expect(selectedGroupMembers(r3, heroId, trinketGroup).sort()).toEqual(["e.cloak", "e.shield"]);
  });

  it("toggleGroupMember treats a group without a max as unbounded", () => {
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, groupWithoutMax, "e.sword");
    const r2 = toggleGroupMember(r1, heroId, groupWithoutMax, "e.axe");
    expect(selectedGroupMembers(r2, heroId, groupWithoutMax).sort()).toEqual(["e.axe", "e.sword"]);
  });

  it("toggleGroupMember is a no-op when the parent selection is unknown", () => {
    const { r } = addHero();
    expect(toggleGroupMember(r, "nope", weaponGroup, "e.sword")).toBe(r);
  });
});
