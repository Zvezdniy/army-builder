import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { loadLibrary, saveLibrary, STORAGE_KEY, useRosterLibrary } from "./rosterLibrary";
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

describe("useRosterLibrary", () => {
  beforeEach(() => localStorage.clear());
  it("flushes the pending debounced write on unmount", () => {
    const { result, unmount } = renderHook(() => useRosterLibrary());
    act(() => {
      result.current.setLibrary((lib) => upsertActive(lib, { id: "r1", name: "A", gameSystemId: "gs", catalogueId: "cat", catalogueRevision: 1, pointsLimit: 2000, selections: [] }, { edition: "10e", catalogueId: "cat", catalogueName: "SM" }, 1));
    });
    unmount(); // before the 400ms debounce fires
    expect(JSON.parse(localStorage.getItem("muster:library:v1")!).entries).toHaveLength(1);
  });
});
