import { describe, it, expect } from "vitest";
import type { IrCatalogue, IrEntry, Roster, RosterSelection, IrConditionGroup, IrModifier } from "@muster/domain";
import {
  evaluate,
  buildSymbolTable,
  buildState,
  applyModifiers,
  evaluateConditionGroup,
  aggregate,
  nodePoints,
  MAX_DEPTH,
} from "@muster/engine-eval";

// These tests treat the engine as if it were handed structures straight from an
// untrusted file. The goal is not "correct answers" but "no host crash": deep
// recursion must surface a clear, catchable Error rather than overflowing the
// native call stack (a denial-of-service), and malformed variants must be
// rejected loudly rather than producing silent nonsense.

const soloCatalogue: IrCatalogue = {
  id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
  entries: [{ id: "e", name: "E", costs: [{ name: "points", value: 1 }], categories: ["cat"], constraints: [], children: [] }],
};

const rosterMeta = {
  id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 1_000_000,
};

// A roster that nests `depth` selections deep, all pointing at entry "e".
function deepRoster(depth: number): Roster {
  let sel: RosterSelection = { id: `s${depth}`, entryId: "e", count: 1, selections: [] };
  for (let i = depth - 1; i >= 1; i--) sel = { id: `s${i}`, entryId: "e", count: 1, selections: [sel] };
  return { ...rosterMeta, selections: [sel] };
}

// A catalogue whose single entry nests `depth` children deep, each a unique id.
function deepCatalogue(depth: number): IrCatalogue {
  let entry: IrEntry = { id: `e${depth}`, name: "E", costs: [], categories: [], constraints: [], children: [] };
  for (let i = depth - 1; i >= 1; i--) {
    entry = { id: `e${i}`, name: "E", costs: [], categories: [], constraints: [], children: [entry] };
  }
  return { id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], entries: [entry] };
}

// A condition group nested `depth` groups deep (innermost is an empty AND => true).
function deepGroup(depth: number): IrConditionGroup {
  let g: IrConditionGroup = { type: "and", conditions: [] };
  for (let i = 1; i < depth; i++) g = { type: "and", conditionGroups: [g] };
  return g;
}

describe("recursion is bounded (no stack-overflow DoS)", () => {
  it("throws a controlled error for a roster nested past MAX_DEPTH", () => {
    expect(() => buildState(deepRoster(MAX_DEPTH + 5), soloCatalogue)).toThrow(/MAX_DEPTH/);
  });

  it("throws a controlled error for a catalogue nested past MAX_DEPTH", () => {
    expect(() => buildSymbolTable(deepCatalogue(MAX_DEPTH + 5))).toThrow(/MAX_DEPTH/);
  });

  it("throws a controlled error for condition groups nested past MAX_DEPTH", () => {
    const state = buildState({ ...rosterMeta, selections: [{ id: "s", entryId: "e", count: 1, selections: [] }] }, soloCatalogue);
    const node = state.all[0]!;
    expect(() => evaluateConditionGroup(deepGroup(MAX_DEPTH + 5), node, state)).toThrow(/MAX_DEPTH/);
  });

  it("still handles legitimately deep (but bounded) structures", () => {
    const state = buildState(deepRoster(MAX_DEPTH - 1), soloCatalogue);
    expect(state.all).toHaveLength(MAX_DEPTH - 1);
    // Empty AND group at legal depth resolves to true without throwing.
    expect(evaluateConditionGroup(deepGroup(MAX_DEPTH - 1), state.all[0]!, state)).toBe(true);
  });
});

describe("malformed structures fail loudly, not silently", () => {
  it("tolerates duplicate entry ids: the flat index is first-wins, not a loud reject", () => {
    // The parser legitimately inlines shared entries by cloning them into every
    // referencing site, so the same id reappearing is expected, not malformed.
    // buildSymbolTable is a tolerant flat fallback index (see symbols.ts); correct
    // per-placement resolution is buildState's job (tree walk by parent context).
    const dup: IrCatalogue = {
      ...soloCatalogue,
      entries: [
        { id: "e", name: "A", costs: [], categories: [], constraints: [], children: [] },
        { id: "e", name: "B", costs: [], categories: [], constraints: [], children: [] },
      ],
    };
    const t = buildSymbolTable(dup);
    expect(t.get("e")?.name).toBe("A");
  });

  it("rejects a roster referencing an unknown entry", () => {
    const bad: Roster = { ...rosterMeta, selections: [{ id: "s", entryId: "nope", count: 1, selections: [] }] };
    expect(() => buildState(bad, soloCatalogue)).toThrow(/Unknown entryId/);
  });

  it("rejects an unknown modifier type instead of miscomputing", () => {
    const state = buildState({ ...rosterMeta, selections: [{ id: "s", entryId: "e", count: 1, selections: [] }] }, soloCatalogue);
    const bogus = { id: "m", type: "bogus-type", value: 2 } as unknown as IrModifier;
    expect(() => applyModifiers(10, [bogus], state.all[0]!, state)).toThrow(/Unknown modifier type/);
  });
});

describe("never-block: evaluate returns a result, it does not throw", () => {
  it("returns issues (not an exception) for mutually impossible constraints", () => {
    const cat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1,
      forceConstraints: [
        { id: "min3", type: "min", value: 3, field: "selections", scope: "roster", targetType: "category", targetId: "cat", includeChildSelections: false },
        { id: "max1", type: "max", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat", includeChildSelections: false },
      ],
      entries: soloCatalogue.entries,
    };
    const roster: Roster = { ...rosterMeta, pointsLimit: 100, selections: [{ id: "s", entryId: "e", count: 2, selections: [] }] };
    let result: ReturnType<typeof evaluate> | undefined;
    expect(() => { result = evaluate(roster, cat); }).not.toThrow();
    expect(result!.valid).toBe(false);
    // Exactly one of the impossible pair is violated at count=2; the point is it reports, not crashes.
    expect(result!.issues.length).toBeGreaterThan(0);
  });

  it("evaluates a large-but-legal roster correctly and quickly", () => {
    const selections: RosterSelection[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `s${i}`, entryId: "e", count: 1, selections: [],
    }));
    const roster: Roster = { ...rosterMeta, pointsLimit: 5000, selections };
    const t0 = performance.now();
    const result = evaluate(roster, soloCatalogue);
    const elapsed = performance.now() - t0;
    expect(result.totalPoints).toBe(1000);
    expect(result.valid).toBe(true);
    expect(elapsed).toBeLessThan(50);
  });
});

describe("cost / scope edge cases", () => {
  it("treats an entry with no points cost as 0 points", () => {
    const freeCatalogue: IrCatalogue = {
      ...soloCatalogue,
      entries: [{ id: "free", name: "Free", costs: [], categories: [], constraints: [], children: [] }],
    };
    const state = buildState({ ...rosterMeta, selections: [{ id: "s", entryId: "free", count: 3, selections: [] }] }, freeCatalogue);
    expect(nodePoints(state.all[0]!)).toBe(0);
  });

  it("resolves a node-relative aggregate to 0 (never throws) when evaluated with no owning node", () => {
    // Force-level checks pass node === null; a node-relative scope there is meaningless.
    // Returning 0 rather than throwing keeps evaluate() robust against adversarial
    // catalogues (a thrown error would abort the entire validation).
    const state = buildState({ ...rosterMeta, selections: [{ id: "s", entryId: "e", count: 1, selections: [] }] }, soloCatalogue);
    const spec = { id: "p", field: "selections", scope: "parent", targetType: "category", targetId: "cat", includeChildSelections: false } as const;
    expect(aggregate(null, spec, state)).toBe(0);
  });
});
