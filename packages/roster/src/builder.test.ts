import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrGroup } from "@muster/domain";
import {
  createRoster, availableUnits, addUnit, addOption, setCount, remove, optionsFor,
  selectedGroupMembers, toggleGroupMember, groupControl, optionControl, catalogueEntry,
  unitLoadout,
} from "./index";

const catalogue: IrCatalogue = {
  id: "cat", name: "Cat", gameSystemId: "gs", revision: 1,
  forceConstraints: [], categoryNames: {},
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
  forceConstraints: [], categoryNames: {},
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

  it("a required (min 1) single group cannot be emptied but can be swapped", () => {
    const requiredWeapon: IrGroup = {
      id: "g.req", name: "Weapon", memberEntryIds: ["e.sword", "e.axe"],
      constraints: [{ id: "r.min", type: "min", value: 1 }, { id: "r.max", type: "max", value: 1 }],
    };
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, requiredWeapon, "e.sword");
    // clicking the only chosen member would drop below min 1 → no-op (stays chosen)
    const r2 = toggleGroupMember(r1, heroId, requiredWeapon, "e.sword");
    expect(r2).toBe(r1);
    expect(selectedGroupMembers(r2, heroId, requiredWeapon)).toEqual(["e.sword"]);
    // choosing another member swaps (never empties)
    const r3 = toggleGroupMember(r2, heroId, requiredWeapon, "e.axe");
    expect(selectedGroupMembers(r3, heroId, requiredWeapon)).toEqual(["e.axe"]);
  });
});

// Build an entry carrying only the given own-count constraints, for control classification.
function makeConstraint(
  id: string, type: "min" | "max", value: number,
  field: "selections" | "points" = "selections",
  scope: "self" | "parent" | "force" | "roster" = "self",
) {
  return { id, type, value, field, scope, targetType: "entry" as const, targetId: "", includeChildSelections: false };
}
function entryWith(constraints: ReturnType<typeof makeConstraint>[]) {
  return { id: "e", name: "E", costs: [], categories: [], constraints, children: [] };
}

describe("groupControl", () => {
  it("max 1 with min >= 1 is a required single choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [
      { id: "a", type: "min", value: 1 }, { id: "b", type: "max", value: 1 },
    ] })).toEqual({ kind: "single", required: true });
  });

  it("max 1 without a min is an optional single choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [
      { id: "b", type: "max", value: 1 },
    ] })).toEqual({ kind: "single", required: false });
  });

  it("max > 1 is an up-to-N multi choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [
      { id: "b", type: "max", value: 3 },
    ] })).toEqual({ kind: "multi", max: 3 });
  });

  it("no max at all is an unbounded multi choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [] }))
      .toEqual({ kind: "multi", max: Infinity });
  });
});

describe("optionControl", () => {
  it("max 1 is a toggle", () => {
    expect(optionControl(entryWith([makeConstraint("a", "max", 1)]))).toEqual({ kind: "toggle" });
  });

  it("min === max is a fixed count", () => {
    expect(optionControl(entryWith([
      makeConstraint("a", "min", 2), makeConstraint("b", "max", 2),
    ]))).toEqual({ kind: "fixed", count: 2 });
  });

  it("max > 1 is a bounded stepper", () => {
    expect(optionControl(entryWith([
      makeConstraint("a", "min", 0), makeConstraint("b", "max", 3),
    ]))).toEqual({ kind: "stepper", min: 0, max: 3 });
  });

  it("a min with no max is an unbounded stepper", () => {
    expect(optionControl(entryWith([makeConstraint("a", "min", 5)])))
      .toEqual({ kind: "stepper", min: 5, max: Infinity });
  });

  it("no own count bounds is a toggle", () => {
    expect(optionControl(entryWith([]))).toEqual({ kind: "toggle" });
  });

  it("ignores constraints that are not own selections-count bounds", () => {
    // points-field and roster-scope constraints must not drive the control → toggle
    expect(optionControl(entryWith([
      makeConstraint("a", "max", 3, "points"),
      makeConstraint("b", "max", 3, "selections", "roster"),
    ]))).toEqual({ kind: "toggle" });
  });
});

describe("catalogueEntry", () => {
  it("finds a root entry and a nested child, and returns undefined when absent", () => {
    expect(catalogueEntry(swapCat, "e.hero")?.name).toBe("Hero");
    expect(catalogueEntry(swapCat, "e.sword")?.name).toBe("Sword");
    expect(catalogueEntry(swapCat, "ghost")).toBeUndefined();
  });
});

describe("unitLoadout", () => {
  const loadoutCat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "g", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [{
      id: "u", name: "Squad", costs: [], categories: [], constraints: [], groups: [],
      children: [
        { id: "w.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [] },
        { id: "m", name: "Trooper", costs: [], categories: [], constraints: [], children: [],
          profiles: [{ name: "Trooper", typeName: "Unit", characteristics: [] }] },
      ],
    }],
  };

  it("lists selected wargear, excluding model bodies and the root itself", () => {
    const sel = { id: "s0", entryId: "u", count: 1, selections: [
      { id: "s1", entryId: "w.sword", count: 1, selections: [] },
      { id: "s2", entryId: "m", count: 3, selections: [] },
    ] };
    const lo = unitLoadout(loadoutCat, sel);
    expect(lo.unit).toBe("Squad");
    expect(lo.wargear).toEqual(["Sword"]); // Trooper (Unit body) excluded
  });

  it("dedupes repeated wargear, skips unknown children, and falls back to entryId for an unknown root", () => {
    const dup = { id: "s0", entryId: "u", count: 1, selections: [
      { id: "s1", entryId: "w.sword", count: 1, selections: [] },
      { id: "s2", entryId: "w.sword", count: 1, selections: [] },
      { id: "s3", entryId: "ghost.child", count: 1, selections: [] },
    ] };
    expect(unitLoadout(loadoutCat, dup).wargear).toEqual(["Sword"]);
    const ghost = { id: "s0", entryId: "ghost", count: 1, selections: [] };
    expect(unitLoadout(loadoutCat, ghost).unit).toBe("ghost");
  });
});

const defCat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "g", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "u", name: "U", costs: [], categories: [], constraints: [],
    children: [
      { id: "w.sword", name: "Sword", costs: [], categories: [], constraints: [], children: [] },
      { id: "w.axe", name: "Axe", costs: [], categories: [], constraints: [], children: [] },
      { id: "m", name: "Model", costs: [], categories: [],
        constraints: [{ id: "m.min", type: "min", value: 3, field: "selections", scope: "self", targetType: "entry", targetId: "m", includeChildSelections: false }],
        children: [] },
    ],
    groups: [
      { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"], defaultMemberEntryId: "w.sword",
        constraints: [{ id: "gw.min", type: "min", value: 1 }, { id: "gw.max", type: "max", value: 1 }] },
    ],
  }],
};

describe("addUnit prepopulates from defaults and mins", () => {
  it("selects a group's default member on add", () => {
    const r = addUnit(createRoster(defCat, 2000), "u");
    // no catalogue passed → behaves exactly as before (no prepopulation)
    expect(r.selections[0]!.selections).toEqual([]);
  });

  it("selects a group's default member on add when a catalogue is passed", () => {
    const r = addUnit(createRoster(defCat, 2000), "u", defCat);
    const kids = r.selections[0]!.selections.map((s) => s.entryId);
    expect(kids).toContain("w.sword");
    expect(kids).not.toContain("w.axe");
  });

  it("fills a min>=1 option to its minimum count", () => {
    const r = addUnit(createRoster(defCat, 2000), "u", defCat);
    const model = r.selections[0]!.selections.find((s) => s.entryId === "m");
    expect(model?.count).toBe(3);
  });

  it("falls back to the first member when a min>=1 group has no default", () => {
    const noDefaultCat: IrCatalogue = {
      ...defCat,
      entries: [{ ...defCat.entries[0]!, groups: [
        { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"],
          constraints: [{ id: "gw.min", type: "min", value: 1 }, { id: "gw.max", type: "max", value: 1 }] },
      ] }],
    };
    const r = addUnit(createRoster(noDefaultCat, 2000), "u", noDefaultCat);
    const kids = r.selections[0]!.selections.map((s) => s.entryId);
    expect(kids).toContain("w.sword");
    expect(kids).not.toContain("w.axe");
  });

  it("adds nothing for optional groups without a default", () => {
    const optCat: IrCatalogue = {
      ...defCat,
      entries: [{ ...defCat.entries[0]!, groups: [
        { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"],
          constraints: [{ id: "gw.max", type: "max", value: 1 }] },
      ], children: [defCat.entries[0]!.children[0]!, defCat.entries[0]!.children[1]!] }],
    };
    const r = addUnit(createRoster(optCat, 2000), "u", optCat);
    expect(r.selections[0]!.selections).toEqual([]);
  });

  it("seeds a nested subtree: a seeded child that itself has group defaults/mins", () => {
    const nestedCat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "g", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [{
        id: "u", name: "U", costs: [], categories: [], constraints: [],
        children: [
          {
            id: "sub", name: "Sub", costs: [], categories: [],
            constraints: [{ id: "sub.min", type: "min", value: 1, field: "selections", scope: "self", targetType: "entry", targetId: "sub", includeChildSelections: false }],
            children: [
              { id: "sub.sword", name: "SubSword", costs: [], categories: [], constraints: [], children: [] },
              { id: "sub.axe", name: "SubAxe", costs: [], categories: [], constraints: [], children: [] },
            ],
            groups: [
              { id: "sub.gw", name: "SubWeapon", memberEntryIds: ["sub.sword", "sub.axe"], defaultMemberEntryId: "sub.sword",
                constraints: [{ id: "sub.gw.min", type: "min", value: 1 }, { id: "sub.gw.max", type: "max", value: 1 }] },
            ],
          },
        ],
        groups: [],
      }],
    };
    const r = addUnit(createRoster(nestedCat, 2000), "u", nestedCat);
    const sub = r.selections[0]!.selections.find((s) => s.entryId === "sub");
    expect(sub?.count).toBe(1);
    const subKids = sub?.selections.map((s) => s.entryId);
    expect(subKids).toEqual(["sub.sword"]);
  });

  it("treats a parent-scoped min constraint the same as a self-scoped one", () => {
    const parentScopedCat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "g", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [{
        id: "u", name: "U", costs: [], categories: [], constraints: [],
        children: [
          { id: "m2", name: "Model2", costs: [], categories: [],
            constraints: [{ id: "m2.min", type: "min", value: 2, field: "selections", scope: "parent", targetType: "entry", targetId: "m2", includeChildSelections: false }],
            children: [] },
        ],
        groups: [],
      }],
    };
    const r = addUnit(createRoster(parentScopedCat, 2000), "u", parentScopedCat);
    const model = r.selections[0]!.selections.find((s) => s.entryId === "m2");
    expect(model?.count).toBe(2);
  });

  it("never seeds an unresolvable default; falls back to the first resolvable member", () => {
    // A required group whose default id is not a materialized child (e.g. a
    // dangling/cross-file link the parser could not inline). The old behavior
    // seeded the ghost id verbatim, which then crashed evaluate() with
    // "Unknown entryId". The guard must instead seed the first real member.
    const ghostCat: IrCatalogue = {
      ...defCat,
      entries: [{
        ...defCat.entries[0]!,
        groups: [
          { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"], defaultMemberEntryId: "ghost.id",
            constraints: [{ id: "gw.min", type: "min", value: 1 }, { id: "gw.max", type: "max", value: 1 }] },
        ],
      }],
    };
    const r = addUnit(createRoster(ghostCat, 2000), "u", ghostCat);
    const kids = r.selections[0]!.selections.map((s) => s.entryId);
    expect(kids).not.toContain("ghost.id"); // no unresolvable id injected
    expect(kids).toContain("w.sword"); // fell back to the first resolvable member
  });

  it("seeds nothing when a required group has no resolvable member at all", () => {
    // Required group whose default AND every member id are absent from children
    // (e.g. all links dangled). No valid seed exists → seed nothing (no crash).
    const allGhostCat: IrCatalogue = {
      ...defCat,
      entries: [{
        ...defCat.entries[0]!,
        children: [], // nothing materialized
        groups: [
          { id: "gw", name: "Weapon", memberEntryIds: ["ghost.a", "ghost.b"], defaultMemberEntryId: "ghost.a",
            constraints: [{ id: "gw.min", type: "min", value: 1 }, { id: "gw.max", type: "max", value: 1 }] },
        ],
      }],
    };
    const r = addUnit(createRoster(allGhostCat, 2000), "u", allGhostCat);
    expect(r.selections[0]!.selections).toEqual([]);
  });

  it("seeds nothing for an optional group whose default is unresolvable", () => {
    const optGhostCat: IrCatalogue = {
      ...defCat,
      entries: [{
        ...defCat.entries[0]!,
        groups: [
          { id: "gw", name: "Weapon", memberEntryIds: ["w.sword", "w.axe"], defaultMemberEntryId: "ghost.id",
            constraints: [{ id: "gw.max", type: "max", value: 1 }] },
        ],
      }],
    };
    const r = addUnit(createRoster(optGhostCat, 2000), "u", optGhostCat);
    const kids = r.selections[0]!.selections.map((s) => s.entryId);
    expect(kids).not.toContain("ghost.id");
    expect(kids).not.toContain("w.sword"); // optional + no valid default → seed nothing
  });
});
