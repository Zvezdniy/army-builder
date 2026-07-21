import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrGroup } from "@muster/domain";
import {
  createRoster, availableUnits, addUnit, addOption, setCount, remove, optionsFor,
  selectedGroupMembers, toggleGroupMember, groupControl, optionControl, catalogueEntry,
  unitLoadout, availableDetachments, selectedDetachment, selectedDetachments, toggleDetachment, setPointsLimit,
  unitsByRole, detachmentSelectionIds, groupMemberCounts, groupTotal, setGroupMemberCount,
  invulnSave,
} from "./index";

const catalogue: IrCatalogue = {
  id: "cat", name: "Cat", gameSystemId: "gs", revision: 1,
  forceConstraints: [], categoryNames: {},
  entries: [
    {
      id: "e.captain", name: "Captain", costs: [{ name: "points", value: 90 }],
      categories: ["cat.hq"], constraints: [],
      children: [{ id: "e.bolter", name: "Bolter", costs: [], categories: [], constraints: [], children: [] }],
      groups: [{ id: "g.wpn", name: "Weapon", memberEntryIds: ["e.bolter"], constraints: [{ id: "gc", type: "max", value: 1, scope: "self" }] }],
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
        { id: "g.weapon", name: "Weapon", memberEntryIds: ["e.sword", "e.axe"], constraints: [{ id: "w.max", type: "max", value: 1, scope: "self" }] },
        { id: "g.trinket", name: "Trinket", memberEntryIds: ["e.shield", "e.cloak", "e.ring"], constraints: [{ id: "t.max", type: "max", value: 2, scope: "self" }] },
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
      constraints: [{ id: "r.min", type: "min", value: 1, scope: "self" }, { id: "r.max", type: "max", value: 1, scope: "self" }],
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

  it("a multi group (max > 1) can be emptied below its min — the engine reports the min", () => {
    // The original bug: a below-min group trapped the user (couldn't deselect). Only a
    // required single-choice radio holds its pick; multi/counted groups deselect freely.
    const minMulti: IrGroup = {
      id: "g.mm", name: "Trinket", memberEntryIds: ["e.shield", "e.cloak", "e.ring"],
      constraints: [{ id: "mm.min", type: "min", value: 2, scope: "self" }, { id: "mm.max", type: "max", value: 3, scope: "self" }],
    };
    const { r, heroId } = addHero();
    const r1 = toggleGroupMember(r, heroId, minMulti, "e.shield");
    const r2 = toggleGroupMember(r1, heroId, minMulti, "e.shield"); // below min 2 → still deselects
    expect(selectedGroupMembers(r2, heroId, minMulti)).toEqual([]);
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
      { id: "a", type: "min", value: 1, scope: "self" }, { id: "b", type: "max", value: 1, scope: "self" },
    ] })).toEqual({ kind: "single", required: true });
  });

  it("max 1 without a min is an optional single choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [
      { id: "b", type: "max", value: 1, scope: "self" },
    ] })).toEqual({ kind: "single", required: false });
  });

  it("max > 1 is an up-to-N multi choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [
      { id: "b", type: "max", value: 3, scope: "self" },
    ] })).toEqual({ kind: "multi", max: 3 });
  });

  it("no max at all is an unbounded multi choice", () => {
    expect(groupControl({ id: "g", name: "G", memberEntryIds: [], constraints: [] }))
      .toEqual({ kind: "multi", max: Infinity });
  });

  it("max > 1 with repeatable (stepper) members is a counted distribution", () => {
    const members = [entryWith([makeConstraint("mx", "max", 9)])];
    expect(groupControl({ id: "g", name: "G", memberEntryIds: ["e"], constraints: [
      { id: "mn", type: "min", value: 4, scope: "self" }, { id: "mx", type: "max", value: 9, scope: "self" },
    ] }, members)).toEqual({ kind: "counted", min: 4, max: 9 });
  });

  it("counted also triggers on a fixed multiplicity above 1", () => {
    const members = [entryWith([makeConstraint("a", "min", 2), makeConstraint("b", "max", 2)])];
    expect(groupControl({ id: "g", name: "G", memberEntryIds: ["e"], constraints: [
      { id: "mx", type: "max", value: 5, scope: "self" },
    ] }, members)).toEqual({ kind: "counted", min: 0, max: 5 });
  });

  it("max > 1 with single-count members stays a multi toggle", () => {
    const members = [entryWith([makeConstraint("mx", "max", 1)])];
    expect(groupControl({ id: "g", name: "G", memberEntryIds: ["e"], constraints: [
      { id: "mx", type: "max", value: 3, scope: "self" },
    ] }, members)).toEqual({ kind: "multi", max: 3 });
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
        constraints: [{ id: "gw.min", type: "min", value: 1, scope: "self" }, { id: "gw.max", type: "max", value: 1, scope: "self" }] },
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
          constraints: [{ id: "gw.min", type: "min", value: 1, scope: "self" }, { id: "gw.max", type: "max", value: 1, scope: "self" }] },
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
          constraints: [{ id: "gw.max", type: "max", value: 1, scope: "self" }] },
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
                constraints: [{ id: "sub.gw.min", type: "min", value: 1, scope: "self" }, { id: "sub.gw.max", type: "max", value: 1, scope: "self" }] },
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
            constraints: [{ id: "gw.min", type: "min", value: 1, scope: "self" }, { id: "gw.max", type: "max", value: 1, scope: "self" }] },
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
            constraints: [{ id: "gw.min", type: "min", value: 1, scope: "self" }, { id: "gw.max", type: "max", value: 1, scope: "self" }] },
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
            constraints: [{ id: "gw.max", type: "max", value: 1, scope: "self" }] },
        ],
      }],
    };
    const r = addUnit(createRoster(optGhostCat, 2000), "u", optGhostCat);
    const kids = r.selections[0]!.selections.map((s) => s.entryId);
    expect(kids).not.toContain("ghost.id");
    expect(kids).not.toContain("w.sword"); // optional + no valid default → seed nothing
  });
});

// A counted-distribution unit: a fixed leader plus a "4-9" group whose members are
// repeatable models (per-member max), mirroring Wolf Guard Terminators.
function memberMax(id: string, value: number) {
  return { id: `${id}.max`, type: "max" as const, value, field: "selections" as const,
    scope: "parent" as const, targetType: "entry" as const, targetId: id, includeChildSelections: false };
}
const unitProfile = [{ name: "Body", typeName: "Unit", characteristics: [] }];
const countedCat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "g", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "u", name: "Squad", costs: [], categories: [], constraints: [],
    children: [
      { id: "leader", name: "Leader", costs: [], categories: [],
        constraints: [
          { id: "leader.min", type: "min", value: 1, field: "selections", scope: "self", targetType: "entry", targetId: "leader", includeChildSelections: false },
          { id: "leader.max", type: "max", value: 1, field: "selections", scope: "self", targetType: "entry", targetId: "leader", includeChildSelections: false },
        ], children: [], profiles: unitProfile },
      { id: "bolter", name: "w/ bolter", costs: [], categories: [], constraints: [memberMax("bolter", 9)], children: [], profiles: unitProfile },
      { id: "shield", name: "w/ shield", costs: [], categories: [], constraints: [memberMax("shield", 2)], children: [], profiles: unitProfile },
    ],
    groups: [
      { id: "g4", name: "4-9 Bodies", memberEntryIds: ["bolter", "shield"], defaultMemberEntryId: "bolter",
        constraints: [{ id: "g4.min", type: "min", value: 4, scope: "self" }, { id: "g4.max", type: "max", value: 9, scope: "self" }] },
    ],
  }],
};
const countedGroup = countedCat.entries[0]!.groups![0]!;

describe("counted group members", () => {
  function seed() {
    const r = addUnit(createRoster(countedCat, 2000), "u", countedCat);
    return { r, uId: r.selections[0]!.id };
  }

  it("addUnit seeds the counted group's default member up to the group minimum", () => {
    const { r, uId } = seed();
    expect(groupMemberCounts(r, uId, countedGroup).get("bolter")).toBe(4);
    expect(groupTotal(r, uId, countedGroup)).toBe(4);
    // seeded as 4 distinct one-each model selections (not one count-4 node)
    const bolters = r.selections[0]!.selections.filter((s) => s.entryId === "bolter");
    expect(bolters).toHaveLength(4);
    expect(bolters.every((b) => b.count === 1)).toBe(true);
    // the fixed leader is seeded separately (not part of the group)
    expect(r.selections[0]!.selections.find((s) => s.entryId === "leader")?.count).toBe(1);
  });

  it("seeds only up to the member's own max when it is below the group minimum", () => {
    // default member max 2 < group min 4 → seed 2 (the member cap wins)
    const cappedCat: IrCatalogue = {
      ...countedCat,
      entries: [{ ...countedCat.entries[0]!, groups: [{ ...countedGroup, defaultMemberEntryId: "shield" }] }],
    };
    const r = addUnit(createRoster(cappedCat, 2000), "u", cappedCat);
    expect(groupMemberCounts(r, r.selections[0]!.id, countedGroup).get("shield")).toBe(2);
  });

  it("groupMemberCounts and groupTotal are empty for an unknown selection", () => {
    const { r } = seed();
    expect(groupMemberCounts(r, "nope", countedGroup).size).toBe(0);
    expect(groupTotal(r, "nope", countedGroup)).toBe(0);
  });

  it("setGroupMemberCount materializes an absent member (seeded with its own subtree)", () => {
    const { r, uId } = seed();
    const r1 = setGroupMemberCount(r, uId, countedGroup, "shield", 2, countedCat);
    expect(groupMemberCounts(r1, uId, countedGroup).get("shield")).toBe(2);
    expect(groupTotal(r1, uId, countedGroup)).toBe(6);
  });

  it("setGroupMemberCount grows a present member to the requested model count", () => {
    const { r, uId } = seed();
    const r1 = setGroupMemberCount(r, uId, countedGroup, "bolter", 7, countedCat);
    expect(groupMemberCounts(r1, uId, countedGroup).get("bolter")).toBe(7);
    // stored as 7 distinct one-each model selections (not one count-7 node), so each
    // model keeps its own per-model loadout
    const bolters = r1.selections[0]!.selections.filter((s) => s.entryId === "bolter");
    expect(bolters).toHaveLength(7);
    expect(bolters.every((b) => b.count === 1)).toBe(true);
  });

  it("setGroupMemberCount shrinks a present member by dropping surplus models", () => {
    const { r, uId } = seed(); // starts at 4 bolters
    const r1 = setGroupMemberCount(r, uId, countedGroup, "bolter", 2, countedCat);
    expect(groupMemberCounts(r1, uId, countedGroup).get("bolter")).toBe(2);
    expect(r1.selections[0]!.selections.filter((s) => s.entryId === "bolter")).toHaveLength(2);
  });

  it("setGroupMemberCount removes a member at count 0", () => {
    const { r, uId } = seed();
    const r1 = setGroupMemberCount(r, uId, countedGroup, "bolter", 0, countedCat);
    expect(groupMemberCounts(r1, uId, countedGroup).has("bolter")).toBe(false);
    expect(groupTotal(r1, uId, countedGroup)).toBe(0);
  });

  it("setGroupMemberCount is a no-op when removing an already-absent member", () => {
    const { r, uId } = seed();
    expect(setGroupMemberCount(r, uId, countedGroup, "shield", 0, countedCat)).toBe(r);
  });

  it("setGroupMemberCount ignores an entry that is not a group member", () => {
    const { r, uId } = seed();
    expect(setGroupMemberCount(r, uId, countedGroup, "leader", 3, countedCat)).toBe(r);
  });

  it("setGroupMemberCount is a no-op for an unknown parent selection", () => {
    const { r } = seed();
    expect(setGroupMemberCount(r, "nope", countedGroup, "bolter", 2, countedCat)).toBe(r);
  });

  it("setGroupMemberCount is a no-op when appending an unresolvable member", () => {
    // A group member whose id is not in the catalogue (dangling link): never inject an
    // unresolvable entryId — it would crash datasheet()/evaluate() lookups. No-op instead.
    const ghostGroup: IrGroup = { ...countedGroup, memberEntryIds: [...countedGroup.memberEntryIds, "ghost"] };
    const ghostCat: IrCatalogue = {
      ...countedCat,
      entries: [{ ...countedCat.entries[0]!, groups: [ghostGroup] }],
    };
    const r = addUnit(createRoster(ghostCat, 2000), "u", ghostCat);
    expect(setGroupMemberCount(r, r.selections[0]!.id, ghostGroup, "ghost", 3, ghostCat)).toBe(r);
  });

  it("seeds a counted member with its own min>=2 as one-each model instances (count:1)", () => {
    // A repeatable member carrying its own min>=2 is still counted; each seeded model
    // must be count:1 (N distinct nodes), else nested per-model wargear re-inflates.
    const minMemberCat: IrCatalogue = {
      ...countedCat,
      entries: [{
        ...countedCat.entries[0]!,
        children: [
          countedCat.entries[0]!.children[0]!, // leader
          { id: "bolter", name: "w/ bolter", costs: [], categories: [],
            constraints: [
              { id: "bolter.min", type: "min", value: 2, field: "selections", scope: "parent", targetType: "entry", targetId: "bolter", includeChildSelections: false },
              memberMax("bolter", 9),
            ], children: [], profiles: unitProfile },
          countedCat.entries[0]!.children[2]!, // shield
        ],
      }],
    };
    const r = addUnit(createRoster(minMemberCat, 2000), "u", minMemberCat);
    const bolters = r.selections[0]!.selections.filter((s) => s.entryId === "bolter");
    expect(bolters).toHaveLength(4); // seeded to group min, as distinct nodes
    expect(bolters.every((b) => b.count === 1)).toBe(true); // each is one model, not count-2
  });
});

// 10e shape: the root Detachment's own "Detachment" group is capped at max 1
// (matched play: exactly one detachment) — toggleDetachment must swap.
const detCat: IrCatalogue = {
  id: "cat", name: "Cat", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    { id: "e.captain", name: "Captain", type: "unit", costs: [], categories: ["cat.hq"], constraints: [], children: [] },
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "Gladius Task Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Anvil Siege Force", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
      ],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"],
        constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" }, { id: "gc.max", type: "max", value: 1, scope: "self" }],
      }],
    },
  ],
};

// 11e shape: same names/options, but the Detachment group carries only `min 1`
// — the `max` is gone, replaced by a Detachment Points budget elsewhere — so
// toggleDetachment must accumulate instead of swap.
const detCat11e: IrCatalogue = {
  ...detCat,
  entries: detCat.entries.map((e) =>
    e.id !== "e.det" ? e : {
      ...e,
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"],
        constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" }],
      }],
    },
  ),
};

// Naming-variant shapes seen in real BSData. Custodes/Votann name the ROOT ENTRY
// differently ("Detachments" / "Detachment Choice"); Mechanicus names the root's
// GROUP "Detachments". All are otherwise 11e-shaped (min 1, DP-priced options), so
// detachments must be available and must accumulate.
const dpCost = [{ name: "Detachment Points", value: 2 }];
const detCatCustodes: IrCatalogue = {
  ...detCat,
  entries: [
    detCat.entries[0]!,
    {
      id: "e.det", name: "Detachments", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "Shield Host", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Auric Champions", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
      ],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"],
        constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" }],
      }],
    },
  ],
};
// Votann: the ROOT ENTRY is named "Detachment Choice" — the third, most literal-fragile
// regex branch, and a shape that occurs in real production data (leagues-of-votann 11e).
const detCatVotann: IrCatalogue = {
  ...detCat,
  entries: [
    detCat.entries[0]!,
    {
      id: "e.det", name: "Detachment Choice", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "Hearthband", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Oathband", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
      ],
      groups: [{
        id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius", "e.anvil"],
        constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" }],
      }],
    },
  ],
};
// Mechanicus: root "Detachment" but GROUP "Detachments" (plural). min 1 only → accumulate.
const detCatMech: IrCatalogue = {
  ...detCat,
  entries: [
    detCat.entries[0]!,
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "Rad-zone Corps", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Explorator Maniple", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
      ],
      groups: [{
        id: "g.det", name: "Detachments", memberEntryIds: ["e.gladius", "e.anvil"],
        constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" }],
      }],
    },
  ],
};
// DP-priced root with NO modelled group at all → synthetic fallback must omit the max.
const detCatBudgetedNoGroup: IrCatalogue = {
  ...detCat,
  entries: [
    detCat.entries[0]!,
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [
        { id: "e.gladius", name: "One", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
        { id: "e.anvil", name: "Two", type: "upgrade", costs: dpCost, categories: [], constraints: [], children: [] },
      ],
      // no groups
    },
  ],
};

describe("detachment naming variants (real BSData shapes)", () => {
  it("finds the root when the entry is named 'Detachments' (Custodes)", () => {
    expect(availableDetachments(detCatCustodes).map((d) => d.id)).toEqual(["e.gladius", "e.anvil"]);
    // Exercise the group-resolution path end-to-end for a plural-root shape too.
    let r = toggleDetachment(createRoster(detCatCustodes, 2000), "e.gladius", detCatCustodes);
    r = toggleDetachment(r, "e.anvil", detCatCustodes);
    expect(selectedDetachments(r, detCatCustodes)).toEqual(["e.gladius", "e.anvil"]);
  });

  it("finds the root when the entry is named 'Detachment Choice' (Votann)", () => {
    expect(availableDetachments(detCatVotann).map((d) => d.id)).toEqual(["e.gladius", "e.anvil"]);
    let r = toggleDetachment(createRoster(detCatVotann, 2000), "e.gladius", detCatVotann);
    r = toggleDetachment(r, "e.anvil", detCatVotann);
    expect(selectedDetachments(r, detCatVotann)).toEqual(["e.gladius", "e.anvil"]);
  });

  it("accumulates when the root's group is named 'Detachments' (Mechanicus)", () => {
    let r = toggleDetachment(createRoster(detCatMech, 2000), "e.gladius", detCatMech);
    r = toggleDetachment(r, "e.anvil", detCatMech);
    expect(r.selections.filter((s) => s.entryId === "e.det")).toHaveLength(1);
    expect(selectedDetachments(r, detCatMech)).toEqual(["e.gladius", "e.anvil"]);
  });

  it("the synthetic fallback accumulates for a DP-budgeted group-less root", () => {
    let r = toggleDetachment(createRoster(detCatBudgetedNoGroup, 2000), "e.gladius", detCatBudgetedNoGroup);
    r = toggleDetachment(r, "e.anvil", detCatBudgetedNoGroup);
    expect(selectedDetachments(r, detCatBudgetedNoGroup)).toEqual(["e.gladius", "e.anvil"]);
  });

  it("the synthetic fallback still swaps (max 1) for an unpriced 10e group-less root", () => {
    const cat10 = {
      ...detCatBudgetedNoGroup,
      entries: [
        detCat.entries[0]!,
        {
          ...detCatBudgetedNoGroup.entries[1]!,
          children: detCatBudgetedNoGroup.entries[1]!.children.map((c) => ({ ...c, costs: [] })),
        },
      ],
    };
    let r = toggleDetachment(createRoster(cat10, 2000), "e.gladius", cat10);
    r = toggleDetachment(r, "e.anvil", cat10);
    expect(selectedDetachments(r, cat10)).toEqual(["e.anvil"]); // swapped, not accumulated
  });
});

describe("detachment + points-limit API", () => {
  it("availableDetachments lists the root Detachment's option children", () => {
    expect(availableDetachments(detCat).map((d) => d.id)).toEqual(["e.gladius", "e.anvil"]);
  });

  it("availableDetachments is empty when the catalogue models no detachment", () => {
    expect(availableDetachments(catalogue)).toEqual([]);
  });

  it("toggleDetachment adds one Detachment selection holding the chosen option", () => {
    const r = toggleDetachment(createRoster(detCat, 2000), "e.gladius", detCat);
    const roots = r.selections.filter((s) => s.entryId === "e.det");
    expect(roots).toHaveLength(1);
    expect(roots[0]!.selections.map((s) => s.entryId)).toEqual(["e.gladius"]);
    expect(selectedDetachments(r, detCat)).toEqual(["e.gladius"]);
    expect(selectedDetachment(r, detCat)).toBe("e.gladius");
  });

  it("toggleDetachment on a max-1 (10e) group swaps the option without leaving a duplicate", () => {
    let r = toggleDetachment(createRoster(detCat, 2000), "e.gladius", detCat);
    r = toggleDetachment(r, "e.anvil", detCat);
    expect(r.selections.filter((s) => s.entryId === "e.det")).toHaveLength(1);
    expect(selectedDetachments(r, detCat)).toEqual(["e.anvil"]);
  });

  // Restored after D3's review: this coverage was dropped on the belief that the
  // group-driven path filters unknown ids, but toggleGroupMember only uses
  // memberEntryIds to COUNT existing members — an id absent from the catalogue is
  // still recorded, which is what an imported roster or a stale catalogue needs.
  it("toggleDetachment on an option id absent from the catalogue still records the choice", () => {
    const r = toggleDetachment(createRoster(detCat, 2000), "e.unknown", detCat);
    expect(selectedDetachments(r, detCat)).toEqual(["e.unknown"]);
  });

  it("toggleDetachment on a max-1 (10e) required group keeps its sole pick (no empty radio)", () => {
    const r = toggleDetachment(createRoster(detCat, 2000), "e.gladius", detCat);
    const r2 = toggleDetachment(r, "e.gladius", detCat); // toggling the sole pick again
    expect(selectedDetachments(r2, detCat)).toEqual(["e.gladius"]);
  });

  it("toggleDetachment on a no-max (11e) group accumulates in selection order", () => {
    let r = toggleDetachment(createRoster(detCat11e, 2000), "e.gladius", detCat11e);
    r = toggleDetachment(r, "e.anvil", detCat11e);
    expect(r.selections.filter((s) => s.entryId === "e.det")).toHaveLength(1); // root created once
    expect(selectedDetachments(r, detCat11e)).toEqual(["e.gladius", "e.anvil"]);
    expect(selectedDetachment(r, detCat11e)).toBe("e.gladius"); // first-of wrapper
  });

  it("toggleDetachment on a no-max (11e) group removes an already-selected detachment", () => {
    let r = toggleDetachment(createRoster(detCat11e, 2000), "e.gladius", detCat11e);
    r = toggleDetachment(r, "e.anvil", detCat11e);
    r = toggleDetachment(r, "e.gladius", detCat11e); // deselect the first
    expect(selectedDetachments(r, detCat11e)).toEqual(["e.anvil"]);
  });

  it("the root Detachment selection is created once and reused, never duplicated", () => {
    let r = toggleDetachment(createRoster(detCat11e, 2000), "e.gladius", detCat11e);
    r = toggleDetachment(r, "e.gladius", detCat11e); // remove
    r = toggleDetachment(r, "e.anvil", detCat11e); // add again
    expect(r.selections.filter((s) => s.entryId === "e.det")).toHaveLength(1);
  });

  it("detachmentSelectionIds returns the detachment root subtree, empty otherwise", () => {
    const chosen = toggleDetachment(createRoster(detCat, 2000), "e.gladius", detCat);
    const ids = detachmentSelectionIds(chosen, detCat);
    const rootSel = chosen.selections.find((s) => s.entryId === "e.det")!;
    expect(ids.has(rootSel.id)).toBe(true); // the Detachment root
    expect(ids.has(rootSel.selections[0]!.id)).toBe(true); // the chosen option under it
    expect(ids.size).toBe(2);
    // No detachment chosen → empty; catalogue without a detachment root → empty.
    expect(detachmentSelectionIds(createRoster(detCat, 2000), detCat).size).toBe(0);
    expect(detachmentSelectionIds(createRoster(catalogue, 2000), catalogue).size).toBe(0);
  });

  it("detachmentSelectionIds covers several selected detachments (11e)", () => {
    let r = toggleDetachment(createRoster(detCat11e, 2000), "e.gladius", detCat11e);
    r = toggleDetachment(r, "e.anvil", detCat11e);
    const ids = detachmentSelectionIds(r, detCat11e);
    const rootSel = r.selections.find((s) => s.entryId === "e.det")!;
    expect(ids.has(rootSel.id)).toBe(true);
    for (const child of rootSel.selections) expect(ids.has(child.id)).toBe(true);
    expect(ids.size).toBe(3); // root + 2 chosen detachments
  });

  it("toggleDetachment falls back to an implicit max-1 group when the root models no explicit Detachment group", () => {
    const catNoGroup: IrCatalogue = {
      ...detCat,
      entries: detCat.entries.map((e) => (e.id !== "e.det" ? e : { ...e, groups: undefined })),
    };
    let r = toggleDetachment(createRoster(catNoGroup, 2000), "e.gladius", catNoGroup);
    r = toggleDetachment(r, "e.anvil", catNoGroup);
    expect(selectedDetachments(r, catNoGroup)).toEqual(["e.anvil"]); // swapped, not accumulated
  });

  it("toggleDetachment is a no-op when the catalogue models no detachment", () => {
    const r = createRoster(catalogue, 2000);
    expect(toggleDetachment(r, "whatever", catalogue)).toBe(r);
  });

  it("selectedDetachment is undefined before any choice", () => {
    expect(selectedDetachment(createRoster(detCat, 2000), detCat)).toBeUndefined();
  });

  it("selectedDetachments is empty before any choice", () => {
    expect(selectedDetachments(createRoster(detCat, 2000), detCat)).toEqual([]);
  });

  it("selectedDetachment is undefined when the catalogue models no detachment", () => {
    expect(selectedDetachment(createRoster(catalogue, 2000), catalogue)).toBeUndefined();
  });

  it("selectedDetachment is undefined when the Detachment selection holds no option", () => {
    const base = createRoster(detCat, 2000);
    const r = { ...base, selections: [{ id: "x", entryId: "e.det", count: 1, selections: [] }] };
    expect(selectedDetachment(r, detCat)).toBeUndefined();
  });

  it("toggleDetachment stores the option as a bare selection (no seeded children)", () => {
    const r = toggleDetachment(createRoster(detCat, 2000), "e.gladius", detCat);
    const root = r.selections.find((s) => s.entryId === "e.det")!;
    expect(root.selections).toHaveLength(1);
    expect(root.selections[0]!.selections).toEqual([]);
  });

  it("availableUnits excludes the detachment root (added via the wizard, not the picker)", () => {
    expect(availableDetachments(detCat)).not.toHaveLength(0); // sanity: this catalogue models detachments
    const ids = availableUnits(detCat).map((e) => e.id);
    expect(ids).toContain("e.captain");
    expect(ids).not.toContain("e.det");
  });

  it("unitsByRole excludes the detachment root (it is army-level, not a unit)", () => {
    let r = addUnit(createRoster(detCat, 2000), "e.captain", detCat);
    r = toggleDetachment(r, "e.gladius", detCat);
    const roles = unitsByRole(r, detCat);
    const allUnits = roles.flatMap((g) => g.units.map((u) => u.entryId));
    expect(allUnits).toContain("e.captain");
    expect(allUnits).not.toContain("e.det");
  });

  it("setPointsLimit changes the army's points limit", () => {
    expect(setPointsLimit(createRoster(detCat, 2000), 1000).pointsLimit).toBe(1000);
  });
});

describe("invulnSave", () => {
  // Minimal catalogue builders local to this block.
  const prof = (typeName: string, name: string, chars: Record<string, string> = {}) => ({
    name, typeName,
    characteristics: Object.entries(chars).map(([n, value]) => ({ name: n, value })),
  });
  const unitProf = prof("Unit", "Body", { M: "6\"", T: "4", Sv: "3+" });

  // Build a one-catalogue world with a root unit entry + optional wargear children.
  function world(rootProfiles: any[], children: { profiles: any[] }[] = []) {
    const kidEntries = children.map((c, i) => ({
      id: `w${i}`, name: `w${i}`, costs: [], categories: [], constraints: [], children: [],
      profiles: c.profiles,
    }));
    const root = {
      id: "root", name: "Unit", costs: [], categories: [], constraints: [],
      children: kidEntries, profiles: rootProfiles,
    };
    const catalogue: any = {
      id: "c", name: "c", gameSystemId: "g", revision: 1, entries: [root],
    };
    const selection: any = {
      id: "s", entryId: "root", count: 1,
      selections: kidEntries.map((k) => ({ id: `sel-${k.id}`, entryId: k.id, count: 1, selections: [] })),
    };
    return { catalogue, selection };
  }

  it("class 1: dedicated Invulnerable Save section resolves, bare", () => {
    const { catalogue, selection } = world([unitProf, prof("Invulnerable Save", "Invulnerable Save", { "": "4+" })]);
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Invulnerable Save", bare: true });
  });

  it("class 2: ability named Invulnerable Save on the root is trusted (Logan shape)", () => {
    const { catalogue, selection } = world([
      unitProf,
      prof("Abilities", "Invulnerable Save", { Description: "4+" }),
    ]);
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Invulnerable Save", bare: true });
  });

  it("class 3: storm-shield wargear grants an invuln, not bare", () => {
    const { catalogue, selection } = world(
      [unitProf],
      [{ profiles: [prof("Abilities", "Storm Shield", { Description: "The bearer has a 4+ invulnerable save." })] }],
    );
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Storm Shield", bare: false });
  });

  it("false positive: invuln-phrased faction rule on the ROOT (Veil-of-Ancients shape) is NOT surfaced", () => {
    const { catalogue, selection } = world([
      unitProf,
      prof("Abilities", "Veil of Ancients", { Description: "The bearer has a 4+ invulnerable save." }),
    ]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });

  it("best-of: a 4+ storm shield beats a 5+ named ability", () => {
    const { catalogue, selection } = world(
      [unitProf, prof("Abilities", "Invulnerable Save", { Description: "5+" })],
      [{ profiles: [prof("Abilities", "Storm Shield", { Description: "The bearer has a 4+ invulnerable save." })] }],
    );
    expect(invulnSave(catalogue, selection)?.value).toBe("4+");
  });

  it("no invuln → undefined", () => {
    const { catalogue, selection } = world([unitProf, prof("Abilities", "Oath of Moment", { Description: "Re-roll hits." })]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });

  // Extra cases beyond the brief, added to keep the package's 100%-branch-coverage
  // gate green (baseline was 100% before this feature; `pnpm --filter @muster/roster
  // test` runs the full suite with coverage enforced, not just this file).

  it("class 1 with a missing characteristic value contributes no candidate", () => {
    const { catalogue, selection } = world([unitProf, prof("Invulnerable Save", "Invulnerable Save", {})]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });

  it("class 1 with a non-numeric characteristic value contributes no candidate", () => {
    const { catalogue, selection } = world([unitProf, prof("Invulnerable Save", "Invulnerable Save", { "": "N/A" })]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });

  it("Abilities profile with no Description characteristic is ignored", () => {
    const { catalogue, selection } = world([unitProf, prof("Abilities", "Random Ability", {})]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });

  it("tie-break on rank: bare dedicated-section candidate beats a same-value wargear candidate", () => {
    const { catalogue, selection } = world(
      [unitProf, prof("Invulnerable Save", "Invulnerable Save", { "": "4+" })],
      [{ profiles: [prof("Abilities", "Storm Shield", { Description: "The bearer has a 4+ invulnerable save." })] }],
    );
    expect(invulnSave(catalogue, selection)).toEqual({ value: "4+", sourceName: "Invulnerable Save", bare: true });
  });

  it("tie-break on rank+bare: named candidate beats a same-value wargear candidate", () => {
    const { catalogue, selection } = world(
      [unitProf, prof("Abilities", "Invulnerable Save (Ranged)", { Description: "The bearer has a 4+ invulnerable save." })],
      [{ profiles: [prof("Abilities", "Storm Shield", { Description: "The bearer has a 4+ invulnerable save." })] }],
    );
    expect(invulnSave(catalogue, selection)?.sourceName).toBe("Invulnerable Save (Ranged)");
  });

  it("a selected entry with no profiles field at all contributes no candidate", () => {
    const { catalogue, selection } = world([unitProf], [{ profiles: undefined as any }]);
    expect(invulnSave(catalogue, selection)).toBeUndefined();
  });
});

describe("addOption/toggleGroupMember seed required children", () => {
  // Option "mount" has a mandatory child "shield" (min:1). "shield" itself has a
  // mandatory grandchild "gem" (min:1). Option "plain" has an optional child only.
  // A choose-1 required group under "banner" seeds its default member.
  const req = (id: string, extra: any = {}) => ({
    id, name: id, costs: [], categories: [],
    constraints: [{ id: `${id}.min`, type: "min", value: 1, field: "selections", scope: "parent" },
                  { id: `${id}.max`, type: "max", value: 1, field: "selections", scope: "parent" }],
    children: [], ...extra,
  });
  const opt = (id: string, extra: any = {}) => ({
    id, name: id, costs: [], categories: [], constraints: [], children: [], ...extra,
  });

  const cat: IrCatalogue = {
    id: "cat", name: "Cat", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
    entries: [
      {
        id: "hero", name: "Hero", costs: [], categories: [], constraints: [],
        children: [
          // pickable option carrying a required child, which carries a required grandchild
          opt("mount", { children: [ req("shield", { children: [ req("gem") ] }) ] }),
          // pickable option with only an OPTIONAL child (no min) → seeds nothing
          opt("plain", { children: [ opt("trinket") ] }),
          // pickable option with a required choose-1 group (default member seeded)
          opt("banner", {
            children: [ opt("gold"), opt("silver") ],
            groups: [{ id: "g.col", name: "Colour", memberEntryIds: ["gold", "silver"],
                       defaultMemberEntryId: "gold",
                       constraints: [{ id: "gc.min", type: "min", value: 1, scope: "self" },
                                     { id: "gc.max", type: "max", value: 1, scope: "self" }] }],
          }),
        ],
        groups: [{ id: "g.mount", name: "Mount", memberEntryIds: ["mount"],
                   constraints: [{ id: "gm.max", type: "max", value: 1, scope: "self" }] }],
      },
    ],
  };
  const mountGroup = cat.entries[0]!.groups![0]!;

  const withHero = () => {
    const r = addUnit(createRoster(cat, 2000), "hero", cat);
    return { r, heroId: r.selections[r.selections.length - 1]!.id };
  };
  const childrenOf = (sel: any, entryId: string) =>
    sel.selections.find((c: any) => c.entryId === entryId)?.selections ?? [];

  it("addOption seeds a picked option's required child (and recurses to the grandchild)", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "mount", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    const shield = childrenOf(hero, "mount");
    expect(shield.map((c: any) => c.entryId)).toEqual(["shield"]);
    expect(shield[0].selections.map((c: any) => c.entryId)).toEqual(["gem"]); // grandchild seeded
  });

  it("addOption seeds a required choose-1 group's default member", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "banner", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "banner").map((c: any) => c.entryId)).toEqual(["gold"]);
  });

  it("addOption seeds nothing for an option with only optional children", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "plain", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "plain")).toEqual([]);
    expect(childrenOf(hero, "nonexistent")).toEqual([]); // exercises the "no such child" fallback
  });

  it("toggleGroupMember seeds the added member's required children", () => {
    const { r, heroId } = withHero();
    const r2 = toggleGroupMember(r, heroId, mountGroup, "mount", cat);
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "mount").map((c: any) => c.entryId)).toEqual(["shield"]);
  });

  it("backward-compat: addOption WITHOUT a catalogue seeds nothing", () => {
    const { r, heroId } = withHero();
    const r2 = addOption(r, heroId, "mount"); // no catalogue arg
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "mount")).toEqual([]);
  });

  it("backward-compat: toggleGroupMember WITHOUT a catalogue seeds nothing", () => {
    const { r, heroId } = withHero();
    const r2 = toggleGroupMember(r, heroId, mountGroup, "mount"); // no catalogue arg
    const hero = r2.selections[r2.selections.length - 1]!;
    expect(childrenOf(hero, "mount")).toEqual([]);
  });
});
