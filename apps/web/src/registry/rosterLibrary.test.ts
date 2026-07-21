import { describe, it, expect, beforeEach } from "vitest";
import { loadLibrary, saveLibrary, STORAGE_KEY } from "./rosterLibrary";
import { emptyLibrary, upsertActive } from "@muster/roster";

const roster = { id: "r1", name: "Army", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1, pointsLimit: 2000, selections: [] };
const meta = { edition: "10e", catalogueId: "cat", catalogueName: "SM" };

describe("loadLibrary / saveLibrary", () => {
  beforeEach(() => localStorage.clear());
  it("returns an empty library when storage is empty", () => {
    expect(loadLibrary()).toEqual(emptyLibrary());
  });
  it("round-trips through localStorage", () => {
    const lib = upsertActive(emptyLibrary(), roster, meta, 100);
    saveLibrary(lib);
    expect(loadLibrary()).toEqual(lib);
  });
  it("degrades to empty on a corrupt stored blob", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadLibrary()).toEqual(emptyLibrary());
  });
});
