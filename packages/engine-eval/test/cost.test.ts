import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildState, totalCost, pointsCost, nodePoints, costOfType } from "@muster/engine-eval";
import type { CostFn } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [
    { id: "e.squad", name: "Squad", costs: [{ name: "points", value: 100 }], categories: [], constraints: [],
      children: [{ id: "e.gun", name: "Gun", costs: [{ name: "points", value: 5 }], categories: [], constraints: [], children: [] }] },
  ],
};

describe("pointsCost / nodePoints cost-name resolution", () => {
  const entry = (costs: { name: string; value: number }[]) => ({
    id: "e", name: "E", costs, categories: [], constraints: [], children: [],
  });

  it("matches the real-catalogue \"pts\" cost name", () => {
    expect(pointsCost(entry([{ name: "pts", value: 80 }]))?.value).toBe(80);
  });

  it("still matches the mini-fixture \"points\" cost name", () => {
    expect(pointsCost(entry([{ name: "points", value: 100 }]))?.value).toBe(100);
  });

  it("prefers \"pts\" over a zero-valued \"points\" (real catalogues carry both)", () => {
    const e = entry([{ name: "pts", value: 95 }, { name: "points", value: 0 }]);
    expect(pointsCost(e)?.value).toBe(95);
    const node = { entry: e, effectiveCount: 2 } as never;
    expect(nodePoints(node)).toBe(190);
  });

  it("returns undefined / 0 when neither name is present", () => {
    expect(pointsCost(entry([{ name: "Crusade: Experience", value: 3 }]))).toBeUndefined();
    const node = { entry: entry([]), effectiveCount: 1 } as never;
    expect(nodePoints(node)).toBe(0);
  });
});

describe("totalCost", () => {
  it("multiplies costs by effectiveCount through the tree", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [
        { id: "s.squad", entryId: "e.squad", count: 2,
          selections: [{ id: "s.gun", entryId: "e.gun", count: 3, selections: [] }] },
      ],
    };
    // squad: 100 * 2 = 200; gun: 5 * (3 * 2) = 30 => 230
    const state = buildState(roster, cat);
    expect(totalCost(state)).toBe(230);
  });

  it("is 0 for an empty roster", () => {
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000, selections: [],
    };
    expect(totalCost(buildState(roster, cat))).toBe(0);
  });
});

describe("costOfType", () => {
  // The raw, modifier-blind lookup: callers that intentionally want the static
  // declared value (e.g. an unpicked option's preview badge) use this instead of
  // resolve.ts's effectiveCostOfType, which applies cost modifiers.
  it("sums a named cost type scaled by effectiveCount", () => {
    const node = {
      entry: { id: "e", name: "E", costs: [{ name: "Enhancements", value: 15 }], categories: [], constraints: [], children: [] },
      effectiveCount: 2,
    } as never;
    expect(costOfType(node, "Enhancements")).toBe(30);
  });

  it("is 0 when the entry carries no cost of that name", () => {
    const node = {
      entry: { id: "e", name: "E", costs: [], categories: [], constraints: [], children: [] },
      effectiveCount: 1,
    } as never;
    expect(costOfType(node, "Detachment Points")).toBe(0);
  });

  it("does NOT apply cost modifiers — reads the raw declared value only", () => {
    const node = {
      entry: {
        id: "e", name: "E", categories: [], constraints: [], children: [],
        costs: [{ name: "Detachment Points", value: 2, modifiers: [{ id: "m", type: "set", value: 3, conditions: [] }] }],
      },
      effectiveCount: 1,
    } as never;
    expect(costOfType(node, "Detachment Points")).toBe(2);
  });
});

describe("totalCost with an injected cost view", () => {
  it("uses the provided CostFn instead of raw cost", () => {
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "s.squad", entryId: "e.squad", count: 2, selections: [] }],
    };
    const state = buildState(roster, cat);
    const flat: CostFn = () => 7;
    expect(totalCost(state, flat)).toBe(7); // one node, view returns 7
    expect(totalCost(state)).toBe(200); // default = raw: squad 100 * 2
  });
});
