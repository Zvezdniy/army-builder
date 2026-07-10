import { describe, it, expect } from "vitest";
import { Roster, RosterSelection } from "@muster/domain";

describe("roster schemas", () => {
  it("rejects a non-positive count", () => {
    expect(() =>
      RosterSelection.parse({ id: "s1", entryId: "e.unit", count: 0 }),
    ).toThrow();
  });

  it("parses a nested roster and defaults selections to []", () => {
    const roster = Roster.parse({
      id: "r1",
      name: "My List",
      gameSystemId: "gs.40k",
      catalogueId: "cat.demo",
      catalogueRevision: 1,
      pointsLimit: 2000,
      selections: [
        {
          id: "s1",
          entryId: "e.unit",
          count: 1,
          selections: [{ id: "s2", entryId: "e.wargear", count: 2 }],
        },
      ],
    });
    expect(roster.selections[0]?.selections[0]?.count).toBe(2);
    expect(roster.selections[0]?.selections[0]?.selections).toEqual([]);
  });
});
