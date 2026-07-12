import { describe, it, expect } from "vitest";
import type { IrCatalogue, Roster } from "@muster/domain";
import { buildState } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [
    { id: "e.squad", name: "Squad", costs: [], categories: ["cat.troops"], constraints: [],
      children: [{ id: "e.model", name: "Model", costs: [], categories: [], constraints: [], children: [] }] },
  ],
};

const roster: Roster = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
  selections: [
    { id: "s.squad", entryId: "e.squad", count: 2,
      selections: [{ id: "s.model", entryId: "e.model", count: 5, selections: [] }] },
  ],
};

describe("buildState", () => {
  it("computes multiplier and effectiveCount down the tree", () => {
    const state = buildState(roster, cat);
    const squad = state.roots[0]!;
    expect(squad.multiplier).toBe(1);
    expect(squad.effectiveCount).toBe(2);
    const model = squad.children[0]!;
    expect(model.multiplier).toBe(2); // ancestor squad count
    expect(model.effectiveCount).toBe(10); // 5 models * 2 squads
    expect(model.parent).toBe(squad);
    expect(state.all).toHaveLength(2);
  });

  it("throws on an unknown entryId", () => {
    const bad: Roster = { ...roster, selections: [{ id: "x", entryId: "nope", count: 1, selections: [] }] };
    expect(() => buildState(bad, cat)).toThrow(/unknown entryid/i);
  });
});

describe("buildState per-placement tree resolution", () => {
  // The SAME wargear id is inlined under two units with DIFFERENT costs (a
  // per-placement clone). Tree resolution must give each placement its own instance.
  const cat2 = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.a", name: "A", costs: [], categories: [], constraints: [],
        children: [{ id: "e.w", name: "W", costs: [{ name: "points", value: 3 }], categories: [], constraints: [], children: [] }] },
      { id: "e.b", name: "B", costs: [], categories: [], constraints: [],
        children: [{ id: "e.w", name: "W", costs: [{ name: "points", value: 5 }], categories: [], constraints: [], children: [] }] },
    ],
  } as unknown as IrCatalogue;

  const rosterUnder = (host: "e.a" | "e.b"): Roster => ({
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
    selections: [{ id: "u", entryId: host, count: 1,
      selections: [{ id: "w", entryId: "e.w", count: 1, selections: [] }] }],
  } as unknown as Roster);

  it("resolves a child to the instance under ITS parent (divergent same-id clones)", () => {
    const underA = buildState(rosterUnder("e.a"), cat2);
    const underB = buildState(rosterUnder("e.b"), cat2);
    const wA = underA.all.find((n) => n.entry.id === "e.w")!;
    const wB = underB.all.find((n) => n.entry.id === "e.w")!;
    expect(wA.entry.costs[0]!.value).toBe(3); // e.a's placement
    expect(wB.entry.costs[0]!.value).toBe(5); // e.b's placement
  });

  it("resolves a root selection from catalogue.entries", () => {
    const st = buildState(rosterUnder("e.a"), cat2);
    expect(st.roots[0]!.entry.id).toBe("e.a");
  });

  it("falls back to the flat index when a child is not under its parent", () => {
    // Roster nests e.a under e.a (e.a has no e.a child) → not found under parent →
    // flat fallback finds the top-level e.a. No throw.
    const weird: Roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "u", entryId: "e.a", count: 1,
        selections: [{ id: "x", entryId: "e.b", count: 1, selections: [] }] }],
    } as unknown as Roster;
    const st = buildState(weird, cat2);
    expect(st.all.find((n) => n.selectionId === "x")!.entry.id).toBe("e.b");
  });
});
