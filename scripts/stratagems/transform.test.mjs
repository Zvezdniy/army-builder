import { describe, it, expect } from "vitest";
import { parseStratagemCsv } from "./transform.mjs";

// Real-shaped fixture: BOM, header with 11 named columns + trailing empty field,
// a one-line record, and a record whose description spans two physical lines.
const HEADER = "faction_id|name|id|type|cp_cost|legend|turn|phase|detachment|detachment_id|description|";
const FIXTURE =
  "﻿" + HEADER + "\n" +
  "SM|HEROES OF THE CHAPTER|000008495003|1st Company Task Force – Battle Tactic Stratagem|1|leg|Your turn|Shooting phase|1st Company Task Force|000000798|<b>WHEN:</b> Your Shooting phase.|\n" +
  "AdM|THREAT TARGETERS|000010748005|Eradication Cohort – Wargear Stratagem|1|Supplementary routines identify targets and assist in their\nrapid elimination.|Your turn|Shooting phase|Eradication Cohort|000010900|<b>WHEN:</b> Your Shooting phase.|\n";

describe("parseStratagemCsv", () => {
  it("recovers all records, including one with an embedded newline", () => {
    const rows = parseStratagemCsv(FIXTURE);
    expect(rows).toHaveLength(2);
  });

  it("strips the BOM and maps named columns by position", () => {
    const [first] = parseStratagemCsv(FIXTURE);
    expect(first.faction_id).toBe("SM");
    expect(first.name).toBe("HEROES OF THE CHAPTER");
    expect(first.id).toBe("000008495003");
    expect(first.cp_cost).toBe("1");
    expect(first.detachment_id).toBe("000000798");
    expect(first.description).toBe("<b>WHEN:</b> Your Shooting phase.");
  });

  it("keeps an embedded newline inside the description field", () => {
    const rows = parseStratagemCsv(FIXTURE);
    expect(rows[1].legend).toContain("\n");
    expect(rows[1].name).toBe("THREAT TARGETERS");
    expect(rows[1].description).toBe("<b>WHEN:</b> Your Shooting phase.");
  });
});

import { deriveCategory, coerceCp, recordToStratagem } from "./transform.mjs";

describe("deriveCategory", () => {
  it("extracts the category between the en-dash and 'Stratagem'", () => {
    expect(deriveCategory("1st Company Task Force – Battle Tactic Stratagem")).toBe("Battle Tactic");
    expect(deriveCategory("Core – Strategic Ploy Stratagem")).toBe("Strategic Ploy");
  });
  it("returns empty for a bare '… – Stratagem' or empty type", () => {
    expect(deriveCategory("Serpent's Brood – Stratagem")).toBe("");
    expect(deriveCategory("")).toBe("");
  });
});

describe("coerceCp", () => {
  it("parses an integer, defaulting non-numeric to 0", () => {
    expect(coerceCp("1")).toBe(1);
    expect(coerceCp("2")).toBe(2);
    expect(coerceCp("")).toBe(0);
    expect(coerceCp("free")).toBe(0);
  });
});

describe("recordToStratagem", () => {
  const detRec = {
    faction_id: "SM", name: "ARMOUR OF CONTEMPT", id: "000008495003",
    type: "1st Company Task Force – Battle Tactic Stratagem", cp_cost: "1",
    legend: "flavour", turn: "Either Player's turn", phase: "Shooting or Fight phase",
    detachment: "1st Company Task Force", detachment_id: "000000798",
    description: "<b>WHEN:</b> …",
  };
  it("maps a detachment record, using rec.id verbatim", () => {
    expect(recordToStratagem(detRec)).toEqual({
      id: "000008495003", name: "ARMOUR OF CONTEMPT", category: "Battle Tactic",
      cpCost: 1, turn: "Either Player's turn", phase: "Shooting or Fight phase",
      detachment: "1st Company Task Force", detachmentId: "000000798",
      legend: "flavour", description: "<b>WHEN:</b> …",
    });
  });
  it("maps a Core record (empty detachment, category still parsed)", () => {
    const core = { faction_id: "", name: "GRENADE", id: "000000123",
      type: "Core – Wargear Stratagem", cp_cost: "1", legend: "", turn: "Your turn",
      phase: "Shooting phase", detachment: "", detachment_id: "", description: "<b>WHEN:</b> …" };
    const out = recordToStratagem(core);
    expect(out.detachment).toBe("");
    expect(out.detachmentId).toBe("");
    expect(out.category).toBe("Wargear");
    expect(out.id).toBe("000000123");
  });
});

import { isCore, bucketStratagems, buildManifest } from "./transform.mjs";

const rec = (o) => ({ faction_id: "", name: "X", id: "i" + Math.abs(0), type: "", cp_cost: "1",
  legend: "", turn: "", phase: "", detachment: "", detachment_id: "", description: "", ...o });

describe("isCore", () => {
  it("is true only for empty faction_id with a 'Core' type-prefix", () => {
    expect(isCore(rec({ faction_id: "", type: "Core – Wargear Stratagem" }))).toBe(true);
    expect(isCore(rec({ faction_id: "", type: "Boarding Actions – Battle Tactic Stratagem" }))).toBe(false);
    expect(isCore(rec({ faction_id: "", type: "Core Stratagem – Strategic Ploy Stratagem" }))).toBe(false);
    expect(isCore(rec({ faction_id: "SM", type: "Core – Wargear Stratagem" }))).toBe(false);
  });
});

describe("bucketStratagems", () => {
  const records = [
    rec({ faction_id: "", id: "c1", type: "Core – Wargear Stratagem", name: "GRENADE" }),
    rec({ faction_id: "", id: "b1", type: "Boarding Actions – Battle Tactic Stratagem", name: "EXPLOSIVE CLEARANCE" }),
    rec({ faction_id: "SM", id: "s1", type: "Foo – Battle Tactic Stratagem", detachment_id: "d1", detachment: "Foo" }),
    rec({ faction_id: "TL", id: "t1", type: "Bar – Battle Tactic Stratagem", detachment_id: "d2", detachment: "Bar" }),
  ];
  const factionIds = new Set(["SM", "NEC"]);
  it("splits Core, per-faction, and drops game-mode + out-of-map", () => {
    const { core, byFaction, dropped } = bucketStratagems(records, factionIds);
    expect(core.map((s) => s.name)).toEqual(["GRENADE"]);
    expect(byFaction.get("SM")).toHaveLength(1);
    expect(byFaction.has("NEC")).toBe(false);
    expect(dropped.get("Boarding Actions")).toBe(1); // empty-faction non-Core
    expect(dropped.get("TL")).toBe(1);               // out-of-map faction
  });
});

describe("buildManifest", () => {
  const config = {
    attribution: "ATTR",
    factionMap: { "space-marines": "SM", "blood-angels": "SM", "necrons": "NEC" },
    canonicalSlug: { SM: "space-marines", NEC: "necrons" },
  };
  const buckets = {
    core: [rec({}), rec({})],
    byFaction: new Map([["SM", [rec({}), rec({})]], ["NEC", [rec({})]]]),
    dropped: new Map(),
  };
  it("emits one entry per slug, chapters sharing the SM file", () => {
    const m = buildManifest(config, buckets);
    expect(m.version).toBe(1);
    expect(m.attribution).toBe("ATTR");
    expect(m.core).toEqual({ file: "stratagems/_core.json", count: 2 });
    const bySlug = Object.fromEntries(m.factions.map((f) => [f.slug, f]));
    expect(bySlug["space-marines"]).toEqual({ slug: "space-marines", wahapediaFactionId: "SM", file: "stratagems/space-marines.json", count: 2 });
    expect(bySlug["blood-angels"].file).toBe("stratagems/space-marines.json");
    expect(bySlug["blood-angels"].count).toBe(2);
    expect(bySlug["necrons"].count).toBe(1);
  });
});

import { validateCsvBody } from "./transform.mjs";

describe("validateCsvBody", () => {
  const opts = { minBytes: 20, headerPrefix: "faction_id|name|id|type" };
  it("passes a well-formed body", () => {
    expect(() => validateCsvBody("faction_id|name|id|type|more|padding|here", opts)).not.toThrow();
  });
  it("throws on a too-short body", () => {
    expect(() => validateCsvBody("short", opts)).toThrow(/floor/);
  });
  it("throws on a wrong header (e.g. an HTML error page)", () => {
    expect(() => validateCsvBody("<html>error</html> and some more padding text", opts)).toThrow(/header/);
  });
});
