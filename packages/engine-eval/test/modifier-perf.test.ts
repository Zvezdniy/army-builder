import { describe, it, expect } from "vitest";
import type { IrCatalogue } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

const cat: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
  entries: [{
    id: "e.troop", name: "Troop", categories: ["cat.troops"], constraints: [], children: [],
    costs: [{ name: "points", value: 10, modifiers: [
      { id: "bulk", type: "decrement", value: 1, conditions: [{ id: "a", comparator: "atLeast", value: 10, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false }] },
    ] }],
  }],
};

const rosterOf = (n: number) => ({
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 5000,
  selections: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, entryId: "e.troop", count: 1, selections: [] })),
});

// Time K evaluations of an n-selection roster, in ms. Summing K runs makes the
// measurement large enough that timer granularity and one-off jitter don't
// dominate; the median over several such samples drops the occasional
// scheduler-stall outlier.
function evalMs(n: number, iterations = 20, samples = 5): number {
  const roster = rosterOf(n);
  evaluate(roster, cat); // warm up JIT before measuring
  const runs: number[] = [];
  for (let s = 0; s < samples; s++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) evaluate(roster, cat);
    runs.push(performance.now() - start);
  }
  return runs.sort((a, b) => a - b)[Math.floor(samples / 2)] ?? 0;
}

describe("modifier engine performance", () => {
  // The regression this guards against is an O(n²) (or worse) blow-up in the
  // modifier/cost fixpoint — a real one would make 4× the work cost ~16×+, not
  // ~4×. Asserting the SCALING ratio instead of an absolute wall-clock keeps the
  // test meaningful on any machine and immune to CPU contention from sibling
  // suites (the old hard `<50ms` bound flaked to ~124ms under parallel turbo).
  it("scales roughly linearly, not quadratically, in roster size", () => {
    const small = evalMs(80);
    const large = evalMs(320); // 4× the selections
    // Linear ⇒ ~4×. Allow 8× for constant-factor overhead and timing noise;
    // a quadratic regression (~16×) sails past this, a linear one stays well under.
    expect(large / small).toBeLessThan(8);
  });
});
