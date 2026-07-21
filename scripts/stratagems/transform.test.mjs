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
