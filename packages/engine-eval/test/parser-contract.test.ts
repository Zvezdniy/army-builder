// parser-golden.ir.json is a byte-for-byte copy of
// packages/engine-parser/tests/fixtures/golden/mini40k.ir.json — keep them identical.
// (A future pipeline step can automate this copy.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IrCatalogue, type Roster } from "@muster/domain";
import { evaluate } from "@muster/engine-eval";

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/parser-golden.ir.json", import.meta.url)), "utf8"),
);

describe("parser IR contract", () => {
  it("golden parser output validates against the domain Zod schema", () => {
    const parsed = IrCatalogue.safeParse(golden);
    if (!parsed.success) console.error(parsed.error);
    expect(parsed.success).toBe(true);
  });

  it("engine-eval evaluates a legal roster on the parsed catalogue", () => {
    const cat = IrCatalogue.parse(golden);
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [{ id: "s", entryId: "e.captain", count: 1, selections: [] }],
    };
    const result = evaluate(roster, cat);
    expect(result.totalPoints).toBe(90);
    expect(result.valid).toBe(true); // 1 HQ satisfies fc.hq.min/max; no violations
  });

  it("engine-eval surfaces a parsed forceConstraint when violated", () => {
    const cat = IrCatalogue.parse(golden);
    // 3 HQ selections violate fc.hq.max (max 2) — proves the parsed forceConstraints are live.
    const roster: Roster = {
      id: "r", name: "R", gameSystemId: cat.gameSystemId,
      catalogueId: cat.id, catalogueRevision: cat.revision, pointsLimit: 1000,
      selections: [
        { id: "h1", entryId: "e.captain", count: 1, selections: [] },
        { id: "h2", entryId: "e.captain", count: 1, selections: [] },
        { id: "h3", entryId: "e.captain", count: 1, selections: [] },
      ],
    };
    const result = evaluate(roster, cat);
    expect(result.totalPoints).toBe(270);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.constraintId === "fc.hq.max")).toBe(true);
  });
});
