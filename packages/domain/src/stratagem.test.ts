import { describe, it, expect } from "vitest";
import { loadStratagemFile, loadStratagemManifest, stratagemFileForSlug, selectStratagems } from "./stratagem";
import type { StratagemFile } from "./stratagem";

const CORE_FILE = {
  source: "Wahapedia",
  kind: "core",
  stratagems: [
    { id: "c1", name: "GRENADE", category: "Wargear", cpCost: 1, turn: "Your turn",
      phase: "Shooting phase", detachment: "", detachmentId: "", legend: "", description: "<b>WHEN:</b> …" },
  ],
};

const FACTION_FILE = {
  source: "Wahapedia",
  kind: "faction",
  wahapediaFactionId: "SM",
  stratagems: [
    { id: "s1", name: "ARMOUR OF CONTEMPT", category: "Battle Tactic", cpCost: 1, turn: "Either Player's turn",
      phase: "Shooting or Fight phase", detachment: "Gladius Task Force", detachmentId: "d1", legend: "", description: "<b>WHEN:</b> …" },
  ],
};

const MANIFEST = {
  version: 1, source: "Wahapedia", attribution: "Data from Wahapedia (wahapedia.ru). Not affiliated with Games Workshop.",
  core: { file: "stratagems/_core.json", count: 11 },
  factions: [
    { slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 255 },
    { slug: "blood-angels", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 255 },
  ],
};

describe("loadStratagemFile", () => {
  it("parses a valid core file", () => {
    expect(loadStratagemFile(CORE_FILE).stratagems[0]?.name).toBe("GRENADE");
  });
  it("parses a valid faction file with wahapediaFactionId", () => {
    expect(loadStratagemFile(FACTION_FILE).wahapediaFactionId).toBe("SM");
  });
  it("throws on a malformed stratagem (cpCost not a number)", () => {
    const bad = { ...CORE_FILE, stratagems: [{ ...CORE_FILE.stratagems[0], cpCost: "free" }] };
    expect(() => loadStratagemFile(bad)).toThrow();
  });
  it("throws on an unknown kind", () => {
    expect(() => loadStratagemFile({ ...CORE_FILE, kind: "mystery" })).toThrow();
  });
});

describe("loadStratagemManifest", () => {
  it("parses a valid manifest", () => {
    const m = loadStratagemManifest(MANIFEST);
    expect(m.core.count).toBe(11);
    expect(m.factions).toHaveLength(2);
  });
  it("throws on a manifest missing core", () => {
    const { core, ...noCore } = MANIFEST;
    expect(() => loadStratagemManifest(noCore)).toThrow();
  });
});

const core: StratagemFile = {
  source: "Wahapedia", kind: "core",
  stratagems: [
    { id: "c1", name: "GRENADE", category: "Wargear", cpCost: 1, turn: "Your turn", phase: "Shooting phase", detachment: "", detachmentId: "", legend: "", description: "d" },
  ],
};
const strat = (name: string, detachment: string): StratagemFile["stratagems"][number] =>
  ({ id: name, name, category: "Battle Tactic", cpCost: 1, turn: "t", phase: "p", detachment, detachmentId: "x", legend: "", description: "d" });
const faction: StratagemFile = {
  source: "Wahapedia", kind: "faction", wahapediaFactionId: "SM",
  stratagems: [
    strat("A", "Gladius Task Force"),
    strat("B", "Gladius Task Force"),
    strat("C", "Emperor’s Shield"), // curly apostrophe in data
    strat("D", "Anvil Siege Force"),
  ],
};

describe("stratagemFileForSlug", () => {
  const manifest = {
    version: 1, source: "Wahapedia", attribution: "a",
    core: { file: "stratagems/_core.json", count: 11 },
    factions: [{ slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 255 }],
  };
  it("returns the file for a present slug", () => {
    expect(stratagemFileForSlug(manifest, "space-marines")).toBe("stratagems/space-marines.json");
  });
  it("returns undefined for an absent slug", () => {
    expect(stratagemFileForSlug(manifest, "tyranids")).toBeUndefined();
  });
});

describe("selectStratagems", () => {
  it("always returns core, even with no faction and no detachments", () => {
    const r = selectStratagems(core, undefined, []);
    expect(r.core.map((s) => s.name)).toEqual(["GRENADE"]);
    expect(r.byDetachment).toEqual([]);
  });
  it("groups a detachment's stratagems, matching case/punctuation-insensitively", () => {
    const r = selectStratagems(core, faction, ["Gladius Task Force", "Emperor's Shield"]);
    expect(r.byDetachment).toHaveLength(2);
    expect(r.byDetachment[0]).toEqual({ detachment: "Gladius Task Force", stratagems: [faction.stratagems[0], faction.stratagems[1]] });
    // straight apostrophe input matches curly-apostrophe data:
    expect(r.byDetachment[1]?.detachment).toBe("Emperor's Shield");
    expect(r.byDetachment[1]?.stratagems.map((s) => s.name)).toEqual(["C"]);
  });
  it("yields an empty group for an unmatched name (not dropped)", () => {
    const r = selectStratagems(core, faction, ["No Such Detachment"]);
    expect(r.byDetachment).toEqual([{ detachment: "No Such Detachment", stratagems: [] }]);
  });
  it("yields empty groups when faction is undefined, still returns core", () => {
    const r = selectStratagems(core, undefined, ["Gladius Task Force"]);
    expect(r.core).toHaveLength(1);
    expect(r.byDetachment).toEqual([{ detachment: "Gladius Task Force", stratagems: [] }]);
  });
  it("preserves input order across multiple detachments", () => {
    const r = selectStratagems(core, faction, ["Anvil Siege Force", "Gladius Task Force"]);
    expect(r.byDetachment.map((g) => g.detachment)).toEqual(["Anvil Siege Force", "Gladius Task Force"]);
  });
});
