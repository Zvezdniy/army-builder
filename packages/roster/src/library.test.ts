import { describe, it, expect } from "vitest";
import type { Roster } from "@muster/domain";
import {
  emptyLibrary, upsertActive, renameEntry, duplicateEntry, deleteEntry, setActive,
  activeEntry, parseLibrary, toEnvelope, fromEnvelope,
} from "./library";

const roster = (id: string, name = "Army"): Roster => ({
  id, name, gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1,
  pointsLimit: 2000, selections: [],
});
const meta = { edition: "10e", catalogueId: "cat", catalogueName: "Space Marines" };

describe("upsertActive", () => {
  it("inserts a new active entry", () => {
    const lib = upsertActive(emptyLibrary(), roster("r1"), meta, 100);
    expect(lib.activeId).toBe("r1");
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]!.updatedAt).toBe(100);
    expect(lib.entries[0]!.catalogueName).toBe("Space Marines");
  });
  it("replaces the entry with the same id in place, bumping updatedAt", () => {
    let lib = upsertActive(emptyLibrary(), roster("r1", "Old"), meta, 100);
    lib = upsertActive(lib, roster("r1", "New"), meta, 200);
    expect(lib.entries).toHaveLength(1);
    expect(lib.entries[0]!.name).toBe("New");
    expect(lib.entries[0]!.updatedAt).toBe(200);
  });
  it("does not mutate the input library", () => {
    const lib0 = emptyLibrary();
    upsertActive(lib0, roster("r1"), meta, 100);
    expect(lib0.entries).toHaveLength(0);
  });
});

describe("renameEntry / setActive / deleteEntry / duplicateEntry", () => {
  const base = upsertActive(upsertActive(emptyLibrary(), roster("r1"), meta, 100), roster("r2"), meta, 110);
  it("renames the entry and its roster, bumping updatedAt", () => {
    const lib = renameEntry(base, "r1", "Renamed", 300);
    const e = lib.entries.find((x) => x.id === "r1")!;
    expect(e.name).toBe("Renamed");
    expect(e.roster.name).toBe("Renamed");
    expect(e.updatedAt).toBe(300);
  });
  it("setActive points at an existing entry", () => {
    expect(setActive(base, "r1").activeId).toBe("r1");
  });
  it("deleteEntry removes it and clears activeId when it matched", () => {
    const lib = deleteEntry(base, "r2"); // r2 was active
    expect(lib.entries.map((e) => e.id)).toEqual(["r1"]);
    expect(lib.activeId).toBeNull();
  });
  it("deleteEntry keeps activeId when a different entry is removed", () => {
    const lib = deleteEntry(base, "r1");
    expect(lib.activeId).toBe("r2");
  });
  it("duplicateEntry deep-copies under a new id and makes it active", () => {
    const lib = duplicateEntry(base, "r1", "r1-copy", 400);
    const copy = lib.entries.find((e) => e.id === "r1-copy")!;
    expect(copy.roster.id).toBe("r1-copy");
    expect(copy.roster.name).toBe("Army (copy)");
    expect(lib.activeId).toBe("r1-copy");
    expect(lib.entries).toHaveLength(3);
  });
  it("duplicateEntry on a missing id returns lib unchanged", () => {
    const lib = duplicateEntry(base, "nonexistent", "copy", 400);
    expect(lib).toBe(base);
    expect(lib.entries).toHaveLength(2);
  });
  it("activeEntry returns the active entry or undefined", () => {
    expect(activeEntry(base)!.id).toBe("r2");
    expect(activeEntry(emptyLibrary())).toBeUndefined();
  });
});

describe("parseLibrary", () => {
  it("returns an empty library for a wholly invalid blob", () => {
    expect(parseLibrary("nonsense")).toEqual(emptyLibrary());
    expect(parseLibrary(null)).toEqual(emptyLibrary());
  });
  it("drops a corrupt entry but keeps valid ones", () => {
    const good = upsertActive(emptyLibrary(), roster("r1"), meta, 100).entries[0];
    const raw = { version: 1, activeId: "r1", entries: [good, { id: "bad" }] };
    const lib = parseLibrary(raw);
    expect(lib.entries.map((e) => e.id)).toEqual(["r1"]);
  });
  it("clears activeId when it doesn't match any entry", () => {
    const good = upsertActive(emptyLibrary(), roster("r1"), meta, 100).entries[0];
    const raw = { version: 1, activeId: "nonexistent", entries: [good, { id: "bad" }] };
    const lib = parseLibrary(raw);
    expect(lib.entries.map((e) => e.id)).toEqual(["r1"]);
    expect(lib.activeId).toBeNull();
  });
  it("round-trips a serialized library", () => {
    const lib = upsertActive(emptyLibrary(), roster("r1"), meta, 100);
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });
});

describe("toEnvelope / fromEnvelope", () => {
  it("round-trips", () => {
    const env = toEnvelope(roster("r1"), "10e", "cat");
    const back = fromEnvelope(JSON.parse(JSON.stringify(env)));
    expect(back.roster.id).toBe("r1");
    expect(back.edition).toBe("10e");
    expect(back.catalogueId).toBe("cat");
  });
  it("throws on a wrong/absent schema", () => {
    expect(() => fromEnvelope({ schema: "nope", edition: "10e", catalogueId: "cat", roster: roster("r1") })).toThrow();
    expect(() => fromEnvelope({})).toThrow();
  });
});
