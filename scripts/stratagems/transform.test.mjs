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
