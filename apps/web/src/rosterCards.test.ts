import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { createRoster, toggleDetachment } from "@muster/roster";
import { unitBreakdowns } from "./rosterCards";

// hides an enhancement until its detachment is chosen — the gate enhancementsForDetachment reads.
const selGate = (detId: string) => ({
  set: true,
  conditionGroups: [{
    type: "and" as const,
    conditions: [{
      id: `cond.${detId}`, comparator: "lessThan" as const, value: 1,
      field: "selections" as const, scope: "roster", targetType: "entry" as const,
      targetId: detId, includeChildSelections: true,
    }],
  }],
});

const catalogue = {
  id: "c", name: "SW", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: { "cat.char": "Character" },
  entries: [
    {
      id: "e.det", name: "Detachment", type: "upgrade", costs: [], categories: [], constraints: [],
      children: [{ id: "e.gladius", name: "Gladius", type: "upgrade", costs: [], categories: [], constraints: [], children: [] }],
      groups: [{ id: "g.det", name: "Detachment", memberEntryIds: ["e.gladius"], constraints: [{ id: "gc", type: "max", value: 1, scope: "self" }] }],
    },
    {
      id: "e.lord", name: "Wolf Lord", type: "unit", costs: [{ name: "points", value: 100 }],
      categories: ["cat.char"], constraints: [], profiles: [{ name: "Body", typeName: "Unit", characteristics: [] }],
      children: [
        { id: "e.free", name: "Bolt pistol", type: "upgrade", costs: [], categories: [], constraints: [], children: [] },
        { id: "e.hammer", name: "Thunder hammer", type: "upgrade", costs: [{ name: "points", value: 10 }], categories: [], constraints: [], children: [] },
        { id: "e.relic", name: "Wolf Tooth", type: "upgrade", costs: [{ name: "points", value: 15 }], categories: [], constraints: [], children: [], visibilityModifiers: [selGate("e.gladius")] },
      ],
    },
  ],
} as unknown as IrCatalogue;

function roster(): Roster {
  let r = createRoster(catalogue, 2000, "SW");
  r = toggleDetachment(r, "e.gladius", catalogue);
  return { ...r, selections: [...r.selections, {
    id: "lord", entryId: "e.lord", count: 1, selections: [
      { id: "free", entryId: "e.free", count: 1, selections: [] },
      { id: "hammer", entryId: "e.hammer", count: 3, selections: [] },
      { id: "relic", entryId: "e.relic", count: 1, selections: [] },
    ],
  }] };
}

describe("unitBreakdowns", () => {
  const b = unitBreakdowns(roster(), catalogue).get("lord")!;

  it("sums the unit's own subtree points (unit + paid wargear + enhancement)", () => {
    expect(b.points).toBe(100 + 30 + 15); // 100 lord + 3×10 hammer + 15 relic
  });

  it("lists paid wargear with an aggregated count, omitting free default gear", () => {
    expect(b.wargear).toEqual([{ id: "e.hammer", name: "Thunder hammer", count: 3, points: 30 }]);
    expect(b.wargear.some((w) => w.name === "Bolt pistol")).toBe(false); // 0-point default omitted
  });

  it("lists enhancements separately from wargear", () => {
    expect(b.enhancements).toEqual([{ id: "e.relic", name: "Wolf Tooth", points: 15 }]);
    expect(b.wargear.some((w) => w.name === "Wolf Tooth")).toBe(false);
  });
});
