import { describe, it, expect } from "vitest";
import { loadStratagemFile, loadStratagemManifest } from "./stratagem";

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
