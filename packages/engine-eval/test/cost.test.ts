import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildState, totalCost, pointsCost, nodePoints } from "@muster/engine-eval";
import type { CostFn } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
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
