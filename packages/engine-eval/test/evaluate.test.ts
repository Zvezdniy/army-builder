import { describe, it, expect } from "vitest";
import { evaluate } from "@muster/engine-eval";
import { mini40kCatalogue, legalRoster, rosterWith, sel } from "./fixtures/mini40k";
import type { IrCatalogue, IrEntry } from "@muster/domain";

describe("evaluate", () => {
  it("passes a legal roster", () => {
    const result = evaluate(legalRoster, mini40kCatalogue);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.totalPoints).toBe(430);
  });

  it("flags going over the points cap", () => {
    const result = evaluate(rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy")], 200), mini40kCatalogue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.code === "points.over")).toBe(true);
  });

  it("flags too many Heavy Support (force max)", () => {
    const result = evaluate(
      rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy"), sel("e.heavy"), sel("e.heavy")]),
      mini40kCatalogue,
    );
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.heavy.max")).toBe(true);
  });

  it("flags a missing HQ (force min)", () => {
    const result = evaluate(rosterWith([sel("e.troops")]), mini40kCatalogue);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.min")).toBe(true);
  });

  it("is deterministic / idempotent", () => {
    const a = evaluate(legalRoster, mini40kCatalogue);
    const b = evaluate(legalRoster, mini40kCatalogue);
    expect(a).toEqual(b);
  });
});

describe("evaluate legality checks", () => {
  it("reports a satisfied points check under the limit", () => {
    const result = evaluate(legalRoster, mini40kCatalogue);
    const pts = result.checks.find((c) => c.kind === "points");
    expect(pts).toMatchObject({ id: "points", satisfied: true, actual: result.totalPoints, limit: result.pointsLimit });
  });

  it("reports an unsatisfied points check over the limit", () => {
    const result = evaluate(rosterWith([sel("e.captain"), sel("e.heavy"), sel("e.heavy")], 200), mini40kCatalogue);
    expect(result.checks.find((c) => c.kind === "points")?.satisfied).toBe(false);
  });

  it("emits one force check per force constraint with a human label", () => {
    const result = evaluate(legalRoster, mini40kCatalogue);
    const force = result.checks.filter((c) => c.kind === "force");
    expect(force).toHaveLength(mini40kCatalogue.forceConstraints.length);
    expect(force.find((c) => c.id === "fc.hq.min")?.label).toMatch(/At least 1 category/);
    expect(force.find((c) => c.id === "fc.heavy.max")?.label).toMatch(/At most 3 category/);
  });

  it("marks a violated force check unsatisfied and pairs it with an issue", () => {
    const result = evaluate(rosterWith([sel("e.troops")]), mini40kCatalogue); // no HQ
    const hq = result.checks.find((c) => c.id === "fc.hq.min");
    expect(hq?.satisfied).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.min")).toBe(true);
  });

  it("marks a satisfied force check with no paired issue", () => {
    const result = evaluate(legalRoster, mini40kCatalogue);
    const hq = result.checks.find((c) => c.id === "fc.hq.min");
    expect(hq?.satisfied).toBe(true);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.min")).toBe(false);
  });

  it("skips a force constraint that cannot anchor at army level (no force check)", () => {
    // A force constraint carrying a node-relative scope has no army-level anchor;
    // describeConstraint returns null and it is omitted from checks (still just the points check).
    const cat: IrCatalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1,
      entries: [{ id: "e.x", name: "X", costs: [], categories: ["cat.x"], constraints: [], children: [] }],
      forceConstraints: [
        { id: "fc.unit", type: "max", value: 1, field: "selections", scope: "unit", targetType: "category", targetId: "cat.x", includeChildSelections: false },
      ],
    };
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "x1", entryId: "e.x", count: 1, selections: [] }],
    };
    const result = evaluate(roster, cat);
    expect(result.checks.filter((c) => c.kind === "force")).toHaveLength(0);
    expect(result.checks.map((c) => c.kind)).toEqual(["points"]);
  });
});

describe("evaluate with cost modifiers", () => {
  // Each troop 10 pts, -3 when >=3 troops. 3 troops => 21, under a 25 cap = legal.
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [{
      id: "e.troop", name: "Troop", categories: ["cat.troops"], constraints: [], children: [],
      costs: [{ name: "points", value: 10, modifiers: [{ id: "bulk", type: "decrement", value: 3, conditions: [
        { id: "c", comparator: "atLeast", value: 3, field: "selections", scope: "force", targetType: "category", targetId: "cat.troops", includeChildSelections: false },
      ] }] }],
    }],
  };
  const roster3 = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 25,
    selections: [
      { id: "t1", entryId: "e.troop", count: 1, selections: [] },
      { id: "t2", entryId: "e.troop", count: 1, selections: [] },
      { id: "t3", entryId: "e.troop", count: 1, selections: [] },
    ],
  };

  it("uses discounted total (21) so a 25-pt cap passes", () => {
    const result = evaluate(roster3, cat);
    expect(result.totalPoints).toBe(21);
    expect(result.valid).toBe(true);
    expect(result.dismissed).toEqual([]);
    expect(result.hasHouseRules).toBe(false);
  });
});

describe("evaluate tolerates inlined duplicate entry ids", () => {
  // Mirrors real catalogues: a shared entry inlined (cloned) under two units,
  // producing a duplicate id. evaluate() must not throw.
  const shared: IrEntry = {
    id: "e.shared.wargear", name: "Shared Wargear", costs: [], categories: [], constraints: [], children: [],
  };
  const cat: IrCatalogue = {
    id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [],
    entries: [
      { id: "e.u1", name: "U1", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
      { id: "e.u2", name: "U2", costs: [], categories: [], constraints: [], children: [structuredClone(shared)] },
    ],
  };
  const emptyRoster = {
    id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 100, selections: [],
  };

  it("evaluates an empty roster without a duplicate-id crash", () => {
    const result = evaluate(emptyRoster, cat);
    expect(result.totalPoints).toBe(0);
    expect(result.valid).toBe(true);
  });
});

describe("evaluate flags hidden selections", () => {
  it("warns about a selected node that is hidden under current state", () => {
    const catalogue = {
      id: "c", name: "C", gameSystemId: "gs", revision: 1, forceConstraints: [], categoryNames: {},
      entries: [
        { id: "e.det", name: "Detachment", costs: [], categories: ["cat.det"], constraints: [], children: [] },
        {
          id: "e.enh", name: "Relic Blade", costs: [{ name: "points", value: 15 }], categories: [], constraints: [], children: [],
          visibilityModifiers: [{ set: true, conditions: [{ id: "c1", comparator: "lessThan", value: 1, field: "selections", scope: "roster", targetType: "category", targetId: "cat.det", includeChildSelections: false }] }],
        },
      ],
    } as any;
    const roster = {
      id: "r", name: "R", gameSystemId: "gs", catalogueId: "c", catalogueRevision: 1, pointsLimit: 2000,
      selections: [{ id: "s0", entryId: "e.enh", count: 1, selections: [] }],
    } as any;
    const result = evaluate(roster, catalogue);
    const issue = result.issues.find((i) => i.code === "selection.hidden");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("warning");
    expect(issue!.selectionId).toBe("s0");
    expect(issue!.entryId).toBe("e.enh");
    expect(result.valid).toBe(true);       // warning does not invalidate
    expect(result.totalPoints).toBe(15);   // hidden node still costs points
  });
});
