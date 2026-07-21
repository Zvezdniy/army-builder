import { describe, it, expect } from "vitest";
import { RosterSelection, Roster, RosterEnvelope, RosterLibrary, ROSTER_ENVELOPE_SCHEMA, LIBRARY_VERSION } from "./roster";

describe("RosterSelection.attachedTo", () => {
  it("accepts an optional attachedTo", () => {
    const s = RosterSelection.parse({ id: "l", entryId: "e", count: 1, attachedTo: "b" });
    expect(s.attachedTo).toBe("b");
  });
  it("stays optional (absent when not given)", () => {
    const s = RosterSelection.parse({ id: "l", entryId: "e", count: 1 });
    expect(s.attachedTo).toBeUndefined();
  });
});

const roster = {
  id: "r1", name: "Army", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1,
  pointsLimit: 2000, selections: [],
};

describe("RosterEnvelope", () => {
  it("parses a valid envelope", () => {
    const env = { schema: ROSTER_ENVELOPE_SCHEMA, edition: "10e", catalogueId: "cat", roster };
    expect(RosterEnvelope.parse(env).roster.id).toBe("r1");
  });
  it("rejects a wrong schema literal", () => {
    const env = { schema: "other", edition: "10e", catalogueId: "cat", roster };
    expect(RosterEnvelope.safeParse(env).success).toBe(false);
  });
});

describe("RosterLibrary", () => {
  it("parses a library and defaults entries", () => {
    const lib = { version: LIBRARY_VERSION, activeId: null, entries: [] };
    expect(RosterLibrary.parse(lib).entries).toEqual([]);
  });
  it("parses an entry carrying its roster + display meta", () => {
    const entry = { id: "r1", name: "Army", edition: "10e", catalogueId: "cat", catalogueName: "Space Marines", points: 2000, updatedAt: 123, roster };
    const lib = RosterLibrary.parse({ version: 1, activeId: "r1", entries: [entry] });
    expect(lib.entries[0]!.catalogueName).toBe("Space Marines");
  });
});
